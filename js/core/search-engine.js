/**
 * @module search-engine
 *
 * @description
 * Moduł odpowiedzialny za wyszukiwanie, dopasowanie oraz grupowanie wyników.
 * Zawiera wyłącznie logikę przetwarzania danych (bez bezpośredniego dostępu do DOM),
 * dzięki czemu może być testowany i wykorzystywany przez różne kontrolery UI.
 *
 * @zaleznosci
 * - utils.js — normalizacja tekstu.
 *
 * @publicznyInterfejs
 * - executeSearch — wykonuje wyszukiwanie z cache i grupowaniem.
 * - matchItem — logika dopasowania pojedynczego rekordu.
 * - groupSearchResults — grupowanie wyników po nazwie pliku.
 * - compileKeyLabTokenSets / rowMatchesKeyLab — reguły wykrywania wierszy „laboratorium”.
 */
 
import { KEY_LAB_TOKEN_SETS as CONFIG_KEY_LAB_TOKEN_SETS } from '../config/constants.js';
import { fuzzyNormalizeText, normalizeText } from './utils.js';
 
/**
 * Zestawy tokenów do wykrywania wierszy związanych z laboratorium.
 *
 * Źródło konfiguracji: js/config/constants.js (łatwiejsza edycja bez grzebania w logice).
 * Ten eksport jest zachowany dla kompatybilności z istniejącymi wywołaniami (np. app.js, testy).
 *
 * @type {ReadonlyArray<ReadonlyArray<string>>}
 */
export const KEY_LAB_TOKEN_SETS = CONFIG_KEY_LAB_TOKEN_SETS;
 
/**
 * Kompiluje zestawy tokenów dla laboratoriów.
 * Wynik jest odporny na polskie znaki diakrytyczne oraz dodatkowe separatory.
 *
 * @param {Array<Array<string>>} tokenSets
 * @returns {Array<Array<string>>}
 */
export function compileKeyLabTokenSets(tokenSets) {
    const compiled = [];
    const sets = Array.isArray(tokenSets) ? tokenSets : [];
    for (const entry of sets) {
        const phrase = Array.isArray(entry) ? entry.join(' ') : String(entry ?? '');
        const normalized = fuzzyNormalizeText(phrase).replace(/[^a-z0-9]+/g, ' ').trim();
        if (!normalized) continue;
        const tokens = normalized.split(/\s+/g).filter(Boolean);
        const collapsed = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] && tokens[i + 1] && tokens[i].length === 1 && tokens[i + 1].length === 1) {
                collapsed.push(tokens[i] + tokens[i + 1]);
                i += 1;
                continue;
            }
            collapsed.push(tokens[i]);
        }
        const unique = Array.from(new Set(collapsed.filter(Boolean)));
        if (unique.length > 0) compiled.push(unique);
    }
    return compiled;
}
 
/**
 * Sprawdza, czy tekst pasuje do reguł „laboratorium”.
 *
 * @param {unknown} text
 * @param {Array<Array<string>>} compiledTokenSets
 * @returns {boolean}
 */
export function rowMatchesKeyLab(text, compiledTokenSets) {
    const normalized = fuzzyNormalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized) return false;
    const tokens = normalized.split(/\s+/g).filter(Boolean);
    if (tokens.length === 0) return false;
    const tokenSet = new Set(tokens);
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i].length === 1 && tokens[i + 1].length === 1) tokenSet.add(tokens[i] + tokens[i + 1]);
    }
    const sets = Array.isArray(compiledTokenSets) && compiledTokenSets.length > 0
        ? compiledTokenSets
        : compileKeyLabTokenSets(KEY_LAB_TOKEN_SETS);
    for (const requiredTokens of sets) {
        let ok = true;
        for (const token of requiredTokens) {
            if (!tokenSet.has(token)) { ok = false; break; }
        }
        if (ok) return true;
    }
    return false;
}
 
/**
 * Sprawdza, czy element danych pasuje do zapytania.
 *
 * @param {any} item
 * @param {string} lowerQuery
 * @param {string} fuzzyQuery
 * @returns {boolean}
 */
export function matchItem(item, lowerQuery, fuzzyQuery) {
    const matches = Boolean(item?.searchable?.includes(lowerQuery) || item?.searchableFuzzy?.includes(fuzzyQuery));
    if (!matches) return false;
 
    const fileName = String(item?.fileName ?? '');
    if (normalizeText(fileName).includes(lowerQuery) || fuzzyNormalizeText(fileName).includes(fuzzyQuery)) return true;
 
    if (item?.isComplete) {
        const h = item?.headerMap;
        if (!h) return true;
        return Array.isArray(item?.cells) && item.cells.some((cell, idx) => {
            if (idx === h.NR_POL || idx === h.UWAGI) return false;
            const cellText = String(cell ?? '');
            return normalizeText(cellText).includes(lowerQuery) || fuzzyNormalizeText(cellText).includes(fuzzyQuery);
        });
    }
    return true;
}
 
/**
 * Grupuje wyniki wyszukiwania według nazw plików.
 *
 * @param {Array<any>} filtered
 * @param {{ getRouteCategoriesFromFileName: (fileName: string) => any }} deps
 * @returns {Array<{ fileName: string, isComplete: boolean, items: Array<any>, categories: any }>}
 */
export function groupSearchResults(filtered, deps) {
    const list = Array.isArray(filtered) ? filtered : [];
    const getCategories = typeof deps?.getRouteCategoriesFromFileName === 'function'
        ? deps.getRouteCategoriesFromFileName
        : () => [];
    const groups = new Map();
    for (const item of list) {
        const fileName = String(item?.fileName ?? '');
        if (!groups.has(fileName)) {
            groups.set(fileName, {
                fileName,
                isComplete: Boolean(item?.isComplete),
                items: [],
                categories: getCategories(fileName)
            });
        }
        groups.get(fileName).items.push(item);
    }
    return Array.from(groups.values());
}
 
/**
 * Aktualizuje cache wyników wyszukiwania.
 *
 * @param {{ set: (key: string, value: any) => void }} searchCache
 * @param {string} query
 * @param {any} results
 */
export function updateSearchCache(searchCache, query, results) {
    searchCache?.set?.(query, results);
}
 
/**
 * Realizuje niskopoziomowe wyszukiwanie w danych z wykorzystaniem cache LRU.
 *
 * @param {{
 *   query: string,
 *   allData: Array<any>,
 *   searchCache: { has: (key: string) => boolean, get: (key: string) => any, set: (key: string, value: any) => void },
 *   getRouteCategoriesFromFileName: (fileName: string) => any
 * }} args
 * @returns {Promise<any>}
 */
export async function executeSearch(args) {
    const query = String(args?.query ?? '');
    const allData = Array.isArray(args?.allData) ? args.allData : [];
    const searchCache = args?.searchCache;
    const getRouteCategoriesFromFileName = args?.getRouteCategoriesFromFileName;
 
    if (searchCache?.has?.(query)) return searchCache.get(query);
    const lowerQuery = normalizeText(query);
    const fuzzyQuery = fuzzyNormalizeText(query);
    const filtered = allData.filter((item) => matchItem(item, lowerQuery, fuzzyQuery));
    const grouped = groupSearchResults(filtered, { getRouteCategoriesFromFileName });
    updateSearchCache(searchCache, query, grouped);
    return grouped;
}
