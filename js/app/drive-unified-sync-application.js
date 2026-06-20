export function createDriveUnifiedSyncApplication(cfg) {
    if (!cfg || typeof cfg.getApi !== 'function') throw new Error('drive-unified-sync-application: brak getApi');

    let isImporting = false;
    let connectSession = null;
    let connectSeq = 0;
    let pendingManualRequest = null;
    let pendingManualRunScheduled = false;

    function hasActiveSession() {
        return Boolean(connectSession && !connectSession.cancelled);
    }

    function nowMs() {
        return Date.now();
    }

    function schedulePendingManualRun(delayMs = 0) {
        if (pendingManualRunScheduled) return;
        pendingManualRunScheduled = true;
        window.setTimeout(() => {
            pendingManualRunScheduled = false;
            const req = pendingManualRequest;
            if (!req) return;

            const enqueuedAt = Number(req?.enqueuedAt);
            const ageMs = Number.isFinite(enqueuedAt) ? Math.max(0, nowMs() - enqueuedAt) : 0;
            if (ageMs > 30_000) {
                pendingManualRequest = null;
                try {
                    cfg.showModal?.('Google Drive', 'Nie udało się uruchomić kolejnej synchronizacji. Spróbuj ponownie.');
                } catch { }
                return;
            }

            if (isImporting || hasActiveSession()) {
                const prevDelay = Number(req?.retryDelayMs);
                const nextDelay = Math.min(750, Math.max(50, Number.isFinite(prevDelay) ? prevDelay : 50) * 2);
                pendingManualRequest = { ...req, retryDelayMs: nextDelay };
                schedulePendingManualRun(nextDelay);
                return;
            }

            pendingManualRequest = null;
            start({ source: req?.source || 'unknown' }).catch(() => { });
        }, Math.max(0, Number(delayMs) || 0));
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

    /**
     * Sprawdza, czy wpis reprezentuje lokalne usunięcie pliku,
     * bo plik zniknął już z Google Drive.
     *
     * @param {any} file
     * @returns {boolean}
     */
    function isLocalDeleteChange(file) {
        return Boolean(file?.isDeletedOnDrive) || String(file?.qeAction || '').trim() === 'delete_local';
    }

    /**
     * Filtruje wpisy wymagające lokalnego usunięcia.
     *
     * @param {any[]} files
     * @returns {any[]}
     */
    function getLocalDeleteChanges(files) {
        const list = Array.isArray(files) ? files : [];
        return list.filter(isLocalDeleteChange);
    }

    /**
     * Otwiera modal potwierdzający lokalne usunięcie plików, które zniknęły z Drive.
     *
     * @param {any[]} files
     * @param {string} token
     * @param {{ source?: string }} opts
     * @returns {void}
     */
    function confirmLocalDeletes(files, token, { source } = {}) {
        const removals = getLocalDeleteChanges(files);
        if (removals.length === 0) {
            applyFiles(files, token, { source });
            return;
        }

        const buildHtml = typeof cfg.buildDeletionConfirmationModalHtml === 'function'
            ? cfg.buildDeletionConfirmationModalHtml
            : (() => 'Te pliki zostaną usunięte lokalnie.');

        cfg.showModal('Potwierdź lokalne usunięcie', buildHtml(removals), [
            { label: 'Usuń lokalnie i synchronizuj', class: 'modal-btn--primary', onClick: () => applyFiles(files, token, { source }) },
            {
                label: 'Wróć',
                onClick: () => {
                    showChangesModal(files, token, { source });
                }
            }
        ]);
    }

    /**
     * Otwiera główny modal zmian wykrytych podczas synchronizacji Google Drive.
     *
     * @param {any[]} files
     * @param {string} token
     * @param {{ source?: string }} opts
     * @returns {void}
     */
    function showChangesModal(files, token, { source } = {}) {
        const list = Array.isArray(files) ? files : [];
        const hasDeletes = getLocalDeleteChanges(list).length > 0;
        const primaryLabel = hasDeletes ? 'Zastosuj zmiany' : 'Nadpisz zmienione';

        cfg.showModal('Synchronizacja Google Drive', cfg.buildChangesModalHtml(list), [
            {
                label: primaryLabel,
                class: 'modal-btn--primary',
                onClick: () => {
                    if (hasDeletes) {
                        confirmLocalDeletes(list, token, { source });
                        return;
                    }
                    applyFiles(list, token, { source });
                }
            },
            { label: 'Anuluj', onClick: () => { try { cfg.logAction?.('sync', { phase: 'cancelled', source: source || 'unknown' }, 'INFO'); } catch { } } }
        ]);
        try { cfg.initChangesModal?.(list, token); } catch { }
    }

    async function collectDriveFiles(folderIdRoutes, folderIdSchedule, driverContactsFileId, token, { signal } = {}) {
        const api = cfg.getApi();
        const routesPromise = api.crawlFolder(folderIdRoutes, token, { signal });
        const scheduleAllPromise = api.listFolderFilesShallow(folderIdSchedule, token, { signal });
        const driverContactsPromise = String(driverContactsFileId || '').trim()
            ? api.getFileMetadata(driverContactsFileId, token, { signal }).catch((err) => {
                try {
                    cfg.logAction?.('sync', {
                        phase: 'driver_contacts_metadata_failed',
                        fileId: String(driverContactsFileId || ''),
                        message: err?.message ? String(err.message) : 'Błąd pobierania metadanych pliku kontaktów'
                    }, 'WARN');
                } catch { }
                return null;
            })
            : Promise.resolve(null);

        const [routes, scheduleAll, driverContacts] = await Promise.all([
            routesPromise,
            scheduleAllPromise,
            driverContactsPromise
        ]);
        const schedule = selectCurrentMonthScheduleDriveFile(scheduleAll);
        return { routes, schedule, scheduleAll, driverContacts };
    }

    async function computeChanges({ routes, schedule, scheduleAll, driverContacts }) {
        const dbListRaw = await cfg.listDbFiles();
        const listDb = Array.isArray(dbListRaw) ? dbListRaw : [];
        const dbNames = new Set(listDb.map(r => String(r?.name ?? '').trim()).filter(Boolean));
        const changed = [];

        const routeFiles = Array.isArray(routes) ? routes : [];
        const scheduleFiles = Array.isArray(scheduleAll) ? scheduleAll : [];
        const driverContactsName = String(driverContacts?.name || '').trim();
        const driveNames = new Set([
            ...routeFiles.map((file) => String(file?.name || '').trim()).filter(Boolean),
            ...scheduleFiles.map((file) => String(file?.name || '').trim()).filter(Boolean),
            ...(driverContactsName ? [driverContactsName] : [])
        ]);

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

        for (const record of listDb) {
            const name = String(record?.name ?? '').trim();
            if (!name || driveNames.has(name)) continue;

            const sourceKind = String(record?.sourceKind ?? '').trim();
            const isDriverContacts = sourceKind === 'driver_contacts';
            const isSchedule = sourceKind === 'schedule' || Boolean(cfg.isScheduleFileName?.(name));
            changed.push({
                name,
                id: '',
                qeKind: isDriverContacts ? 'driver_contacts' : (isSchedule ? 'schedule' : 'route'),
                qeAction: 'delete_local',
                isDeletedOnDrive: true,
                isNewInDb: false,
                changeReason: 'Plik usunięty z Google Drive',
                previousDriveModifiedAt: Number(record?.driveModifiedAt ?? 0) || null,
                driveModifiedAt: null
            });
        }

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
                    qeKind: 'schedule'
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

        if (driverContactsName) {
            const record = await cfg.getDbFileRecord(driverContactsName);
            const prev = Number(record?.driveModifiedAt);
            const next = Number(driverContacts?.driveModifiedAt);
            const hasPrev = Number.isFinite(prev) && prev > 0;
            const hasNext = Number.isFinite(next) && next > 0;
            const isUpToDate = Boolean(record && hasPrev && hasNext && prev === next);

            if (!isUpToDate) {
                changed.push({
                    ...driverContacts,
                    changeReason: 'Zmiany w kontaktach kierowców',
                    previousDriveModifiedAt: hasPrev ? prev : null,
                    isNewInDb: !record,
                    qeKind: 'driver_contacts'
                });
            }
        }

        changed.sort((a, b) => {
            const aa = isLocalDeleteChange(a) ? 0 : 1;
            const bb = isLocalDeleteChange(b) ? 0 : 1;
            if (aa !== bb) return aa - bb;
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

        /**
         * Podsumowanie jest używane przez wspólny renderer importu (UI) do rozróżnienia:
         * - nowych plików (pierwszy zapis w IndexedDB),
         * - plików nadpisanych (istniały wcześniej),
         * - plików usuniętych lokalnie po wykryciu braku na Google Drive.
         */
        const summary = { files: [], newFiles: [], updatedFiles: [], removedFiles: [], records: 0, errors: 0 };
        const before = cfg.getAllDataLength();

        try {
            let processed = 0;
            for (const file of list) {
                const name = String(file?.name || '').trim();
                const id = String(file?.id || '').trim();
                if (!name || (!id && !isLocalDeleteChange(file))) { processed += 1; continue; }

                const progressItem = isWelcomeVisible ? safeCall(() => cfg.createWelcomeItem(name), null) : null;
                if (progressItem) {
                    safeCall(() => cfg.appendWelcomeItem(progressItem), undefined);
                    safeCall(() => cfg.scrollWelcomeItemIntoView(progressItem), undefined);
                }

                const displayName = cfg.formatFileName ? cfg.formatFileName(name) : name;

                const percent = list.length > 0 ? (processed / list.length) * 100 : 0;
                cfg.setLoadingProgress(percent, `${Math.round(percent)}%`);
                cfg.setUploadProgressValue(Math.max(0, Math.min(95, percent)));

                let prevUpdatedAt = null;
                let existedBefore = null;
                try {
                    const prevRecord = await cfg.getDbFileRecord(name);
                    existedBefore = !!prevRecord;
                    prevUpdatedAt = Number.isFinite(Number(prevRecord?.updatedAt)) && Number(prevRecord.updatedAt) > 0 ? Number(prevRecord.updatedAt) : null;
                } catch {
                    existedBefore = null;
                }

                try {
                    if (isLocalDeleteChange(file)) {
                        cfg.setLoadingStatusText(`Usuwanie lokalne: ${displayName}...`);
                        cfg.setUploadStatusText({ prefix: 'Usuwam lokalnie: ', content: `${displayName}...` });

                        if (typeof cfg.deleteDbFiles !== 'function') {
                            throw new Error('Brak deleteDbFiles w konfiguracji synchronizacji');
                        }

                        await cfg.deleteDbFiles([name]);
                        cfg.removeFileData(name);

                        if (String(file?.qeKind || '') === 'driver_contacts') {
                            cfg.invalidateDriverContactsFile(name);
                        } else if (String(file?.qeKind || '') === 'schedule' || cfg.isScheduleFileName(name)) {
                            cfg.invalidateScheduleFile(name);
                        } else {
                            try { cfg.loadedFiles?.delete?.(name); } catch { }
                        }

                        summary.files.push(name);
                        summary.removedFiles.push({ name, prevUpdatedAt, nextUpdatedAt: null });
                        if (progressItem) {
                            const defer = Boolean(cfg.shouldDeferWelcomeUpdates?.());
                            safeCall(() => cfg.updateWelcomeItem(progressItem, 100, 'Usunięto lokalnie', { defer }), undefined);
                        }
                        continue;
                    }

                    cfg.setLoadingStatusText(`Pobieranie: ${displayName}...`);
                    cfg.setUploadStatusText({ prefix: 'Pobieram: ', content: `${displayName}...` });
                    const buffer = await api.downloadFileArrayBuffer(id, token);
                    if (Number(buffer?.byteLength || 0) > cfg.maxImportBytes) throw new Error('Plik przekracza limit 5MB');

                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    await cfg.putDbBlob(name, blob, {
                        driveModifiedAt: file?.driveModifiedAt ?? null,
                        sourceKind: String(file?.qeKind || '').trim() || 'route',
                        topLevelFolderName: file?.topLevelFolderName ?? ''
                    });

                    cfg.removeFileData(name);

                    const kind = String(file?.qeKind || '');
                    if (kind === 'driver_contacts') {
                        cfg.invalidateDriverContactsFile(name);
                        await cfg.processDriverContactsFile(name);
                    } else if (kind === 'schedule') {
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
                    /**
                     * Dla Google Drive nie mamy File.lastModified, więc jako „Teraz” pokazujemy timestamp modyfikacji z Drive (jeśli dostępny),
                     * a w przeciwnym razie moment pobrania/zapisu.
                     */
                    const nextUpdatedAt = Number.isFinite(Number(file?.driveModifiedAt)) && Number(file.driveModifiedAt) > 0 ? Number(file.driveModifiedAt) : Date.now();
                    const entry = { name, prevUpdatedAt, nextUpdatedAt };
                    const isNewInDb = file?.isNewInDb === true || (existedBefore === false);
                    if (isNewInDb) summary.newFiles.push(entry);
                    else if (existedBefore === true) summary.updatedFiles.push(entry);
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
        }
    }

    async function start({ source } = {}) {
        const api = cfg.getApi();
        if (!api) {
            cfg.showModal('Google Drive', 'Synchronizacja jest niedostępna (brak modułu Google Drive).');
            return;
        }

        if (isImporting) {
            cfg.setUploadStatusText('Google Drive: trwa synchronizacja plików...');
            return;
        }

        if (hasActiveSession()) {
            pendingManualRequest = { source: source || 'unknown', enqueuedAt: nowMs(), retryDelayMs: 50 };
            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Kończę synchronizację… uruchamiam ponownie'), [
                {
                    label: 'Anuluj',
                    onClick: () => {
                        pendingManualRequest = null;
                        try { connectSession?.cancel?.(); } catch { }
                    }
                }
            ]);
            try { cfg.setLoadingStatusText?.('Kończę synchronizację…'); } catch { }
            return;
        }

        const folderIdRoutes = String(cfg.getFolderIdRoutes() || '').trim();
        const folderIdSchedule = String(cfg.getFolderIdSchedule() || '').trim();
        const driverContactsFileId = String(cfg.getDriverContactsFileId?.() || '').trim();
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

        try { cfg.logAction?.('sync', { phase: 'start', folderIdRoutes, folderIdSchedule, driverContactsFileId, source: source || 'unknown', mode: 'manual' }); } catch { }

        try {
            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Łączenie z Google Drive...'), [
                { label: 'Anuluj', onClick: () => session.cancel() }
            ]);
            cfg.setLoadingStatusText('Łączenie z Google Drive...');

            const token = await api.getAccessToken();
            if (session.cancelled) return;

            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Przeszukiwanie folderów na Google Drive...'), [
                { label: 'Anuluj', onClick: () => session.cancel() }
            ]);
            cfg.setLoadingStatusText('Przeszukiwanie folderów...');

            const allFiles = await collectDriveFiles(folderIdRoutes, folderIdSchedule, driverContactsFileId, token, { signal: abortController.signal });
            if (session.cancelled) return;

            const changed = await computeChanges(allFiles);
            if (session.cancelled) return;

            if (changed.length === 0) {
                cfg.setLoadingStatusText('Dane aktualne.');
                cfg.showModal('Google Drive', cfg.buildNoChangesModalHtml(), [
                    { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                ]);
                return;
            }

            showChangesModal(changed, token, { source });
        } catch (err) {
            if (session.cancelled || err?.name === 'AbortError') return;

            const msg = err?.message ? String(err.message) : 'Błąd synchronizacji';
            try { cfg.logAction?.('sync', { phase: 'error', message: msg, source: source || 'unknown' }, 'ERROR'); } catch { }
            const safeMsg = typeof cfg.escapeHtml === 'function' ? cfg.escapeHtml(msg) : msg;

            cfg.showModal('Błąd synchronizacji', `Wystąpił błąd podczas łączenia z Google Drive: ${safeMsg}`, [
                { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
            ]);
        } finally {
            if (connectSession && connectSession.id === sessionId) connectSession = null;
            if (pendingManualRequest) schedulePendingManualRun();
        }
    }

    return Object.freeze({ start });
}

function safeCall(fn, fallback) {
    try { return fn(); } catch { return fallback; }
}
