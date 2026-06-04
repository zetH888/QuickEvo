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
 *   getCurrentResults: () => Array<any>,
 *   clearCurrentResults: () => void,
 *   getMatchedResults: () => Array<any>,
 *   clearMatchedResults: () => void,
 *   getLastRenderedSearch: () => { query: string, dataRevision: number },
 *   resetLastRenderedSearch: () => void,
 *   getLoadedFiles: () => Set<string>,
 *   clearLoadedFiles: () => void,
 *   getFullFileData: () => Record<string, any>,
 *   clearFullFileData: () => void,
 *   getRouteFileIndexByCode: () => Map<string, string>,
 *   setRouteFileIndexByCode: (index: Map<string, string>) => void,
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

    function getCurrentResults() {
        return currentResults;
    }

    function clearCurrentResults() {
        currentResults.length = 0;
    }

    function getMatchedResults() {
        return matchedResults;
    }

    function clearMatchedResults() {
        matchedResults.length = 0;
    }

    function getLastRenderedSearch() {
        return lastRenderedSearch;
    }

    function resetLastRenderedSearch() {
        lastRenderedSearch.query = '';
        lastRenderedSearch.dataRevision = -1;
    }

    function getLoadedFiles() {
        return loadedFiles;
    }

    function clearLoadedFiles() {
        loadedFiles.clear();
    }

    function getFullFileData() {
        return fullFileData;
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
        getCurrentResults,
        clearCurrentResults,
        getMatchedResults,
        clearMatchedResults,
        getLastRenderedSearch,
        resetLastRenderedSearch,
        getLoadedFiles,
        clearLoadedFiles,
        getFullFileData,
        clearFullFileData,
        getRouteFileIndexByCode,
        setRouteFileIndexByCode,
        getRevision,
        bumpRevision
    });
}

