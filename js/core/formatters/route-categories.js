/**
 * @module core/formatters/route-categories
 *
 * @description
 * Wykrywanie kategorii trasy (STANDARD/WIECZOREK/SOBOTA/NIEDZIELA) na podstawie nazwy pliku.
 * Zawiera wewnętrzny cache, aby nie powtarzać parsowania nawiasów.
 */
 
import { fuzzyNormalizeText } from '../utils.js';
 
/** @type {Map<string, string[]>} */
const routeCategoryCache = new Map();
 
/**
 * Wykrywa kategorie z nazwy pliku na podstawie adnotacji w nawiasach, np. "(NIEDZIELA ...)".
 *
 * @param {string} fileName
 * @returns {string[]}
 */
export function getRouteCategoriesFromFileName(fileName) {
    const key = String(fileName || '');
    if (routeCategoryCache.has(key)) return routeCategoryCache.get(key);
 
    const bracketParts = [];
    const re = /\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(key)) !== null) {
        const part = String(m[1] || '').trim();
        if (part) bracketParts.push(part);
    }
 
    const found = new Set();
    for (const part of bracketParts) {
        const norm = fuzzyNormalizeText(part);
        if (norm.includes('sobota')) found.add('SOBOTA');
        if (norm.includes('niedziela')) found.add('NIEDZIELA');
        if (norm.includes('wieczorek')) found.add('WIECZOREK');
    }
 
    const out = found.size > 0 ? Array.from(found) : ['STANDARD'];
    routeCategoryCache.set(key, out);
    return out;
}
