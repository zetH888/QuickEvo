const DEFAULT_ALLOWED_EXTENSIONS = Object.freeze(['.xlsx', '.xls', '.csv']);
const DEFAULT_MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function normalizeFilesList(files) {
    if (!files) return [];
    if (Array.isArray(files)) return files;
    if (typeof files.length === 'number') return Array.from(files);
    return [];
}

export function filterImportFiles(files, { maxImportBytes = DEFAULT_MAX_IMPORT_BYTES, allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS } = {}) {
    const accepted = [], rejected = [];
    const list = normalizeFilesList(files);
    const maxBytes = Number(maxImportBytes) > 0 ? Number(maxImportBytes) : DEFAULT_MAX_IMPORT_BYTES;
    const exts = Array.isArray(allowedExtensions) && allowedExtensions.length > 0 ? allowedExtensions.map(e => String(e || '').toLowerCase()) : DEFAULT_ALLOWED_EXTENSIONS;

    for (const f of list) {
        const name = String(f?.name || '');
        const lower = name.toLowerCase();
        const okExt = exts.some(ext => lower.endsWith(ext));
        const okSize = Number(f?.size || 0) <= maxBytes;
        if (!okExt) rejected.push({ name, reason: 'extension' });
        else if (!okSize) rejected.push({ name, reason: 'size' });
        else accepted.push(f);
    }
    return { accepted, rejected };
}

async function buildConflictsList(files, fileExists) {
    const list = Array.isArray(files) ? files : [];
    const conflicts = [];
    if (typeof fileExists !== 'function') return conflicts;
    for (const f of list) {
        const name = String(f?.name || '').trim();
        if (!name) continue;
        try {
            if (await fileExists(name)) conflicts.push(f);
        } catch {
            continue;
        }
    }
    return conflicts;
}

export async function importLocalFiles(files, cfg = {}) {
    const list = normalizeFilesList(files);
    if (list.length === 0) return null;

    const { accepted, rejected } = filterImportFiles(list, {
        maxImportBytes: cfg.maxImportBytes,
        allowedExtensions: cfg.allowedExtensions
    });

    for (const r of rejected) {
        try { cfg.onRejected?.(r); } catch { }
    }
    if (accepted.length === 0) return null;

    const conflicts = await buildConflictsList(accepted, cfg.fileExists);
    const hasConflicts = conflicts.length > 0;

    let toImport = accepted;
    if (hasConflicts) {
        if (typeof cfg.resolveConflicts === 'function') {
            try {
                const resolved = await cfg.resolveConflicts({ files: accepted, conflicts });
                toImport = Array.isArray(resolved) ? resolved : [];
            } catch {
                toImport = [];
            }
        }
    }

    if (toImport.length === 0) return null;

    const summary = { files: [], records: 0, errors: rejected.length };
    try {
        try { cfg.onLoadingState?.(true, toImport.length); } catch { }

        let processed = 0;
        for (const file of toImport) {
            const name = String(file?.name || '').trim();
            if (!name) { processed += 1; continue; }

            try {
                const label = typeof cfg.formatFileName === 'function' ? cfg.formatFileName(name) : name;
                cfg.onStatusText?.(`Importuję: ${label}`);
            } catch { }

            try {
                const progress = Math.max(0, Math.min(95, (processed / toImport.length) * 100));
                cfg.onProgress?.(progress, { processed, total: toImport.length, fileName: name });
            } catch { }

            try {
                await cfg.putBlob?.(name, file);
                try { cfg.removeFileData?.(name); } catch { }

                const isSchedule = Boolean(cfg.isScheduleFileName?.(name));
                if (isSchedule) {
                    try { cfg.invalidateScheduleFile?.(name); } catch { }
                    await cfg.processScheduleFile?.(name);
                } else {
                    try { cfg.loadedFiles?.delete?.(name); } catch { }
                    await cfg.processFile?.(name);
                    try { cfg.loadedFiles?.add?.(name); } catch { }
                }

                summary.files.push(name);
            } catch (err) {
                summary.errors += 1;
                try { cfg.onFileError?.({ fileName: name, error: err }); } catch { }
            } finally {
                processed += 1;
            }
        }
    } finally {
        try { cfg.onLoadingState?.(false, 0); } catch { }
    }

    return summary;
}
