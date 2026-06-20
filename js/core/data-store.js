/**
 * @module core/data-store
 *
 * @description
 * Właściciel stanu danych aplikacji (np. allData, indeksy plików, rewizje).
 * Docelowo moduł ten ma przejąć odpowiedzialność za wszystkie kluczowe zmienne stanu,
 * które historycznie były trzymane w `js/entry/app.js`.
 *
 * Ten plik jest wprowadzany etapami (dekompozycja kontrolowana) — najpierw jako
 * izolowany magazyn z czytelnym API, a dopiero później jako źródło prawdy
 * używane przez pozostałe moduły.
 */

/**
 * Tworzy nową instancję magazynu danych.
 *
 * @param {Object} [cfg]
 * @param {Array<Object>} [cfg.initialAllData] Znormalizowane wiersze startowe (np. przy starcie aplikacji).
 * @returns {Readonly<{
 *   getAllData: () => Array<Object>,
 *   setAllData: (rows: Array<Object>) => void,
 *   addRows: (rows: Array<Object>) => void,
 *   reset: () => void,
 *   getLastQuery: () => string,
 *   setLastQuery: (query: string) => void,
 *   clearLastQuery: () => void,
 *   getCurrentResults: () => Array<any>,
 *   setCurrentResults: (results: Array<any>) => void,
 *   clearCurrentResults: () => void,
 *   getMatchedResults: () => Array<any>,
 *   setMatchedResults: (results: Array<any>) => void,
 *   clearMatchedResults: () => void,
 *   getLastRenderedSearch: () => { query: string, dataRevision: number },
 *   setLastRenderedSearch: (query: string, dataRevision: number) => void,
 *   resetLastRenderedSearch: () => void,
 *   getLoadedFiles: () => Set<string>,
 *   addLoadedFile: (fileName: string) => void,
 *   removeLoadedFile: (fileName: string) => boolean,
 *   hasLoadedFile: (fileName: string) => boolean,
 *   clearLoadedFiles: () => void,
 *   getFullFileData: () => Record<string, any>,
 *   setFullFileData: (fileName: string, data: any) => void,
 *   deleteFullFileData: (fileName: string) => void,
 *   clearFullFileData: () => void,
 *   getRouteFileIndexByCode: () => Map<string, string>,
 *   setRouteFileIndexByCode: (index: Map<string, string>) => void,
 *   rebuildRouteFileIndex: (routeRecords: Array<{ name?: string }>) => Map<string, string>,
 *   removeDataForFile: (fileName: string) => boolean,
 *   resetDataRuntimeState: () => number,
 *   getRevision: () => number,
 *   bumpRevision: () => number
 * }>}
 */
