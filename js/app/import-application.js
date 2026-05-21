/**
 * @module import-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla importu plików w QuickEvo.
 *
 * Cel:
 * - trzymać logikę „przepływu” importu (import-service + finalizacja),
 * - pozostawić `app.js` jako wiring/UI (adaptery DOM, renderery, obsługa eventów),
 * - ułatwić testowanie i dalszą dekompozycję.
 */

/**
 * Tworzy serwis aplikacyjny odpowiedzialny za import lokalny oraz finalizację importu.
 *
 * @param {Object} cfg
 * @param {(files: any, cfg: any) => Promise<({files: string[], records: number, errors: number} | null)>} cfg.importLocalFiles
 * @param {number} cfg.maxImportBytes
 * @param {(name: string) => Promise<boolean>} cfg.fileExists
 * @param {(name: string) => Promise<({ name: string, size: number, updatedAt: number, driveModifiedAt: (number|null) } | null)>} [cfg.getFileRecord]
 * @param {(ctx: { files: any[], conflicts: any[] }) => Promise<any[]>} cfg.resolveConflicts
 * @param {(r: { name: string, reason: string }) => void} cfg.onRejected
 * @param {(loading: boolean, total?: number) => void} cfg.onLoadingState
 * @param {(text: string) => void} cfg.onStatusText
 * @param {(value: number, meta?: any) => void} cfg.onProgress
 * @param {(name: string, blob: any) => Promise<void>} cfg.putBlob
 * @param {(name: string) => void} cfg.removeFileData
 * @param {(name: string) => boolean} cfg.isScheduleFileName
 * @param {(name: string) => void} cfg.invalidateScheduleFile
 * @param {Set<string>} cfg.loadedFiles
 * @param {(name: string) => Promise<void>} cfg.processScheduleFile
 * @param {(name: string) => Promise<void>} cfg.processFile
 * @param {(name: string) => string} cfg.formatFileName
 * @param {(ctx: { fileName: string, error: any }) => void} cfg.onFileError
 * @param {() => number} cfg.getAllDataLength
 * @param {(enabled: boolean) => void} cfg.setSearchEnabled
 * @param {() => string} cfg.getLastQuery
 * @param {() => boolean} cfg.getIsSearchEnabled
 * @param {(query: string) => void} cfg.performSearch
 * @param {(opts: { reason: string }) => void} cfg.schedulePredictiveIndexRebuild
 * @param {(summary: any) => void} cfg.displayImportSummary
 * @param {() => Promise<void>} cfg.refreshFileCount
 * @param {(value: number) => void} [cfg.setUploadProgressValue]
 * @param {(text: string) => void} [cfg.setUploadStatusText]
 * @param {(action: string, payload?: any, level?: string) => void} cfg.logAction
 */
export function createImportApplication(cfg) {
    if (!cfg || typeof cfg.importLocalFiles !== 'function') throw new Error('import-application: brak importLocalFiles');

    /**
     * Importuje pliki z dysku oraz wykonuje finalizację (UI + indeksy).
     *
     * @param {any} files
     * @returns {Promise<({files: string[], records: number, errors: number} | null)>}
     */
    async function importLocal(files) {
        const before = safeNumber(cfg.getAllDataLength?.(), 0);

        const summary = await cfg.importLocalFiles(files, {
            maxImportBytes: cfg.maxImportBytes,
            fileExists: cfg.fileExists,
            getFileRecord: cfg.getFileRecord,
            resolveConflicts: cfg.resolveConflicts,
            onRejected: cfg.onRejected,
            onLoadingState: cfg.onLoadingState,
            onStatusText: cfg.onStatusText,
            onProgress: cfg.onProgress,
            putBlob: cfg.putBlob,
            removeFileData: cfg.removeFileData,
            isScheduleFileName: cfg.isScheduleFileName,
            invalidateScheduleFile: cfg.invalidateScheduleFile,
            loadedFiles: cfg.loadedFiles,
            processScheduleFile: cfg.processScheduleFile,
            processFile: cfg.processFile,
            formatFileName: cfg.formatFileName,
            onFileError: cfg.onFileError
        });

        if (!summary) return null;
        await finalizeImport(summary, before);
        return summary;
    }

    /**
     * Finalizuje import (wspólne dla importu lokalnego i Google Drive).
     *
     * @param {{ files: string[], records: number, errors: number }} summary
     * @param {number} before
     * @returns {Promise<void>}
     */
    async function finalizeImport(summary, before) {
        const after = safeNumber(cfg.getAllDataLength?.(), 0);
        const base = summary && typeof summary === 'object' ? summary : { files: [], records: 0, errors: 0 };
        base.records = Math.max(0, after - safeNumber(before, 0));

        try { cfg.setUploadProgressValue?.(100); } catch { }
        try { cfg.setUploadStatusText?.('Import zakończony.'); } catch { }
        try { cfg.logAction?.('import', { files: base.files?.length || 0, records: base.records, errors: base.errors }, 'INFO'); } catch { }

        try { cfg.displayImportSummary?.(base); } catch { }
        try { await cfg.refreshFileCount?.(); } catch { }

        try { cfg.setSearchEnabled?.(after > 0); } catch { }
        const q = String(cfg.getLastQuery?.() || '').trim();
        if (q.length >= 3 && Boolean(cfg.getIsSearchEnabled?.())) {
            try { cfg.performSearch?.(q); } catch { }
        }

        try { cfg.schedulePredictiveIndexRebuild?.({ reason: 'import_done' }); } catch { }
    }

    return Object.freeze({ importLocal, finalizeImport });
}

function safeNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
