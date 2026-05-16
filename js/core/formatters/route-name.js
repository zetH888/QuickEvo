/**
 * @module core/formatters/route-name
 *
 * @description
 * Formatowanie nazwy trasy na potrzeby listy wyników.
 */
 
/**
 * Formatuje nazwę trasy dla listy wyników.
 *
 * @param {string} fileName
 * @returns {string}
 */
export function formatRouteNameForResults(fileName) {
    const base = String(fileName || '').replace(/\.xlsx$/i, '').replace(/\s+/g, ' ').trim();
    const match = base.match(/\btrasa\b\s*([A-Za-zĄĆĘŁŃÓŚŹŻ0-9]+(?:\s*[-–]\s*\d+)?)\b/i);
    if (match && match[1]) {
        const code = match[1].replace(/\s*[-–]\s*/g, '-').replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻ0-9-]/g, '').toUpperCase();
        if (code) return `TRASA ${code}`;
    }
    return base.replace(/[\[\]\{\}]/g, '').replace(/\([^)]*\)/g, '').replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, '').replace(/[^\p{L}\p{N}\s-]+/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
}
