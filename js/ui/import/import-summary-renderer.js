export function createImportSummaryRenderer(cfg) {
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : (x => String(x ?? ''));
    const formatFileName = typeof cfg?.formatFileName === 'function' ? cfg.formatFileName : (x => String(x || ''));
    const now = typeof cfg?.now === 'function' ? cfg.now : (() => Date.now());

    /**
     * Formatuje timestamp w spójnym formacie lokalnym (pl-PL).
     */
    function formatTimestamp(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '-';
        try { return new Date(n).toLocaleString('pl-PL'); } catch { return '-'; }
    }

    /**
     * Prosty pluralizator PL dla słowa „plik”.
     */
    function formatPluralPl(n, one, few, many) {
        const v = Math.abs(Number(n) || 0);
        const mod10 = v % 10;
        const mod100 = v % 100;
        if (v === 1) return one;
        if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
        return many;
    }

    function normalizeEntries(summary) {
        const safe = summary && typeof summary === 'object' ? summary : {};
        const hasNewFiles = Array.isArray(safe.newFiles);
        const hasUpdatedFiles = Array.isArray(safe.updatedFiles);
        const hasRemovedFiles = Array.isArray(safe.removedFiles);
        if (hasNewFiles || hasUpdatedFiles || hasRemovedFiles) {
            return {
                newFiles: hasNewFiles ? safe.newFiles : [],
                updatedFiles: hasUpdatedFiles ? safe.updatedFiles : [],
                removedFiles: hasRemovedFiles ? safe.removedFiles : []
            };
        }
        const files = Array.isArray(safe.files) ? safe.files : [];
        const nextUpdatedAt = now();
        return { newFiles: files.map(name => ({ name, prevUpdatedAt: null, nextUpdatedAt })), updatedFiles: [], removedFiles: [] };
    }

    function buildChipHtml(entry, variant) {
        const safeName = String(entry?.name ?? '').trim();
        if (!safeName) return '';
        const label = escapeHtml(formatFileName(safeName));
        const prevTs = formatTimestamp(entry?.prevUpdatedAt ?? null);
        const nextTs = formatTimestamp(entry?.nextUpdatedAt ?? null);
        const typeLabel = variant === 'updated'
            ? 'Zaktualizowano'
            : (variant === 'removed' ? 'Usunięto lokalnie' : 'Zaimportowano');
        const nextLabel = variant === 'removed' ? 'Status' : 'Teraz';
        const nextValue = variant === 'removed' ? 'Usunięto lokalnie' : nextTs;
        return `<span class="qe-import-chip qe-import-chip--${variant}" data-file-name="${escapeHtml(safeName)}"><span class="qe-import-chip-label">${label}</span><span class="qe-import-chip-tooltip" role="tooltip"><div class="qe-import-chip-tooltip-title">${escapeHtml(typeLabel)}</div><div class="qe-drive-kv"><span class="qe-drive-k">Poprzednio</span><span class="qe-drive-v qe-drive-v--prev">${escapeHtml(prevTs)}</span></div><div class="qe-drive-kv"><span class="qe-drive-k">${escapeHtml(nextLabel)}</span><span class="qe-drive-v qe-drive-v--next">${escapeHtml(nextValue)}</span></div></span></span>`;
    }

    function buildSectionHtml(title, count, entries, variant) {
        const chips = entries.map(e => buildChipHtml(e, variant)).filter(Boolean).join('');
        if (!chips) return '';
        const noun = formatPluralPl(count, 'plik', 'pliki', 'plików');
        return `<section class="qe-import-section qe-import-section--${variant}"><div class="qe-import-section-title">${escapeHtml(title)} <span class="qe-import-count-pill">${escapeHtml(count)}</span> <span class="qe-import-section-sub">${escapeHtml(noun)}</span></div><div class="qe-import-chips" role="list">${chips}</div></section>`;
    }

    function buildHeaderLinesHtml(newCount, updatedCount) {
        const removedCount = Number(arguments[2]) || 0;
        const lines = [];
        if (newCount > 0) lines.push(`<div class="qe-import-summary-hline">Zaimportowano ${escapeHtml(newCount)} ${escapeHtml(formatPluralPl(newCount, 'plik', 'pliki', 'plików'))}</div>`);
        if (updatedCount > 0) lines.push(`<div class="qe-import-summary-hline">Zaktualizowano ${escapeHtml(updatedCount)} ${escapeHtml(formatPluralPl(updatedCount, 'plik', 'pliki', 'plików'))}</div>`);
        if (removedCount > 0) lines.push(`<div class="qe-import-summary-hline">Usunięto lokalnie ${escapeHtml(removedCount)} ${escapeHtml(formatPluralPl(removedCount, 'plik', 'pliki', 'plików'))}</div>`);
        return lines.join('');
    }

    function buildHtml(summary) {
        const safe = summary && typeof summary === 'object' ? summary : {};
        const { newFiles, updatedFiles, removedFiles } = normalizeEntries(safe);
        const newCount = newFiles.length;
        const updatedCount = updatedFiles.length;
        const removedCount = removedFiles.length;
        const errors = Number.isFinite(Number(safe.errors)) ? Number(safe.errors) : 0;
        const records = Number.isFinite(Number(safe.records)) ? Number(safe.records) : 0;

        const headerLines = buildHeaderLinesHtml(newCount, updatedCount, removedCount) || `<div class="qe-import-summary-hline">Import zakończony.</div>`;
        const metaParts = [];
        metaParts.push(`Rekordów: <strong>${escapeHtml(records)}</strong>`);
        metaParts.push(`Błędy: <strong>${escapeHtml(errors)}</strong>`);

        const newSection = newCount > 0 ? buildSectionHtml('Nowe pliki', newCount, newFiles, 'new') : '';
        const updatedSection = updatedCount > 0 ? buildSectionHtml('Nadpisane pliki', updatedCount, updatedFiles, 'updated') : '';
        const removedSection = removedCount > 0 ? buildSectionHtml('Usunięte lokalnie pliki', removedCount, removedFiles, 'removed') : '';

        return `<div class="qe-import-summary" data-qe-import-summary="1"><div class="qe-import-summary-header">${headerLines}<div class="qe-import-summary-meta">${metaParts.join(' • ')}</div></div>${newSection}${updatedSection}${removedSection}</div>`;
    }

    return Object.freeze({ buildHtml });
}

function hashString(value) {
    const s = String(value ?? '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}
