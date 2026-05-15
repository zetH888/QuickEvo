/**
 * @module drive-service
 *
 * @description
 * Moduł integracji z Google Drive dla QuickEvo.
 *
 * Odpowiada za:
 * - inicjalizację Google Identity Services (GIS) oraz uzyskanie access token,
 * - listowanie plików w folderze i podfolderach (Drive API v3),
 * - pobieranie zawartości pliku jako ArrayBuffer (alt=media),
 * - walidację nazw plików pod kątem importu (.xlsx/.xls).
 *
 * Moduł nie renderuje UI oraz nie zarządza stanem aplikacji — dostarcza wyłącznie funkcje serwisowe.
 *
 * @zaleznosci
 * Brak zależności od pozostałych modułów aplikacji (celowo).
 *
 * @wymaganiaSrodowiskowe
 * - Dostępny `fetch`.
 * - Dostęp do `document.head` (wstrzyknięcie skryptu GIS).
 *
 * @publicznyInterfejs
 * - getAccessToken
 * - crawlFolder
 * - downloadFileArrayBuffer
 * - validateExcelFileName
 */

/**
 * Id klienta OAuth2 (Google Identity Services).
 * UWAGA: to identyfikator publiczny aplikacji webowej (nie jest tajnym sekretem).
 *
 * @type {string}
 */
const CLIENT_ID = '254832331994-8hj0p8ffq977k9nh25bo2p893r0k8q0v.apps.googleusercontent.com';

/**
 * Zakres wymagany do pobierania plików z Drive.
 *
 * @type {string}
 */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/**
 * Dozwolone rozszerzenia plików do importu z Drive.
 *
 * @type {string[]}
 */
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

/**
 * Cache obietnic ładowania skryptów, aby uniknąć wielokrotnego wstrzykiwania tej samej biblioteki.
 *
 * @type {Map<string, Promise<void>>}
 */
const scriptPromises = new Map();

/**
 * Cache pobierania plików (w ramach pojedynczej sesji uruchomienia aplikacji).
 * Używane do ograniczenia nadmiarowych pobrań w trybie diff.
 *
 * @type {Map<string, ArrayBuffer>}
 */
const downloadCache = new Map();

/** @type {any|null} */
let tokenClient = null;
/** @type {string} */
let accessToken = '';
/** @type {number} */
let accessTokenExpiresAt = 0;

/**
 * Ładuje skrypt tylko raz.
 *
 * @param {string} src
 * @param {string} [id]
 * @returns {Promise<void>}
 */
function loadScriptOnce(src, id) {
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const p = new Promise((resolve, reject) => {
        const existing = id ? document.getElementById(id) : null;
        if (existing) { resolve(); return; }
        const el = document.createElement('script');
        if (id) el.id = id;
        el.src = src;
        el.async = true;
        el.defer = true;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(`Nie udało się załadować skryptu: ${src}`));
        document.head.appendChild(el);
    });
    scriptPromises.set(src, p);
    return p;
}

/**
 * Zapewnia dostępność biblioteki Google Identity Services (GIS).
 *
 * @returns {Promise<void>}
 */
async function ensureGisLoaded() {
    await loadScriptOnce('https://accounts.google.com/gsi/client', 'qe-gsi-client');
    if (!globalThis.google?.accounts?.oauth2) throw new Error('GIS: brak google.accounts.oauth2');
}

/**
 * Tworzy (lub zwraca istniejący) tokenClient GIS.
 *
 * @returns {any}
 */
function getTokenClient() {
    if (tokenClient) return tokenClient;
    tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: () => { }
    });
    return tokenClient;
}

/**
 * Wywołuje GIS i żąda access token. W przypadku braku tokenu zwraca błąd.
 *
 * @param {string} prompt
 * @returns {Promise<string>}
 */
