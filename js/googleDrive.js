const CLIENT_ID = '254832331994-8hj0p8ffq977k9nh25bo2p893r0k8q0v.apps.googleusercontent.com';

(function () {
    const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
    const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

    const scriptPromises = new Map();
    const downloadCache = new Map();

    let tokenClient = null;
    let accessToken = '';
    let accessTokenExpiresAt = 0;

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

    async function ensureGisLoaded() {
        await loadScriptOnce('https://accounts.google.com/gsi/client', 'qe-gsi-client');
        if (!window.google?.accounts?.oauth2) throw new Error('GIS: brak google.accounts.oauth2');
    }

    function getTokenClient() {
        if (tokenClient) return tokenClient;
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: DRIVE_SCOPE,
            callback: () => { }
        });
        return tokenClient;
    }

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

    async function getAccessToken() {
        if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken;
        try {
            return await requestAccessToken('');
        } catch {
            return await requestAccessToken('consent');
        }
    }

    function validateExcelFileName(name) {
        const lower = String(name || '').toLowerCase();
        return ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    function parseDriveModifiedAt(isoString) {
        const raw = String(isoString || '').trim();
        if (!raw) return null;
        const ts = Date.parse(raw);
        return Number.isFinite(ts) ? ts : null;
    }

    async function downloadFileArrayBuffer(fileId, token, { signal } = {}) {
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
     * @param {string} folderId ID folderu startowego.
     * @param {string} token Access token.
     * @returns {Promise<Array<{id:string,name:string,mimeType:string,driveModifiedAt:(number|null)}>>}
     */
    async function crawlFolder(folderId, token, { signal } = {}) {
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

    window.GoogleDriveImport = Object.freeze({
        getAccessToken,
        downloadFileArrayBuffer,
        validateExcelFileName,
        crawlFolder
    });
})();
