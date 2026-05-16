/**
 * @module drive-sync-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla synchronizacji Google Drive w QuickEvo.
 *
 * Cel:
 * - wydzielenie orkiestracji synchronizacji z `app.js`,
 * - utrzymanie `app.js` jako adaptera UI (DOM, renderery, HTML modali),
 * - zachowanie 100% kompatybilności zachowania.
 */

/**
 * Tworzy serwis aplikacyjny odpowiedzialny za pełny flow synchronizacji:
 * 1) pobranie tokenu,
 * 2) crawl folderu,
 * 3) analiza zmian względem IndexedDB,
 * 4) import wybranych plików,
 * 5) finalizacja importu.
 *
 * @param {Object} cfg
 * @param {() => any} cfg.getApi
 * @param {() => string} cfg.getFolderId
 * @param {number} cfg.maxImportBytes
 * @param {() => Promise<Array<{name:string}>>} cfg.listDbFiles
 * @param {(name: string) => Promise<any|null>} cfg.getDbFileRecord
 * @param {(name: string, blob: Blob, meta?: any) => Promise<void>} cfg.putDbBlob
 * @param {(fileName: string) => void} cfg.removeFileData
 * @param {(fileName: string) => boolean} cfg.isScheduleFileName
 * @param {(fileName: string) => void} cfg.invalidateScheduleFile
 * @param {(fileName: string) => Promise<void>} cfg.processScheduleFile
 * @param {(fileName: string) => Promise<void>} cfg.processFile
 * @param {Set<string>} cfg.loadedFiles
 * @param {() => number} cfg.getAllDataLength
 * @param {(summary: {files: string[], records: number, errors: number}, before: number) => Promise<void>} cfg.finalizeImport
 * @param {(action: string, payload?: any, level?: string) => void} cfg.logAction
 * @param {(text: string) => string} cfg.escapeHtml
 * @param {(stageText: string) => string} cfg.buildConnectingModalHtml
 * @param {() => string} cfg.buildNoChangesModalHtml
 * @param {(changed: any[]) => string} cfg.buildChangesModalHtml
 * @param {(title: string, html: string, actions?: any[]) => void} cfg.showModal
 * @param {() => void} cfg.hideModal
 * @param {(text: string) => void} cfg.setLoadingStatusText
 * @param {(text: string, opts?: any) => void} cfg.setUploadStatusText
 * @param {(value: number) => void} cfg.setUploadProgressValue
 * @param {(value: number, metaText?: string) => void} cfg.setLoadingProgress
 * @param {(visible: boolean, total?: number) => void} cfg.setUploadUiVisible
 * @param {(busy: boolean) => void} cfg.setButtonsBusy
 * @param {(files: any[], token: string) => void} cfg.initChangesModal
 * @param {(name: string) => string} cfg.formatFileName
 * @param {() => boolean} cfg.isWelcomeVisible
 * @param {() => void} cfg.prepareWelcomeProgressList
 * @param {(name: string) => any} cfg.createWelcomeItem
 * @param {(item: any) => void} cfg.appendWelcomeItem
 * @param {(item: any) => void} cfg.scrollWelcomeItemIntoView
 * @param {(item: any, percent: number, label: string, opts?: any) => void} cfg.updateWelcomeItem
 * @param {() => boolean} cfg.shouldDeferWelcomeUpdates
 * @param {(list: any[], concurrency: number, worker: (x: any) => Promise<void>) => Promise<void>} cfg.runWithConcurrency
 */