function requestAccessToken(prompt) {
    return new Promise((resolve, reject) => {
        ensureGisLoaded()
            .then(() => {
                const client = getTokenClient();
                client.callback = (resp) => {
                    const token = resp?.access_token ? String(resp.access_token) : '';
                    if (!token) {
                        const err = new Error(resp?.error ? String(resp.error) : 'Brak access token');
                        err.code = resp?.error ? String(resp.error) : 'no_token';
                        reject(err);
                        return;
                    }
                    accessToken = token;
                    const expiresIn = Number(resp?.expires_in || 0);
                    accessTokenExpiresAt = Date.now() + Math.max(0, expiresIn - 60) * 1000;
                    resolve(token);
                };
                client.requestAccessToken({ prompt: prompt || '' });
            })
            .catch(reject);
    });
}

/**
 * Zwraca access token (jeśli ważny) lub inicjuje ponowne pobranie tokenu.
 *
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
    if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken;
    try {
        return await requestAccessToken('');
    } catch {
        return await requestAccessToken('consent');
    }
}

/**
 * Waliduje nazwę pliku pod kątem dozwolonych rozszerzeń.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function validateExcelFileName(name) {
    const lower = String(name || '').toLowerCase();
    return ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Parsuje ISO modifiedTime z Drive do timestampu (ms).
 *
 * @param {string} isoString
 * @returns {number|null}
 */
function parseDriveModifiedAt(isoString) {
    const raw = String(isoString || '').trim();
    if (!raw) return null;
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : null;
}

/**
 * Pobiera zawartość pliku z Drive jako ArrayBuffer.
 *
 * @param {string} fileId
 * @param {string} token
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadFileArrayBuffer(fileId, token, { signal } = {}) {
    const safeId = String(fileId || '').trim();
    if (!safeId) throw new Error('Brak fileId');
    if (downloadCache.has(safeId)) return downloadCache.get(safeId);

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(safeId)}?alt=media`;
    const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal
    });
    if (!res.ok) {
        let details = '';
        try { details = await res.text(); } catch { }
        const err = new Error(`Google Drive: błąd pobierania (${res.status})`);
        err.status = res.status;
        err.details = details;
        throw err;
    }
    const ab = await res.arrayBuffer();
    downloadCache.set(safeId, ab);
    return ab;
}

/**
 * Rekurencyjnie pobiera listę wszystkich plików .xlsx/.xls z folderu i jego podfolderów.
 * Zwraca metadane z timestampem modyfikacji (driveModifiedAt) do logiki „importuj tylko zmienione”.
 *
 * @param {string} folderId
 * @param {string} token
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<Array<{id:string,name:string,mimeType:string,driveModifiedAt:(number|null)}>>}
 */
export async function crawlFolder(folderId, token, { signal } = {}) {
    const files = [];
    const queue = [String(folderId || '').trim()].filter(Boolean);
    const authHeader = { Authorization: `Bearer ${token}` };

    while (queue.length > 0) {
        const currentFolderId = queue.shift();
        const q = `'${currentFolderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or name contains '.xlsx' or name contains '.xls')`;

        let pageToken = '';
        while (true) {
            const params = new URLSearchParams();
            params.set('q', q);
            params.set('pageSize', '1000');
            params.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime)');
            if (pageToken) params.set('pageToken', pageToken);
            const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;

            const res = await fetch(url, { headers: authHeader, cache: 'no-store', signal });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: { message: 'Nieznany błąd API' } }));
                throw new Error(`Błąd listowania plików: ${err?.error?.message ? String(err.error.message) : `HTTP ${res.status}`}`);
            }

            const data = await res.json().catch(() => ({}));
            const list = Array.isArray(data?.files) ? data.files : [];
            for (const file of list) {
                if (file?.mimeType === 'application/vnd.google-apps.folder' && file?.id) {
                    queue.push(String(file.id));
                    continue;
                }
                const name = String(file?.name || '').trim();
                const id = String(file?.id || '').trim();
                if (!name || !id) continue;
                if (!validateExcelFileName(name)) continue;
                files.push({
                    id,
                    name,
                    mimeType: String(file?.mimeType || ''),
                    driveModifiedAt: parseDriveModifiedAt(file?.modifiedTime)
                });
            }

            pageToken = data?.nextPageToken ? String(data.nextPageToken) : '';
            if (!pageToken) break;
        }
    }

    return files;
}
