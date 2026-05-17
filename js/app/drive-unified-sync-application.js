export function createDriveUnifiedSyncApplication(cfg) {
    if (!cfg || typeof cfg.getApi !== 'function') throw new Error('drive-unified-sync-application: brak getApi');

    let isImporting = false;
    let connectSession = null;
    let connectSeq = 0;
    let autoTimer = null;
    let autoBackoffUntil = 0;

    function hasActiveSession() {
        return Boolean(connectSession && !connectSession.cancelled);
    }

    function nowMs() {
        return Date.now();
    }

    function getNowYearMonth(date = new Date()) {
        const d = date instanceof Date ? date : new Date();
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }

    function formatMonthYearLabel({ year, month }) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';
        try {
            const raw = new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date(y, m - 1, 1));
            const safe = String(raw || '').trim();
            const monthName = safe && typeof cfg.toTitleCase === 'function' ? cfg.toTitleCase(safe) : safe;
            return monthName ? `${monthName} ${y}` : `${m}/${y}`;
        } catch {
            return `${m}/${y}`;
        }
    }

    function selectCurrentMonthScheduleDriveFile(files, { now = new Date() } = {}) {
        const list = Array.isArray(files) ? files : [];
        const { year, month } = getNowYearMonth(now);
        const parseStrict = typeof cfg.parseScheduleMetaStrictXlsx === 'function' ? cfg.parseScheduleMetaStrictXlsx : (() => null);
        const candidates = [];

        for (const f of list) {
            const name = String(f?.name || '').trim();
            const meta = parseStrict(name);
            if (!meta) continue;
            if (meta.year !== year || meta.month !== month) continue;
            candidates.push({ ...f, _scheduleMeta: meta });
        }
        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            const ta = Number.isFinite(Number(a?.driveModifiedAt)) ? Number(a.driveModifiedAt) : 0;
            const tb = Number.isFinite(Number(b?.driveModifiedAt)) ? Number(b.driveModifiedAt) : 0;
            if (tb !== ta) return tb - ta;
            return String(a?.name || '').localeCompare(String(b?.name || ''), 'pl', { sensitivity: 'base' });
        });

        if (candidates.length > 1) {
            try {
                cfg.logAction?.('sync', {
                    phase: 'schedule_multiple_candidates',
                    count: candidates.length,
                    chosen: String(candidates[0]?.name || ''),
                    candidates: candidates.slice(0, 6).map(c => String(c?.name || '')).filter(Boolean)
                }, 'WARN');
            } catch { }
        }

        return candidates[0];
    }

    async function getAccessTokenForMode(api, mode) {
        const m = String(mode || 'manual');
        if (m === 'auto') {
            const silent = await api.getAccessTokenSilent?.();
            if (silent) return { token: silent, interactive: false };
            const err = new Error('Brak tokenu do synchronizacji w tle');
            err.code = 'no_token';
            throw err;
        }
        const token = await api.getAccessToken();
        return { token, interactive: true };
    }

    async function collectDriveFiles(folderIdRoutes, folderIdSchedule, token, { signal } = {}) {
        const api = cfg.getApi();
        const routes = await api.crawlFolder(folderIdRoutes, token, { signal });
        const scheduleAll = await api.listFolderFilesShallow(folderIdSchedule, token, { signal });
        const schedule = selectCurrentMonthScheduleDriveFile(scheduleAll);
        return { routes, schedule };
    }

    async function computeChanges({ routes, schedule }) {
        const listDb = await cfg.listDbFiles();
        const dbNames = new Set(Array.isArray(listDb) ? listDb.map(r => String(r?.name ?? '').trim()).filter(Boolean) : []);
        const changed = [];

        const routeFiles = Array.isArray(routes) ? routes : [];
        await cfg.runWithConcurrency(routeFiles, 8, async (file) => {
            const name = String(file?.name || '').trim();
            if (!name) return;
            const record = await cfg.getDbFileRecord(name);
            if (!record) {
                changed.push({ ...file, changeReason: 'Nowy plik', previousDriveModifiedAt: null, isNewInDb: true, qeKind: 'route' });
                return;
            }

            const prev = Number(record?.driveModifiedAt);
            const next = Number(file?.driveModifiedAt);
            if (!Number.isFinite(prev) || prev <= 0) {
                changed.push({ ...file, changeReason: 'Brak zapisanej daty poprzedniej synchronizacji', previousDriveModifiedAt: null, isNewInDb: false, qeKind: 'route' });
                return;
            }
            if (!Number.isFinite(next) || next <= 0) {
                changed.push({ ...file, changeReason: 'Brak daty modyfikacji z Google Drive', previousDriveModifiedAt: prev, isNewInDb: false, qeKind: 'route' });
                return;
            }
            if (next > prev) {
                changed.push({ ...file, changeReason: 'Nowsza wersja na Google Drive', previousDriveModifiedAt: prev, isNewInDb: false, qeKind: 'route' });
            }
        });

        if (schedule && schedule?.name) {
            const name = String(schedule.name).trim();
            const record = await cfg.getDbFileRecord(name);
            const prev = Number(record?.driveModifiedAt);
            const next = Number(schedule?.driveModifiedAt);
            const hasPrev = Number.isFinite(prev) && prev > 0;
            const hasNext = Number.isFinite(next) && next > 0;
            const isUpToDate = Boolean(record && hasPrev && hasNext && prev === next);

            if (!isUpToDate) {
                const meta = schedule?._scheduleMeta || (typeof cfg.parseScheduleMetaStrictXlsx === 'function' ? cfg.parseScheduleMetaStrictXlsx(name) : null);
                const label = meta ? formatMonthYearLabel(meta) : '';
                const reason = label ? `Zmiany w grafiku na ${label}` : 'Zmiany w grafiku';
                changed.push({
                    ...schedule,
                    changeReason: reason,
                    previousDriveModifiedAt: hasPrev ? prev : null,
                    isNewInDb: false,
                    qeKind: 'schedule',
                    diffDisabledLabel: reason,
                    diffDisabledStatus: 'check'
                });
            }
        } else {
            const parseStrict = typeof cfg.parseScheduleMetaStrictXlsx === 'function' ? cfg.parseScheduleMetaStrictXlsx : (() => null);
            const { year, month } = getNowYearMonth(new Date());
            const expected = Array.from(dbNames).find((n) => {
                const meta = parseStrict(n);
                return Boolean(meta && meta.year === year && meta.month === month);
            });
            if (expected) {
                try { cfg.logAction?.('sync', { phase: 'schedule_missing_on_drive', fileName: expected }, 'WARN'); } catch { }
            }
        }

        changed.sort((a, b) => {
            const ka = String(a?.qeKind || 'route');
            const kb = String(b?.qeKind || 'route');
            if (ka !== kb) return ka.localeCompare(kb, 'pl', { sensitivity: 'base' });
            return String(a?.name || '').localeCompare(String(b?.name || ''), 'pl', { sensitivity: 'base' });
        });

        return changed;
    }

    async function applyFiles(files, token, { source } = {}) {
        const api = cfg.getApi();
        const list = Array.isArray(files) ? files : [];
        if (!api) throw new Error('Moduł Google Drive jest niedostępny');
        if (list.length === 0) return;

        const shouldResumeAutoMonitor = autoTimer !== null;
        if (shouldResumeAutoMonitor) stopAutoMonitor();

        isImporting = true;
        cfg.setButtonsBusy(true);
        try { cfg.logAction?.('sync', { phase: 'process', count: list.length, source: source || 'unknown' }); } catch { }

        const isWelcomeVisible = Boolean(cfg.isWelcomeVisible?.());
        if (isWelcomeVisible) {
            try { cfg.prepareWelcomeProgressList?.(); } catch { }
        }

        cfg.setUploadUiVisible(true, list.length);
        cfg.setUploadProgressValue(0);
        cfg.setUploadStatusText(`Google Drive: synchronizacja ${list.length} plik(ów)...`, { animate: false });

        const summary = { files: [], records: 0, errors: 0 };
        const before = cfg.getAllDataLength();

        try {
            let processed = 0;
            for (const file of list) {
                const name = String(file?.name || '').trim();
                const id = String(file?.id || '').trim();
                if (!name || !id) { processed += 1; continue; }

                const progressItem = isWelcomeVisible ? safeCall(() => cfg.createWelcomeItem(name), null) : null;
                if (progressItem) {
                    safeCall(() => cfg.appendWelcomeItem(progressItem), undefined);
                    safeCall(() => cfg.scrollWelcomeItemIntoView(progressItem), undefined);
                }

                const displayName = cfg.formatFileName ? cfg.formatFileName(name) : name;
                cfg.setLoadingStatusText(`Pobieranie: ${displayName}...`);
                cfg.setUploadStatusText(`Google Drive: pobieram ${displayName}...`);

                const percent = list.length > 0 ? (processed / list.length) * 100 : 0;
                cfg.setLoadingProgress(percent, `${Math.round(percent)}%`);
                cfg.setUploadProgressValue(Math.max(0, Math.min(95, percent)));

                try {
                    const buffer = await api.downloadFileArrayBuffer(id, token);
                    if (Number(buffer?.byteLength || 0) > cfg.maxImportBytes) throw new Error('Plik przekracza limit 5MB');

                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    await cfg.putDbBlob(name, blob, { driveModifiedAt: file?.driveModifiedAt ?? null });

                    cfg.removeFileData(name);

                    const kind = String(file?.qeKind || '');
                    if (kind === 'schedule') {
                        cfg.invalidateScheduleFile(name);
                        await cfg.processScheduleFile(name);
                    } else if (cfg.isScheduleFileName(name)) {
                        cfg.invalidateScheduleFile(name);
                        await cfg.processScheduleFile(name);
                    } else {
                        try { cfg.loadedFiles?.delete?.(name); } catch { }
                        await cfg.processFile(name);
                        try { cfg.loadedFiles?.add?.(name); } catch { }
                    }

                    summary.files.push(name);
                    if (progressItem) {
                        const defer = Boolean(cfg.shouldDeferWelcomeUpdates?.());
                        safeCall(() => cfg.updateWelcomeItem(progressItem, 100, 'Gotowe', { defer }), undefined);
                    }
                } catch (err) {
                    summary.errors += 1;
                    try { cfg.logAction?.('sync', { fileName: name, message: err?.message ? String(err.message) : 'Błąd' }, 'ERROR'); } catch { }
                    if (progressItem) {
                        const defer = Boolean(cfg.shouldDeferWelcomeUpdates?.());
                        safeCall(() => cfg.updateWelcomeItem(progressItem, 0, 'Błąd', { isError: true, defer }), undefined);
                    }
                } finally {
                    processed += 1;
                    const nextPercent = list.length > 0 ? (processed / list.length) * 100 : 100;
                    cfg.setLoadingProgress(nextPercent, `${Math.round(nextPercent)}%`);
                    cfg.setUploadProgressValue(Math.round(nextPercent));
                }
            }

            await cfg.finalizeImport(summary, before);
            cfg.setLoadingStatusText('Synchronizacja zakończona');
            cfg.setUploadStatusText('Google Drive: synchronizacja zakończona.');
            cfg.setLoadingProgress(100, '100%');
        } catch (err) {
            const msg = err?.message ? String(err.message) : 'Błąd synchronizacji';
            try { cfg.logAction?.('sync', { phase: 'fatal_error', message: msg }, 'ERROR'); } catch { }
            cfg.setLoadingStatusText('Błąd synchronizacji');
            cfg.setUploadStatusText(`Google Drive: ${msg}`);
            const safeMsg = typeof cfg.escapeHtml === 'function' ? cfg.escapeHtml(msg) : msg;
            cfg.showModal('Błąd synchronizacji', `Wystąpił błąd podczas synchronizacji z Google Drive: ${safeMsg}`, [
                { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
            ]);
        } finally {
            cfg.setUploadUiVisible(false);
            cfg.setButtonsBusy(false);
            isImporting = false;
            if (shouldResumeAutoMonitor) startAutoMonitor();
        }
    }

    async function start({ source, mode } = {}) {
        const api = cfg.getApi();
        if (!api) {
            cfg.showModal('Google Drive', 'Synchronizacja jest niedostępna (brak modułu Google Drive).');
            return;
        }

        const execMode = String(mode || 'manual');

        if (isImporting) {
            if (execMode !== 'auto') {
                cfg.setUploadStatusText('Google Drive: trwa synchronizacja plików...');
            }
            return;
        }

        if (hasActiveSession()) {
            if (execMode === 'auto') return;
            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Łączenie z Google Drive...'), [
                { label: 'Anuluj', onClick: () => { try { connectSession.cancel(); } catch { } } }
            ]);
            return;
        }

        const folderIdRoutes = String(cfg.getFolderIdRoutes() || '').trim();
        const folderIdSchedule = String(cfg.getFolderIdSchedule() || '').trim();
        if (!folderIdRoutes) throw new Error('drive-unified-sync-application: brak folderIdRoutes');
        if (!folderIdSchedule) throw new Error('drive-unified-sync-application: brak folderIdSchedule');

        const sessionId = ++connectSeq;
        const abortController = new AbortController();
        const session = {
            id: sessionId,
            cancelled: false,
            abortController,
            cancel: () => {
                if (session.cancelled) return;
                session.cancelled = true;
                try { abortController.abort(); } catch { }
                if (connectSession && connectSession.id === sessionId) connectSession = null;
                try { cfg.logAction?.('sync', { phase: 'cancelled', source: source || 'unknown' }, 'INFO'); } catch { }
            }
        };
        connectSession = session;

        try { cfg.logAction?.('sync', { phase: 'start', folderIdRoutes, folderIdSchedule, source: source || 'unknown', mode: execMode }); } catch { }

        try {
            if (execMode !== 'auto') {
                cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Łączenie z Google Drive...'), [
                    { label: 'Anuluj', onClick: () => session.cancel() }
                ]);
                cfg.setLoadingStatusText('Łączenie z Google Drive...');
            }

            const tokenInfo = await getAccessTokenForMode(api, execMode);
            if (session.cancelled) return;

            if (execMode !== 'auto') {
                cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Przeszukiwanie folderów na Google Drive...'), [
                    { label: 'Anuluj', onClick: () => session.cancel() }
                ]);
                cfg.setLoadingStatusText('Przeszukiwanie folderów...');
            }

            const allFiles = await collectDriveFiles(folderIdRoutes, folderIdSchedule, tokenInfo.token, { signal: abortController.signal });
            if (session.cancelled) return;

            const changed = await computeChanges(allFiles);
            if (session.cancelled) return;

            if (changed.length === 0) {
                if (execMode !== 'auto') {
                    cfg.setLoadingStatusText('Dane aktualne.');
                    cfg.showModal('Google Drive', cfg.buildNoChangesModalHtml(), [
                        { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                    ]);
                }
                return;
            }

            if (execMode === 'auto' && !cfg.canShowModal?.()) return;

            cfg.showModal('Synchronizacja Google Drive', cfg.buildChangesModalHtml(changed), [
                { label: 'Nadpisz zmienione', class: 'modal-btn--primary', onClick: () => applyFiles(changed, tokenInfo.token, { source }) },
                { label: 'Anuluj', onClick: () => { try { cfg.logAction?.('sync', { phase: 'cancelled', source: source || 'unknown' }, 'INFO'); } catch { } } }
            ]);
            try { cfg.initChangesModal?.(changed, tokenInfo.token); } catch { }
        } catch (err) {
            if (session.cancelled || err?.name === 'AbortError') return;

            const msg = err?.message ? String(err.message) : 'Błąd synchronizacji';
            try { cfg.logAction?.('sync', { phase: 'error', message: msg, source: source || 'unknown' }, 'ERROR'); } catch { }
            const safeMsg = typeof cfg.escapeHtml === 'function' ? cfg.escapeHtml(msg) : msg;

            if (execMode !== 'auto') {
                cfg.showModal('Błąd synchronizacji', `Wystąpił błąd podczas łączenia z Google Drive: ${safeMsg}`, [
                    { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                ]);
            } else {
                const code = String(err?.code || err?.message || '');
                const isAuthIssue = code.includes('popup') || code.includes('consent') || code.includes('access_denied') || code.includes('no_token') || code.includes('timeout');
                if (isAuthIssue) autoBackoffUntil = nowMs() + 10 * 60_000;
            }
        } finally {
            if (connectSession && connectSession.id === sessionId) connectSession = null;
        }
    }

    function startAutoMonitor() {
        if (autoTimer !== null) return;
        const ms = Math.max(10_000, Number(cfg.getAutoIntervalMs?.() ?? 60_000) || 60_000);
        autoTimer = window.setInterval(() => {
            if (nowMs() < autoBackoffUntil) return;
            start({ source: 'auto_monitor', mode: 'auto' }).catch(() => { });
        }, ms);
    }

    function stopAutoMonitor() {
        if (autoTimer === null) return;
        try { window.clearInterval(autoTimer); } catch { }
        autoTimer = null;
    }

    return Object.freeze({ start, startAutoMonitor, stopAutoMonitor });
}

function safeCall(fn, fallback) {
    try { return fn(); } catch { return fallback; }
}