export function createDriveSyncApplication(cfg) {
    if (!cfg || typeof cfg.getApi !== 'function') throw new Error('drive-sync-application: brak getApi');

    let isImporting = false;
    let connectSession = null;
    let connectSeq = 0;

    function hasActiveSession() {
        return Boolean(connectSession && !connectSession.cancelled);
    }

    async function start({ source } = {}) {
        const api = cfg.getApi();
        if (!api) {
            cfg.showModal('Google Drive', 'Synchronizacja jest niedostępna (brak modułu Google Drive).');
            return;
        }

        if (isImporting) {
            cfg.showModal('Google Drive', 'Trwa synchronizacja plików. Poczekaj na zakończenie bieżącej operacji.');
            return;
        }

        if (hasActiveSession()) {
            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Łączenie z Google Drive...'), [
                { label: 'Anuluj', onClick: () => { try { connectSession.cancel(); } catch { } } }
            ]);
            return;
        }

        const folderId = String(cfg.getFolderId() || '').trim();
        if (!folderId) throw new Error('drive-sync-application: brak folderId');

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

        try { cfg.logAction?.('sync', { phase: 'start', folderId, source: source || 'unknown' }); } catch { }

        try {
            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Łączenie z Google Drive...'), [
                { label: 'Anuluj', onClick: () => session.cancel() }
            ]);
            cfg.setLoadingStatusText('Łączenie z Google Drive...');

            const token = await api.getAccessToken();
            if (session.cancelled) return;

            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Przeszukiwanie folderu na Google Drive...'), [
                { label: 'Anuluj', onClick: () => session.cancel() }
            ]);
            cfg.setLoadingStatusText('Przeszukiwanie folderów...');

            const files = await api.crawlFolder(folderId, token, { signal: abortController.signal });
            if (session.cancelled) return;

            if (!Array.isArray(files) || files.length === 0) {
                cfg.showModal('Google Drive', 'Nie znaleziono żadnych plików .xlsx/.xls w wskazanym folderze Google Drive.', [
                    { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                ]);
                return;
            }

            const existing = await cfg.listDbFiles();
            if (session.cancelled) return;

            if (!Array.isArray(existing) || existing.length === 0) {
                cfg.hideModal();
                await processFiles(files, token, { source });
                return;
            }

            cfg.showModal('Google Drive', cfg.buildConnectingModalHtml('Analiza zmian...'), [
                { label: 'Anuluj', onClick: () => session.cancel() }
            ]);

            const changed = [];
            await cfg.runWithConcurrency(files, 8, async (file) => {
                const name = String(file?.name || '').trim();
                if (!name) return;

                const record = await cfg.getDbFileRecord(name);
                if (!record) {
                    changed.push({ ...file, changeReason: 'Nowy plik', previousDriveModifiedAt: null, isNewInDb: true });
                    return;
                }

                const prev = Number(record?.driveModifiedAt);
                const next = Number(file?.driveModifiedAt);

                if (!Number.isFinite(prev) || prev <= 0) {
                    changed.push({ ...file, changeReason: 'Brak zapisanej daty poprzedniej synchronizacji', previousDriveModifiedAt: null, isNewInDb: false });
                    return;
                }
                if (!Number.isFinite(next) || next <= 0) {
                    changed.push({ ...file, changeReason: 'Brak daty modyfikacji z Google Drive', previousDriveModifiedAt: prev, isNewInDb: false });
                    return;
                }
                if (next > prev) {
                    changed.push({ ...file, changeReason: 'Nowsza wersja na Google Drive', previousDriveModifiedAt: prev, isNewInDb: false });
                }
            });

            changed.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'pl', { sensitivity: 'base' }));

            if (changed.length === 0) {
                cfg.setLoadingStatusText('Dane aktualne.');
                cfg.showModal('Google Drive', cfg.buildNoChangesModalHtml(), [
                    { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
                ]);
                return;
            }

            cfg.showModal('Synchronizacja Google Drive', cfg.buildChangesModalHtml(changed), [
                { label: 'Nadpisz zmienione', class: 'modal-btn--primary', onClick: () => processFiles(changed, token, { source }) },
                { label: 'Anuluj', onClick: () => { try { cfg.logAction?.('sync', { phase: 'cancelled', source: source || 'unknown' }); } catch { } } }
            ]);
            try { cfg.initChangesModal?.(changed, token); } catch { }
        } catch (err) {
            if (session.cancelled || err?.name === 'AbortError') return;
            const msg = err?.message ? String(err.message) : 'Błąd synchronizacji';
            try { cfg.logAction?.('sync', { phase: 'error', message: msg }, 'ERROR'); } catch { }
            const safeMsg = typeof cfg.escapeHtml === 'function' ? cfg.escapeHtml(msg) : msg;
            cfg.showModal('Błąd synchronizacji', `Wystąpił błąd podczas łączenia z Google Drive: ${safeMsg}`, [
                { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
            ]);
        } finally {
            if (connectSession && connectSession.id === sessionId) connectSession = null;
        }
    }

    async function processFiles(files, token, { source } = {}) {
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
                    if (cfg.isScheduleFileName(name)) {
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
        }
    }

    return Object.freeze({ start });
}

function safeCall(fn, fallback) {
    try { return fn(); } catch { return fallback; }
}
