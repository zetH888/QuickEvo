/**
 * @module schedule-drive-sync-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla synchronizacji grafiku z dedykowanego folderu Google Drive.
 *
 * Wspiera:
 * - sprawdzenie, czy istnieje plik grafiku dla bieżącego miesiąca,
 * - porównanie timestampu modyfikacji (Drive) z wartością w IndexedDB,
 * - opcjonalne potwierdzenie nadpisania poprzez modal zgodny z UX synchronizacji tras,
 * - auto-refresh w tle (co określony interwał) wyłącznie, gdy bieżący grafik istnieje w bazie.
 */
export function createScheduleDriveSyncApplication(cfg = {}) {
    const getApi = typeof cfg?.getApi === 'function' ? cfg.getApi : (() => null);
    const getFolderId = typeof cfg?.getFolderId === 'function' ? cfg.getFolderId : (() => '');
    const getIntervalMs = typeof cfg?.getIntervalMs === 'function' ? cfg.getIntervalMs : (() => 60_000);
    const parseScheduleMetaStrictXlsx = typeof cfg?.parseScheduleMetaStrictXlsx === 'function' ? cfg.parseScheduleMetaStrictXlsx : (() => null);
    const formatMonthYearLabel = typeof cfg?.formatMonthYearLabel === 'function' ? cfg.formatMonthYearLabel : (() => '');
    const listDbFiles = typeof cfg?.listDbFiles === 'function' ? cfg.listDbFiles : (async () => []);
    const getDbFileRecord = typeof cfg?.getDbFileRecord === 'function' ? cfg.getDbFileRecord : (async () => null);
    const putDbBlob = typeof cfg?.putDbBlob === 'function' ? cfg.putDbBlob : (async () => { });
    const invalidateScheduleFile = typeof cfg?.invalidateScheduleFile === 'function' ? cfg.invalidateScheduleFile : (() => { });
    const processScheduleFile = typeof cfg?.processScheduleFile === 'function' ? cfg.processScheduleFile : (async () => { });
    const canShowModal = typeof cfg?.canShowModal === 'function' ? cfg.canShowModal : (() => false);
    const showModal = typeof cfg?.showModal === 'function' ? cfg.showModal : (() => { });
    const hideModal = typeof cfg?.hideModal === 'function' ? cfg.hideModal : (() => { });
    const buildChangesModalHtml = typeof cfg?.buildChangesModalHtml === 'function' ? cfg.buildChangesModalHtml : (() => '');
    const initChangesModal = typeof cfg?.initChangesModal === 'function' ? cfg.initChangesModal : (() => { });
    const setButtonsBusy = typeof cfg?.setButtonsBusy === 'function' ? cfg.setButtonsBusy : (() => { });
    const setStatusText = typeof cfg?.setStatusText === 'function' ? cfg.setStatusText : (() => { });
    const logAction = typeof cfg?.logAction === 'function' ? cfg.logAction : (() => { });
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((t) => String(t ?? ''));
    const maxImportBytes = Number.isFinite(Number(cfg?.maxImportBytes)) ? Number(cfg.maxImportBytes) : 5_000_000;
    const formatFileName = typeof cfg?.formatFileName === 'function' ? cfg.formatFileName : null;

    let syncInProgress = false;
    let autoRefreshTimer = null;

    function nowYearMonth(date = new Date()) {
        const d = date instanceof Date ? date : new Date();
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }

    function selectCurrentMonthDriveFile(files, { now = new Date() } = {}) {
        const list = Array.isArray(files) ? files : [];
        const { year, month } = nowYearMonth(now);
        const candidates = [];
        for (const f of list) {
            const name = String(f?.name || '').trim();
            const meta = parseScheduleMetaStrictXlsx(name);
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
                logAction('schedule_drive', {
                    phase: 'multiple_candidates',
                    count: candidates.length,
                    chosen: String(candidates[0]?.name || ''),
                    candidates: candidates.slice(0, 6).map(c => String(c?.name || '')).filter(Boolean)
                }, 'WARN');
            } catch { }
        }
        return candidates[0];
    }

    async function getCurrentMonthScheduleDbName({ now = new Date() } = {}) {
        const { year, month } = nowYearMonth(now);
        const all = await listDbFiles();
        const names = Array.isArray(all) ? all.map(f => String(f?.name ?? '')).filter(Boolean) : [];
        for (const name of names) {
            const meta = parseScheduleMetaStrictXlsx(name);
            if (!meta) continue;
            if (meta.year === year && meta.month === month) return name;
        }
        return '';
    }

    async function importDriveFileToDb(driveFile, token, { source } = {}) {
        const api = getApi();
        const id = String(driveFile?.id || '').trim();
        const name = String(driveFile?.name || '').trim();
        if (!api) throw new Error('Moduł Google Drive jest niedostępny');
        if (!id || !name) throw new Error('Nieprawidłowe metadane pliku grafiku');

        const displayName = formatFileName ? formatFileName(name) : name;
        try { setStatusText(`Pobieranie grafiku: ${displayName}...`); } catch { }

        const buffer = await api.downloadFileArrayBuffer(id, token);
        if (Number(buffer?.byteLength || 0) > maxImportBytes) throw new Error('Plik grafiku przekracza limit 5MB');

        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        await putDbBlob(name, blob, { driveModifiedAt: driveFile?.driveModifiedAt ?? null });

        invalidateScheduleFile(name);
        await processScheduleFile(name);
        try { logAction('schedule_drive', { phase: 'imported', fileName: name, source: source || 'unknown' }, 'INFO'); } catch { }
    }

    async function syncNow({ source, uiMode } = {}) {
        const api = getApi();
        if (!api) return;
        if (syncInProgress) return;
        syncInProgress = true;
        setButtonsBusy(true);

        try {
            const folderId = String(getFolderId() || '').trim();
            if (!folderId) throw new Error('schedule-drive-sync: brak folderId');

            const mode = String(uiMode || 'background');
            const interactive = (mode === 'modal' || mode === 'status');

            if (interactive) {
                try { setStatusText('Łączenie z Google Drive (grafik)...'); } catch { }
            }

            const token = await api.getAccessToken();

            if (interactive) {
                try { setStatusText('Sprawdzanie grafiku w folderze Google Drive...'); } catch { }
            }

            const files = await api.listFolderFilesShallow(folderId, token);
            const current = selectCurrentMonthDriveFile(files);

            if (!current) {
                try { logAction('schedule_drive', { phase: 'not_found', source: source || 'unknown' }, 'WARN'); } catch { }
                if (mode === 'modal' && canShowModal()) {
                    showModal('Google Drive — Grafik', 'Nie znaleziono pliku grafiku na bieżący miesiąc (format: „MIASTO MIESIĄC ROK.xlsx”).', [
                        { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                    ]);
                }
                return;
            }

            const name = String(current?.name || '').trim();
            const record = await getDbFileRecord(name);
            const prev = Number(record?.driveModifiedAt);
            const next = Number(current?.driveModifiedAt);
            const hasPrev = Number.isFinite(prev) && prev > 0;
            const hasNext = Number.isFinite(next) && next > 0;

            if (record && hasPrev && hasNext && prev === next) {
                try { logAction('schedule_drive', { phase: 'up_to_date', fileName: name, source: source || 'unknown' }, 'INFO'); } catch { }
                if (interactive) {
                    try { setStatusText('Grafik aktualny.'); } catch { }
                }
                return;
            }

            const meta = current?._scheduleMeta || parseScheduleMetaStrictXlsx(name);
            const label = meta ? formatMonthYearLabel(meta) : '';
            const modalLabel = label ? `Zmiany w grafiku: ${label}` : 'Zmiany w grafiku';

            if (interactive && canShowModal()) {
                const changedItem = {
                    id: String(current?.id || ''),
                    name,
                    driveModifiedAt: current?.driveModifiedAt ?? null,
                    previousDriveModifiedAt: hasPrev ? prev : null,
                    changeReason: modalLabel,
                    isNewInDb: false,
                    diffDisabledLabel: modalLabel,
                    diffDisabledStatus: 'check'
                };

                showModal('Synchronizacja Google Drive — Grafik', buildChangesModalHtml([changedItem]), [
                    {
                        label: 'Nadpisz zmienione',
                        class: 'modal-btn--primary',
                        onClick: async () => {
                            try {
                                hideModal();
                                await importDriveFileToDb(current, token, { source: source || 'unknown' });
                                try { await startAutoRefreshIfEligible({ reason: 'manual_sync' }); } catch { }
                            } catch (err) {
                                const msg = err?.message ? String(err.message) : 'Błąd synchronizacji grafiku';
                                try { logAction('schedule_drive', { phase: 'overwrite_failed', fileName: name, message: msg }, 'ERROR'); } catch { }
                                showModal('Błąd — Google Drive (Grafik)', `Wystąpił błąd podczas synchronizacji grafiku: ${escapeHtml(msg)}`, [
                                    { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                                ]);
                            }
                        }
                    },
                    { label: 'Anuluj', onClick: () => { } }
                ]);

                try { initChangesModal([changedItem], token); } catch { }
                return;
            }

            if (interactive) {
                try { logAction('schedule_drive', { phase: 'modal_suppressed', reason: 'modal_not_available', fileName: name, source: source || 'unknown' }, 'WARN'); } catch { }
            }
        } catch (err) {
            const msg = err?.message ? String(err.message) : 'Błąd synchronizacji grafiku';
            try { logAction('schedule_drive', { phase: 'error', source: source || 'unknown', message: msg }, 'ERROR'); } catch { }
            if (String(uiMode || 'background') === 'modal' && canShowModal()) {
                showModal('Błąd — Google Drive (Grafik)', `Wystąpił błąd podczas synchronizacji grafiku: ${escapeHtml(msg)}`, [
                    { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                ]);
            }
        } finally {
            setButtonsBusy(false);
            syncInProgress = false;
        }
    }

    async function startAutoRefreshIfEligible({ reason } = {}) {
        if (autoRefreshTimer !== null) return;
        const existingName = await getCurrentMonthScheduleDbName();
        if (!existingName) return;
        const ms = Math.max(5_000, Number(getIntervalMs()) || 60_000);

        autoRefreshTimer = window.setInterval(() => {
            tickAutoRefresh().catch(() => { });
        }, ms);

        try { logAction('schedule_drive', { phase: 'auto_refresh_started', reason: String(reason || 'unknown'), fileName: existingName }, 'INFO'); } catch { }
    }

    function stopAutoRefresh({ reason } = {}) {
        if (autoRefreshTimer === null) return;
        try { window.clearInterval(autoRefreshTimer); } catch { }
        autoRefreshTimer = null;
        try { logAction('schedule_drive', { phase: 'auto_refresh_stopped', reason: String(reason || 'unknown') }, 'INFO'); } catch { }
    }

    async function tickAutoRefresh() {
        const existingName = await getCurrentMonthScheduleDbName();
        if (!existingName) {
            stopAutoRefresh({ reason: 'no_current_month_file_in_db' });
            return;
        }

        const api = getApi();
        if (!api) return;

        const token = await api.getAccessTokenSilent?.();
        if (!token) {
            try { logAction('schedule_drive', { phase: 'auto_refresh_no_token', fileName: existingName }, 'WARN'); } catch { }
            return;
        }

        const folderId = String(getFolderId() || '').trim();
        if (!folderId) return;

        const files = await api.listFolderFilesShallow(folderId, token);
        const current = selectCurrentMonthDriveFile(files);
        if (!current) return;

        const name = String(current?.name || '').trim();
        const record = await getDbFileRecord(name);
        const prev = Number(record?.driveModifiedAt);
        const next = Number(current?.driveModifiedAt);
        const hasPrev = Number.isFinite(prev) && prev > 0;
        const hasNext = Number.isFinite(next) && next > 0;
        const needsUpdate = (!record) || !hasPrev || (hasNext && next !== prev);

        if (!hasNext || !needsUpdate) return;

        await importDriveFileToDb(current, token, { source: 'auto_refresh' });
        try { logAction('schedule_drive', { phase: 'auto_refreshed', fileName: name, previousDriveModifiedAt: hasPrev ? prev : null, nextDriveModifiedAt: next }, 'INFO'); } catch { }
    }

    return Object.freeze({
        syncNow,
        startAutoRefreshIfEligible,
        stopAutoRefresh
    });
}
