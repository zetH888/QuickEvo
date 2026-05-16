/**
 * @module core/formatters/highlight
 *
 * @description
 * Pomocnicze funkcje do podświetlania dopasowań w tekście (HTML).
 */
 
import { escapeHtml, fuzzyNormalizeText } from '../utils.js';
 
/**
 * Podświetla szukane zapytanie w tekście.
 *
 * @param {string} text
 * @param {string} query
 * @returns {string}
 */
export function highlightText(text, query) {
    if (!query) return text;
    const normText = fuzzyNormalizeText(text), normQuery = fuzzyNormalizeText(query);
    if (!normQuery) return text;
    let result = '', lastIdx = 0, idx = normText.indexOf(normQuery);
    while (idx !== -1) {
        result += escapeHtml(text.slice(lastIdx, idx));
        result += `<span class="highlight">${escapeHtml(text.slice(idx, idx + normQuery.length))}</span>`;
        lastIdx = idx + normQuery.length; idx = normText.indexOf(normQuery, lastIdx);
    }
    result += escapeHtml(text.slice(lastIdx)); return result;
}
