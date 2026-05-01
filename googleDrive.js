const CLIENT_ID = '254832331994-8hj0p8ffq977k9nh25bo2p893r0k8q0v.apps.googleusercontent.com';
const API_KEY = 'AIzaSyA6hqZ1wdUqMDJM9BJjLBpII73NUmJW-Mo';

(function () {
    const ROOT_FOLDER_ID = '1le9w7bFwWgSPjIoE4eWnT10nNI5-J0wa';

    const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
    const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];
    const EXCEL_MIME_TYPES = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ].join(',');

    const scriptPromises = new Map();
    // Cache w RAM dla pobrań w tej sesji (unikamy ponownego pobierania tego samego pliku po fileId).
    const downloadCache = new Map();

    let tokenClient = null;
    let accessToken = '';
    let accessTokenExpiresAt = 0;

    function logToApp(level, payload) {
        try {
            if (typeof window.logAction === 'function') window.logAction('google_drive', payload ?? null, level);
        } catch {
        }
    }

    function loadScriptOnce(src, id) {
        if (scriptPromises.has(src)) return scriptPromises.get(src);
        const p = new Promise((resolve, reject) => {
            const existing = id ? document.getElementById(id) : null;
            if (existing) {
                resolve();
                return;
            }
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
        // Lazy-load: GIS ładuje się dopiero przy imporcie z Google Drive.
        await loadScriptOnce('https://accounts.google.com/gsi/client', 'qe-gsi-client');
        if (!window.google?.accounts?.oauth2) throw new Error('GIS: brak google.accounts.oauth2');
    }

    async function ensureGapiLoaded() {
        // Lazy-load: Picker (api.js) ładuje się dopiero przy imporcie z Google Drive.
        await loadScriptOnce('https://apis.google.com/js/api.js', 'qe-gapi');
        if (!window.gapi) throw new Error('Google API: brak window.gapi');
    }

    async function ensurePickerLoaded() {
        await ensureGapiLoaded();
        await new Promise((resolve, reject) => {
            try {
                window.gapi.load('picker', {
                    callback: () => resolve(),
                    onerror: () => reject(new Error('Google Picker: błąd ładowania')),
                    timeout: 7000,
                    ontimeout: () => reject(new Error('Google Picker: timeout ładowania'))
                });
            } catch (err) {
                reject(err);
            }
        });
        if (!window.google?.picker) throw new Error('Google Picker: brak window.google.picker');
    }

    function getTokenClient() {
        if (tokenClient) return tokenClient;
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: DRIVE_SCOPE,
            callback: () => {
            }
        });
        return tokenClient;
    }

    function requestAccessToken(prompt) {
        return new Promise(async (resolve, reject) => {
            await ensureGisLoaded();
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
        });
    }

    async function getAccessToken() {
        if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken;
        try {
            // Najpierw próbujemy prompt='' (bez przymusowego wyświetlania zgody).
            return await requestAccessToken('');
        } catch (err) {
            // Fallback: prompt='consent' (wymusza interakcję użytkownika).
            return await requestAccessToken('consent');
        }
    }

    function validateExcelFileName(name) {
        const lower = String(name || '').toLowerCase();
        return ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    function buildPicker(accessTokenValue, callback) {
        const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
            .setParent(ROOT_FOLDER_ID)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setMimeTypes(EXCEL_MIME_TYPES);

        if (typeof view.setSelectableMimeTypes === 'function') {
            view.setSelectableMimeTypes(EXCEL_MIME_TYPES);
        }

        if (google.picker.DocsViewMode && google.picker.DocsViewMode.LIST && typeof view.setMode === 'function') {
            view.setMode(google.picker.DocsViewMode.LIST);
        }

        const builder = new google.picker.PickerBuilder()
            .setSize(1050, 650)
            .setOAuthToken(accessTokenValue)
            .setDeveloperKey(API_KEY)
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .addView(view)
            .setCallback(callback);

        if (google.picker.Feature && google.picker.Feature.SUPPORT_DRIVES) {
            builder.enableFeature(google.picker.Feature.SUPPORT_DRIVES);
        }

        return builder.build();
    }

    async function pickExcelFiles() {
        await ensurePickerLoaded();
        const token = await getAccessToken();

        return await new Promise((resolve, reject) => {
            let finished = false;
            const picker = buildPicker(token, (data) => {
                try {
                    const action = data?.[google.picker.Response.ACTION];
                    if (action === google.picker.Action.CANCEL) {
                        finished = true;
                        resolve({ accessToken: token, files: [] });
                        return;
                    }
                    if (action !== google.picker.Action.PICKED) return;

                    const docs = Array.isArray(data?.[google.picker.Response.DOCUMENTS])
                        ? data[google.picker.Response.DOCUMENTS]
                        : [];

                    const files = docs.map((d) => ({
                        id: String(d?.[google.picker.Document.ID] || ''),
                        name: String(d?.[google.picker.Document.NAME] || ''),
                        mimeType: String(d?.[google.picker.Document.MIME_TYPE] || '')
                    })).filter(f => f.id && f.name);

                    finished = true;
                    resolve({ accessToken: token, files });
                } catch (err) {
                    if (finished) return;
                    finished = true;
                    reject(err);
                }
            });
            picker.setVisible(true);

            window.setTimeout(() => {
                if (finished) return;
                logToApp('WARN', { phase: 'picker_timeout' });
            }, 20000);
        });
    }

    async function downloadFileArrayBuffer(fileId, token) {
        const safeId = String(fileId || '').trim();
        if (!safeId) throw new Error('Brak fileId');

        if (downloadCache.has(safeId)) return downloadCache.get(safeId);

        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(safeId)}?alt=media`;
        const res = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store'
        });
        if (!res.ok) {
            let details = '';
            try { details = await res.text(); } catch {
            }
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
     * Rekurencyjnie pobiera listę wszystkich plików .xlsx z folderu i jego podfolderów.
     * @param {string} folderId ID folderu startowego.
     * @param {string} token Access token.
     * @returns {Promise<Array<Object>>} Lista plików.
     */
    async function crawlFolder(folderId, token) {
        const files = [];
        const queue = [folderId];

        while (queue.length > 0) {
            const currentFolderId = queue.shift();
            // Zapytanie o pliki i foldery w bieżącym folderze
            const q = `'${currentFolderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or name contains '.xlsx' or name contains '.xls')`;
            const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=1000`;

            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: { message: 'Nieznany błąd API' } }));
                throw new Error(`Błąd listowania plików: ${err.error.message}`);
            }

            const data = await res.json();
            for (const file of data.files || []) {
                if (file.mimeType === 'application/vnd.google-apps.folder') {
                    queue.push(file.id);
                } else if (validateExcelFileName(file.name)) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    window.GoogleDriveImport = Object.freeze({
        pickExcelFiles,
        getAccessToken,
        downloadFileArrayBuffer,
        validateExcelFileName,
        crawlFolder
    });
})();
