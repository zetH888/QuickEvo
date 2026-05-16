/**
 * @module core/formatters/file-name
 *
 * @description
 * Formatowanie nazw plików do celów UI (czytelna nazwa bez rozszerzenia i adnotacji w nawiasach).
 */
 
/**
 * Czyści nazwę pliku z fragmentów w nawiasach i rozszerzenia.
 *
 * @param {string} fileName
 * @returns {string}
 */
export function formatFileName(fileName) {
    let name = String(fileName ?? '').replace(/\s*\([^)]*\)/g, '');
    name = name.replace(/\.xlsx$/i, '');
    return name.replace(/\s+/g, ' ').trim();
}