export function createDataStore(cfg = {}) {
    const safeCfg = (cfg && typeof cfg === 'object') ? cfg : {};

    /** @type {Array<Object>} */
    const allData = Array.isArray(safeCfg.initialAllData) ? [...safeCfg.initialAllData] : [];

    /** @type {Array<any>} */
    const currentResults = [];

    /** @type {Array<any>} */
    const matchedResults = [];

    /** @type {string} */
    let lastQuery = '';

    /** @type {{ query: string, dataRevision: number }} */
    const lastRenderedSearch = { query: '', dataRevision: -1 };

    /** @type {Set<string>} */
    const loadedFiles = new Set();

    /** @type {Record<string, any>} */
    const fullFileData = {};

    /** @type {Map<string, string>} */
    const routeFileIndexByCode = new Map();

    /** @type {number} */
    let revision = 0;

    /**
     * Zastępuje zawartość wskazanej tablicy nową listą elementów.
     *
     * @param {Array<any>} target
     * @param {Array<any>} items
     */
    function replaceArrayContents(target, items) {
        target.length = 0;
        if (Array.isArray(items) && items.length > 0) {
            target.push(...items);
        }
    }

    function getAllData() {
        return allData;
    }

    function setAllData(rows) {
        if (!Array.isArray(rows)) throw new Error('data-store: setAllData(rows) wymaga tablicy.');
        allData.length = 0;
        allData.push(...rows);
        bumpRevision();
    }

    function addRows(rows) {
        if (!Array.isArray(rows)) throw new Error('data-store: addRows(rows) wymaga tablicy.');
        if (rows.length === 0) return;
        allData.push(...rows);
        bumpRevision();
    }

    function reset() {
        allData.length = 0;
        bumpRevision();
    }

    function getLastQuery() {
        return lastQuery;
    }

    function setLastQuery(query) {
        lastQuery = String(query ?? '');
    }

    function clearLastQuery() {
        lastQuery = '';
    }

    function getCurrentResults() {
        return currentResults;
    }

    function setCurrentResults(results) {
        replaceArrayContents(currentResults, results);
    }

    function clearCurrentResults() {
        currentResults.length = 0;
    }

    function getMatchedResults() {
        return matchedResults;
    }

    function setMatchedResults(results) {
        replaceArrayContents(matchedResults, results);
    }

    function clearMatchedResults() {
        matchedResults.length = 0;
    }

    function getLastRenderedSearch() {
        return lastRenderedSearch;
    }

    function setLastRenderedSearch(query, dataRevision) {
        lastRenderedSearch.query = String(query ?? '');
        lastRenderedSearch.dataRevision = Number.isFinite(Number(dataRevision)) ? Number(dataRevision) : -1;
    }

    function resetLastRenderedSearch() {
        lastRenderedSearch.query = '';
        lastRenderedSearch.dataRevision = -1;
    }

    function getLoadedFiles() {
        return loadedFiles;
    }

    function addLoadedFile(fileName) {
        const safe = String(fileName ?? '').trim();
        if (!safe) return;
        loadedFiles.add(safe);
    }

    function removeLoadedFile(fileName) {
        const safe = String(fileName ?? '').trim();
        if (!safe) return false;
        return loadedFiles.delete(safe);
    }

    function hasLoadedFile(fileName) {
        const safe = String(fileName ?? '').trim();
        if (!safe) return false;
        return loadedFiles.has(safe);
    }

    function clearLoadedFiles() {
        loadedFiles.clear();
    }

    function getFullFileData() {
        return fullFileData;
    }

    function setFullFileData(fileName, data) {
        const safe = String(fileName ?? '').trim();
        if (!safe) return;
        fullFileData[safe] = data;
    }

    function deleteFullFileData(fileName) {
        const safe = String(fileName ?? '').trim();
        if (!safe) return;
        delete fullFileData[safe];
    }

    function clearFullFileData() {
        const keys = Object.keys(fullFileData);
        for (const k of keys) delete fullFileData[k];
    }

    function getRouteFileIndexByCode() {
        return routeFileIndexByCode;
    }

    function setRouteFileIndexByCode(index) {
        if (!(index instanceof Map)) throw new Error('data-store: setRouteFileIndexByCode(index) wymaga Map.');
        routeFileIndexByCode.clear();
        for (const [k, v] of index.entries()) {
            routeFileIndexByCode.set(k, v);
        }
    }

    function rebuildRouteFileIndex(routeRecords) {
        const index = buildRouteFileIndex(routeRecords);
        setRouteFileIndexByCode(index);
        return routeFileIndexByCode;
    }

    /**
     * Usuwa wszystkie dane powiązane z pojedynczym plikiem.
     *
     * @param {string} fileName
     * @returns {boolean} `true`, jeśli usunięto przynajmniej jeden wiersz danych.
     */
    function removeDataForFile(fileName) {
        const safe = String(fileName ?? '').trim();
        if (!safe) return false;

        const beforeLength = allData.length;
        const remainingRows = allData.filter((row) => String(row?.fileName ?? '') !== safe);
        const hasRowChanges = remainingRows.length !== beforeLength;

        if (hasRowChanges) {
            setAllData(remainingRows);
        }

        deleteFullFileData(safe);
        removeLoadedFile(safe);

        for (const [routeCode, mappedFileName] of [...routeFileIndexByCode.entries()]) {
            if (String(mappedFileName ?? '') === safe) {
                routeFileIndexByCode.delete(routeCode);
            }
        }

        return hasRowChanges;
    }

    /**
     * Resetuje runtime'owy stan danych aplikacji bez dotykania zewnętrznych usług/UI.
     *
     * @returns {number} Nowa rewizja danych po resecie.
     */
    function resetDataRuntimeState() {
        reset();
        clearLastQuery();
        clearLoadedFiles();
        clearFullFileData();
        routeFileIndexByCode.clear();
        clearCurrentResults();
        clearMatchedResults();
        resetLastRenderedSearch();
        return getRevision();
    }

    function getRevision() {
        return revision;
    }

    function bumpRevision() {
        revision += 1;
        return revision;
    }

    return Object.freeze({
        getAllData,
        setAllData,
        addRows,
        reset,
        getLastQuery,
        setLastQuery,
        clearLastQuery,
        getCurrentResults,
        setCurrentResults,
        clearCurrentResults,
        getMatchedResults,
        setMatchedResults,
        clearMatchedResults,
        getLastRenderedSearch,
        setLastRenderedSearch,
        resetLastRenderedSearch,
        getLoadedFiles,
        addLoadedFile,
        removeLoadedFile,
        hasLoadedFile,
        clearLoadedFiles,
        getFullFileData,
        setFullFileData,
        deleteFullFileData,
        clearFullFileData,
        getRouteFileIndexByCode,
        setRouteFileIndexByCode,
        rebuildRouteFileIndex,
        removeDataForFile,
        resetDataRuntimeState,
        getRevision,
        bumpRevision
    });
}

/**
 * Wyciąga kod trasy z nazwy pliku.
 *
 * @param {unknown} fileName
 * @returns {string}
 */
export function extractRouteCodeFromFileName(fileName) {
    const raw = String(fileName ?? '');
    const match = raw.match(/\btrasa\b\s*([A-Za-zĄĆĘŁŃÓŚŹŻ0-9]+(?:\s*[-–]\s*\d+)?)\b/i);
    if (!match) return '';

    const codeRaw = match[1] || '';
    return String(codeRaw)
        .replace(/[–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻ0-9-]/g, '')
        .toUpperCase();
}

/**
 * Normalizuje kod trasy do postaci porównywalnej między modułami aplikacji.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRouteCodeForLookup(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    return raw
        .replace(/[–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '')
        .toUpperCase();
}

/**
 * Buduje indeks kodów tras dostępnych w bazie na podstawie rekordów plików.
 *
 * @param {Array<{ name?: string }>} routeRecords
 * @returns {Map<string, string>}
 */
export function buildRouteFileIndex(routeRecords) {
    const list = Array.isArray(routeRecords) ? routeRecords : [];
    const map = new Map();

    for (const record of list) {
        const fileName = String(record?.name ?? '').trim();
        if (!fileName) continue;

        const routeCode = normalizeRouteCodeForLookup(extractRouteCodeFromFileName(fileName));
        if (!routeCode) continue;
        if (!map.has(routeCode)) map.set(routeCode, fileName);
    }

    return map;
}

