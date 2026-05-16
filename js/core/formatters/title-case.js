/**
 * @module core/formatters/title-case
 *
 * @description
 * Formatowanie tekstu do postaci Title Case (pierwsza litera słowa wielka).
 */
 
/**
 * Formatuje tekst do postaci Title Case.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function toTitleCase(text) {
    if (!text) return '';
    return String(text).toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
