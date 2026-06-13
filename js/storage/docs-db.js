/**
 * Nazwa i wersja bazy danych IndexedDB.
 */
const DOCS_DB_NAME = 'quickevo_docs_v2';
const DOCS_DB_VERSION = 2;
const DOCS_DB_STORE = 'files';
const DOCS_DB_OPEN_TIMEOUT_MS = 6000;

/** @type {Promise<IDBDatabase> | null} */
let docsDbPromise = null;

const docsDbConfig = {
    dbName: DOCS_DB_NAME,
    dbVersion: DOCS_DB_VERSION,
    storeName: DOCS_DB_STORE,
    openTimeoutMs: DOCS_DB_OPEN_TIMEOUT_MS,
    onBlocked: () => {
        try { globalThis.alert?.('Zamknij inne karty z tą aplikacją.'); } catch { }
    }
};

export function configureDocsDb(partialCfg = {}) {
    if (!partialCfg || typeof partialCfg !== 'object') return;
    if (typeof partialCfg.dbName === 'string' && partialCfg.dbName.trim()) docsDbConfig.dbName = partialCfg.dbName.trim();
    if (Number.isFinite(Number(partialCfg.dbVersion)) && Number(partialCfg.dbVersion) > 0) docsDbConfig.dbVersion = Number(partialCfg.dbVersion);
    if (typeof partialCfg.storeName === 'string' && partialCfg.storeName.trim()) docsDbConfig.storeName = partialCfg.storeName.trim();
    if (Number.isFinite(Number(partialCfg.openTimeoutMs)) && Number(partialCfg.openTimeoutMs) > 0) docsDbConfig.openTimeoutMs = Number(partialCfg.openTimeoutMs);
    if (typeof partialCfg.onBlocked === 'function') docsDbConfig.onBlocked = partialCfg.onBlocked;
}

/**
 * Otwiera połączenie z IndexedDB.
 */
export function openDocsDb() {
    if (docsDbPromise) return docsDbPromise;
    docsDbPromise = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(docsDbConfig.dbName, docsDbConfig.dbVersion);
            const timeout = globalThis.setTimeout?.(() => {
                docsDbPromise = null;
                reject(new Error('Timeout otwierania IndexedDB'));
            }, docsDbConfig.openTimeoutMs) ?? 0;
            req.onblocked = () => { try { docsDbConfig.onBlocked?.(); } catch { } };
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(docsDbConfig.storeName)) {
                    req.result.createObjectStore(docsDbConfig.storeName, { keyPath: 'name' });
                }
            };
            req.onsuccess = () => { try { globalThis.clearTimeout?.(timeout); } catch { } resolve(req.result); };
            req.onerror = () => { try { globalThis.clearTimeout?.(timeout); } catch { } docsDbPromise = null; reject(req.error); };
        } catch (err) { reject(err); }
    });
    return docsDbPromise;
}

/**
 * Pobiera listę plików z bazy.
 */
export async function docsListFiles() {
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(docsDbConfig.storeName, 'readonly'), req = tx.objectStore(docsDbConfig.storeName).getAll();
        req.onsuccess = () => resolve((Array.isArray(req.result) ? req.result : []).map(r => ({
            name: String(r?.name ?? ''),
            size: Number(r?.size ?? (r?.blob?.size ?? 0)),
            updatedAt: Number(r?.updatedAt ?? 0),
            driveModifiedAt: Number(r?.driveModifiedAt ?? 0) || null,
            routeCategory: String(r?.routeCategory ?? '').trim(),
            topLevelFolderName: String(r?.topLevelFolderName ?? '').trim()
        })).filter(r => r.name));
        req.onerror = () => reject(req.error);
    });
}

/**
 * Sprawdza, czy plik istnieje w bazie.
 */
export async function docsFileExists(fileName) {
    const db = await openDocsDb();
    return await new Promise((resolve) => {
        const req = db.transaction(docsDbConfig.storeName, 'readonly').objectStore(docsDbConfig.storeName).get(fileName);
        req.onsuccess = () => resolve(!!req.result); req.onerror = () => resolve(false);
    });
}

/**
 * Pobiera Blob pliku z bazy.
 */
export async function docsGetBlob(fileName) {
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const req = db.transaction(docsDbConfig.storeName, 'readonly').objectStore(docsDbConfig.storeName).get(String(fileName || ''));
        req.onsuccess = () => resolve(req.result?.blob ?? null); req.onerror = () => reject(req.error);
    });
}

/**
 * Pobiera rekord pliku (metadane) z bazy.
 * Zwraca null, jeśli plik nie istnieje.
 */
export async function docsGetFileRecord(fileName) {
    const safe = String(fileName || '').trim();
    if (!safe) return null;
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const req = db.transaction(docsDbConfig.storeName, 'readonly').objectStore(docsDbConfig.storeName).get(safe);
        req.onsuccess = () => {
            const r = req.result;
            if (!r) { resolve(null); return; }
            resolve({
                name: String(r?.name ?? ''),
                size: Number(r?.size ?? (r?.blob?.size ?? 0)),
                updatedAt: Number(r?.updatedAt ?? 0),
                driveModifiedAt: Number(r?.driveModifiedAt ?? 0) || null,
                routeCategory: String(r?.routeCategory ?? '').trim(),
                topLevelFolderName: String(r?.topLevelFolderName ?? '').trim()
            });
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Zapisuje Blob pliku w bazie wraz z metadanymi źródła.
 *
 * `routeCategory` i `topLevelFolderName` są używane wyłącznie dla tras pobranych
 * z Google Drive. Dzięki temu aplikacja może po restarcie nadal odtworzyć kategorię
 * pliku na podstawie folderu, bez ponownego odpytywania Drive API.
 */
export async function docsPutBlob(fileName, blob, { driveModifiedAt, routeCategory, topLevelFolderName } = {}) {
    const safe = String(fileName || '').trim(); if (!safe) throw new Error('Brak nazwy pliku');
    const normalizedDriveModifiedAt = (Number.isFinite(Number(driveModifiedAt)) && Number(driveModifiedAt) > 0) ? Number(driveModifiedAt) : null;
    const normalizedRouteCategory = String(routeCategory ?? '').trim().toUpperCase();
    const normalizedTopLevelFolderName = String(topLevelFolderName ?? '').trim();
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const req = db.transaction(docsDbConfig.storeName, 'readwrite').objectStore(docsDbConfig.storeName).put({
            name: safe,
            blob,
            size: blob?.size ?? 0,
            updatedAt: Date.now(),
            driveModifiedAt: normalizedDriveModifiedAt,
            routeCategory: normalizedRouteCategory,
            topLevelFolderName: normalizedTopLevelFolderName
        });
        req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
}

export async function docsClearFilesStore() {
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(docsDbConfig.storeName, 'readwrite');
        const req = tx.objectStore(docsDbConfig.storeName).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function docsDeleteFiles(fileNames) {
    const names = Array.isArray(fileNames) ? fileNames.map(n => String(n || '').trim()).filter(Boolean) : [];
    if (names.length === 0) return { deleted: 0 };
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(docsDbConfig.storeName, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Błąd transakcji IndexedDB'));
        tx.onabort = () => reject(tx.error || new Error('Transakcja IndexedDB przerwana'));
        const store = tx.objectStore(docsDbConfig.storeName);
        for (const name of names) store.delete(name);
    });
    return { deleted: names.length };
}
