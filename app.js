/**
 * QuickEvo - Logika Frontendowa
 * 
 * Aplikacja do wyszukiwania tras i dokumentów w plikach Excel (.xlsx, .xls) oraz CSV.
 * Obsługuje import plików z dysku lokalnego oraz z Google Drive.
 * Wykorzystuje IndexedDB do przechowywania plików i Web Workers (opcjonalnie) do przetwarzania.
 */

/** @type {Array<Object>} Znormalizowane wiersze ze wszystkich załadowanych plików. Każdy obiekt zawiera dane do wyszukiwania i wyświetlania. */
let allData = []; 

/** @type {Array<Object>} Aktualnie wyświetlana strona wyników wyszukiwania (paginacja). */
let currentResults = []; 

/** @type {Array<Object>} Wszystkie dopasowania dla bieżącego zapytania, pogrupowane według plików. */
let matchedResults = []; 

/** @type {number} Indeks zaznaczonego wyniku podczas nawigacji klawiaturą (-1 jeśli brak). Zakres: -1 do matchedResults.length - 1. */
let selectedResultIndex = -1; 

/** @type {string} Ostatnie zapytanie użyte do wyszukiwania. Służy do odświeżania wyników po imporcie nowych danych. */
let lastQuery = ''; 

/** @type {Set<string>} Zbiór nazw plików, które zostały już przetworzone i dodane do indeksu allData. */
let loadedFiles = new Set(); 

/** @type {Object<string, Object>} Mapowanie nazwy pliku na pełny model danych tabeli (używane w widoku podglądu). */
let fullFileData = {}; 

/** @type {boolean} Flaga określająca, czy wyszukiwarka jest aktywna (wymaga załadowanych danych). */
let isSearchEnabled = false; 

/** @type {boolean} Flaga wskazująca, czy trwa obecnie proces ładowania plików z bazy danych. */
let isLoading = false; 

/** @type {boolean} Flaga wskazująca, czy trwa obecnie doczytywanie kolejnej strony wyników. */
let isLoadingMoreResults = false; 

/** @type {Array<Object>} Lista błędów napotkanych podczas wczytywania poszczególnych plików. */
let loadErrors = []; 

/** @const {number} Liczba grup wyników wyświetlanych na jednej stronie paginacji. */
const PAGE_SIZE = 10; 

/**
 * Zestaw tokenów do wykrywania wierszy związanych z laboratorium.
 * @type {Array<Array<string>>}
 */
const KEY_LAB_TOKEN_SETS = [
    ['dzika', 'laboratorium'],
    ['dzika', 'lm'],
    ['piaseczno', 'laboratorium'],
    ['lodz', 'laboratorium'],
    ['wolomin', 'laboratorium'],
    ['szpital', 'medicover'],
    ['wilanow', 'laboratorium']
];

/**
 * Skompilowane zestawy tokenów do szybkich dopasowań.
 * @type {Array<Array<string>>}
 */
let compiledKeyLabTokenSets = []; 

/**
 * Timestamp ostatniego kliknięcia przycisku Home.
 * @type {number}
 */
let lastHomeResetTs = 0; 

/**
 * Referencja do debounce dla wyszukiwania.
 * @type {Function|null}
 */
let debouncedSearchRef = null; 

/**
 * Referencja do debounce dla logowania wyszukiwań.
 * @type {Function|null}
 */
let debouncedLogSearchRef = null; 

/**
 * Referencje do kluczowych elementów interfejsu użytkownika (DOM).
 */
const searchInput = document.getElementById('search-input');
const resultsList = document.getElementById('results-list');
const resultsInfo = document.getElementById('results-info');
const statusIndicator = document.getElementById('status-indicator');
const fileCountSpan = document.getElementById('file-count');
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const importButton = document.getElementById('import-button');
const importGoogleDriveButton = document.getElementById('import-google-drive-button');
const fileInput = document.getElementById('file-input');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgress = document.getElementById('upload-progress');
const uploadStatus = document.getElementById('upload-status');
const searchView = document.getElementById('search-view');
const filePreviewView = document.getElementById('file-preview-view');
const backToSearchBtn = document.getElementById('back-to-search');
const previewMeta = document.getElementById('preview-meta');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatusText = document.getElementById('loading-status-text');
const loadingProgressBar = document.getElementById('loading-progress-bar');
const loadingProgressMeta = document.getElementById('loading-progress-meta');
const loadingError = document.getElementById('loading-error');
const loadingContinueButton = document.getElementById('loading-continue-button');
const appShell = document.getElementById('app-shell');
const appHeaderLogo = document.getElementById('app-header-logo');
const homeLink = document.getElementById('home-link');
const resultsFooter = document.getElementById('results-footer');
const showMoreButton = document.getElementById('show-more-button');
const showMoreLoading = document.getElementById('show-more-loading');
const showMoreError = document.getElementById('show-more-error');
const dropZone = document.getElementById('drop-zone');
const debugTray = document.getElementById('debug-tray');
const debugTrayToggle = document.getElementById('debug-tray-toggle');
const debugSearchInput = document.getElementById('debug-search');
const debugCopyButton = document.getElementById('debug-copy');
const debugMinimizeButton = document.getElementById('debug-minimize');
const debugLogEl = document.getElementById('debug-log');
const debugClearButton = document.getElementById('debug-clear');

/**
 * Timestamp referencyjny do wyliczenia opóźnienia wejścia aplikacji.
 * @type {number}
 */
const DOM_READY_TS = performance.now();

/**
 * Aktualna wartość paska postępu w ekranie ładowania.
 * @type {number}
 */
let loadingProgressValue = 0;

/**
 * Flaga zakończenia animacji ładowania.
 * @type {boolean}
 */
let loadingProgressDone = false;

/**
 * Flaga gotowości danych aplikacji.
 * @type {boolean}
 */
let loadingDataReady = false;

/**
 * Flaga błędu ładowania.
 * @type {boolean}
 */
let loadingFailed = false;

/**
 * Czas rozpoczęcia procesu ładowania.
 * @type {number}
 */
let loadingStartedAt = 0;

/**
 * Licznik instancji loga dla unikalnych ID SVG.
 * @type {number}
 */
let logoInstanceCounter = 0;

/**
 * Nazwa i wersja bazy danych IndexedDB.
 */
const DOCS_DB_NAME = 'quickevo_docs_v2';
const DOCS_DB_VERSION = 1;
const DOCS_DB_STORE = 'files';

/**
 * Obietnica otwarcia bazy danych.
 * @type {Promise|null}
 */
let docsDbPromise = null;

/**
 * Bufor wpisów w panelu debugowania.
 * @type {Array<Object>}
 */
let debugEntries = [];

/**
 * Maksymalna liczba wpisów renderowanych w DebugLog.
 */
const DEBUG_RENDER_LIMIT = 900;

/**
 * Flaga widoczności panelu debugowania.
 */
let debugUiOpen = false;

/**
 * Flaga planowania renderowania panelu debugowania.
 */
let debugRenderQueued = false;

/**
 * Fraza wyszukiwania w logach debugowania.
 */
let debugSearchTerm = '';

/**
 * Limit rozmiaru pliku podczas importu (5MB).
 */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Zapewnia polifill dla funkcji fetch, jeśli nie jest dostępna natywnie.
 * @complexity O(1)
 */
function ensureFetchPolyfill() {
    if (typeof window.fetch === 'function') return;
    window.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
        try {
            const method = String(opts.method || 'GET').toUpperCase();
            const xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.responseType = 'arraybuffer';
            const headers = opts.headers && typeof opts.headers === 'object' ? opts.headers : {};
            for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, String(v));
            xhr.onload = () => {
                const status = xhr.status;
                const ok = status >= 200 && status < 300;
                const ab = xhr.response || new ArrayBuffer(0);
                const response = {
                    ok,
                    status,
                    arrayBuffer: async () => ab,
                    text: async () => new TextDecoder('utf-8').decode(new Uint8Array(ab)),
                    json: async () => JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(ab))),
                    blob: async () => new Blob([ab])
                };
                resolve(response);
            };
            xhr.onerror = () => reject(new Error('fetch() polyfill: network error'));
            xhr.send(opts.body || null);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Rezerwowy magazyn danych w pamięci.
 * @type {Map<string, string>}
 */
const memoryStorage = new Map();

/**
 * Pobiera wartość z magazynu lokalnego (localStorage) z fallbackiem do pamięci.
 * @param {string} key Klucz danych.
 * @returns {string|null} Pobrana wartość.
 * @complexity O(1)
 */
function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch { }
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
}

/**
 * Zapisuje wartość w magazynie lokalnym (localStorage) z fallbackiem do pamięci.
 * @param {string} key Klucz danych.
 * @param {string} value Wartość do zapisu.
 * @complexity O(1)
 */
function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return; } catch { }
    memoryStorage.set(key, String(value));
}

/**
 * Zabezpiecza ciąg znaków przed atakami XSS poprzez zamianę znaków specjalnych HTML.
 * @param {any} value Wartość wejściowa.
 * @returns {string} Ciąg zabezpieczony.
 * @complexity O(N)
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Globalne instancje parserów DOM dla HTML i SVG.
 */
const htmlDomParser = new DOMParser();
const svgDomParser = new DOMParser();

/**
 * Czyści zawartość elementu DOM.
 * @param {HTMLElement} el Element do wyczyszczenia.
 * @complexity O(N)
 */
function clearElement(el) {
    if (!el) return;
    el.replaceChildren();
}

/**
 * Bezpiecznie ustawia zawartość HTML elementu.
 * @param {HTMLElement} el Element docelowy.
 * @param {string} html Kod HTML.
 * @complexity O(N)
 */
function setElementHtml(el, html) {
    if (!el) return;
    const source = String(html ?? '');
    const doc = htmlDomParser.parseFromString(`<div>${source}</div>`, 'text/html');
    const wrapper = doc.body?.firstElementChild;
    if (!wrapper) {
        clearElement(el);
        return;
    }
    el.replaceChildren(...Array.from(wrapper.childNodes));
}

/**
 * Bezpiecznie wstrzykuje kod SVG do elementu.
 * @param {HTMLElement} el Element docelowy.
 * @param {string} svgSource Kod SVG.
 * @complexity O(N)
 */
function setElementSvg(el, svgSource) {
    if (!el) return;
    const source = String(svgSource ?? '').trim();
    if (!source) {
        clearElement(el);
        return;
    }
    const doc = svgDomParser.parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || String(root.nodeName || '').toLowerCase() !== 'svg') {
        clearElement(el);
        return;
    }
    el.replaceChildren(document.importNode(root, true));
}

/**
 * Formatuje liczbę do dwóch cyfr.
 * @param {number|string} value Wartość.
 * @returns {string} Sformatowany ciąg.
 * @complexity O(1)
 */
function pad2(value) {
    return String(value).padStart(2, '0');
}

/**
 * Formatuje znacznik czasu na czytelną datę i czas.
 * @param {number} ts Znacznik czasu (ms).
 * @returns {string} Sformatowana data.
 * @complexity O(1)
 */
function formatTimestamp(ts) {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
}

/**
 * Przełącza widoczność strefy upuszczania plików.
 * @param {boolean} visible Czy widoczna.
 * @complexity O(1)
 */
function setDropZoneVisible(visible) {
    if (!dropZone) return;
    dropZone.classList.toggle('hidden', !visible);
    dropZone.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

/**
 * Formatuje dane do wyświetlenia w panelu debugowania.
 * @param {string} action Typ akcji.
 * @param {any} payload Dane akcji.
 * @returns {string} Sformatowany HTML.
 * @complexity O(N)
 */
function formatDebugPayload(action, payload) {
    const a = String(action || '').toLowerCase();
    if (a === 'search') {
        const q = payload && typeof payload === 'object' ? payload.query : '';
        return `Query: "<strong>${escapeHtml(q)}</strong>"`;
    }
    if (a === 'preview') {
        const fn = payload && typeof payload === 'object' ? payload.fileName : '';
        const ri = payload && typeof payload === 'object' ? payload.rowIndex : null;
        const rowLabel = Number.isInteger(ri) ? `<strong>${escapeHtml(String(ri))}</strong>` : '<strong>?</strong>';
        return `Found in: "<u>${escapeHtml(fn)}</u>" row: ${rowLabel}`;
    }
    if (a === 'navigate') {
        const to = payload && typeof payload === 'object' ? payload.to : '';
        return `Navigate: <strong>${escapeHtml(to)}</strong>`;
    }
    if (a === 'import') {
        const files = payload && typeof payload === 'object' ? payload.files : null;
        const records = payload && typeof payload === 'object' ? payload.records : null;
        const errors = payload && typeof payload === 'object' ? payload.errors : null;
        return `Import: files=<strong>${escapeHtml(files ?? '')}</strong> records=<strong>${escapeHtml(records ?? '')}</strong> errors=<strong>${escapeHtml(errors ?? '')}</strong>`;
    }
    if (payload && typeof payload === 'object') return '';
    if (payload != null) return `<strong>${escapeHtml(String(payload))}</strong>`;
    return '';
}

/**
 * Otwiera lub zamyka panel debugowania.
 * @param {boolean} open Czy otworzyć.
 * @complexity O(1)
 */
function setDebugUiOpen(open) {
    debugUiOpen = Boolean(open);
    if (!debugTray) return;
    debugTray.classList.toggle('debug-tray--open', debugUiOpen);
    debugTray.setAttribute('aria-expanded', debugUiOpen ? 'true' : 'false');
    if (debugUiOpen) scheduleDebugRender();
}

/**
 * Bezpiecznie konwertuje obiekt na ciąg JSON do celów wyszukiwania.
 * @param {any} value Obiekt.
 * @returns {string} JSON.
 * @complexity O(N)
 */
function safeStringifyForSearch(value) {
    try {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

/**
 * Renderuje szczegóły obiektu payload w panelu debugowania.
 * @param {any} payload Dane.
 * @param {number} depth Głębokość rekurencji.
 * @param {Object} budget Limit węzłów.
 * @returns {string} HTML.
 * @complexity O(N)
 */
function renderPayloadDetails(payload, depth = 0, budget = { nodes: 0 }) {
    if (!payload || typeof payload !== 'object') return '';
    if (depth > 3) return '';
    if (budget.nodes > 120) return '';

    const entries = Array.isArray(payload) ? payload.entries() : Object.entries(payload);
    const rows = [];
    let count = 0;
    for (const [k, v] of entries) {
        if (count >= 40) break;
        budget.nodes += 1;
        count += 1;
        const keyLabel = Array.isArray(payload) ? `[${k}]` : String(k);
        const safeKey = escapeHtml(keyLabel);

        if (v && typeof v === 'object') {
            rows.push(`<div class="debug-kv" data-depth="${depth}"><div class="debug-k">${safeKey}</div><div class="debug-v">{…}</div></div>`);
            const nested = renderPayloadDetails(v, depth + 1, budget);
            if (nested) rows.push(nested);
        } else {
            const safeVal = escapeHtml(v == null ? '' : String(v));
            rows.push(`<div class="debug-kv" data-depth="${depth}"><div class="debug-k">${safeKey}</div><div class="debug-v">${safeVal}</div></div>`);
        }
    }
    if (rows.length === 0) return '';
    return `<div class="debug-payload">${rows.join('')}</div>`;
}

/**
 * Pobiera listę widocznych wpisów w panelu debugowania.
 * @returns {Array<Object>} Lista wpisów.
 * @complexity O(N)
 */
function getVisibleDebugEntries() {
    const total = debugEntries.length;
    const startIdx = Math.max(0, total - DEBUG_RENDER_LIMIT);
    const slice = debugEntries.slice(startIdx);
    const term = String(debugSearchTerm || '').trim().toLowerCase();
    return term ? slice.filter(e => String(e?.searchText || '').includes(term)) : slice;
}

/**
 * Renderuje listę logów w panelu debugowania.
 * @complexity O(N)
 */
function renderDebugLog() {
    if (!debugLogEl) return;
    if (!debugUiOpen) return;
    const entries = getVisibleDebugEntries();
    const shouldStickToBottom = (debugLogEl.scrollHeight - debugLogEl.scrollTop - debugLogEl.clientHeight) < 36;
    setElementHtml(debugLogEl, `<div class="debug-rows">${entries.map((e) => {
        const ts = formatTimestamp(e.ts);
        const level = String(e.level || 'INFO').toUpperCase();
        const action = String(e.action || '');
        const rowClass = level === 'ERROR' ? 'debug-row--error' : (level === 'WARN' ? 'debug-row--warn' : 'debug-row--info');
        const accentClass = ['search', 'preview', 'navigate', 'import'].includes(action) ? 'debug-row--accent' : '';
        const summary = formatDebugPayload(action, e.payload);
        const details = (e.payload && typeof e.payload === 'object' && !['search', 'preview', 'navigate', 'import'].includes(String(action).toLowerCase()))
            ? renderPayloadDetails(e.payload)
            : '';
        const message = summary || details ? `${summary}${details}` : '';
        const safeMessage = message || '';
        const rowClasses = ['debug-row', rowClass, accentClass].filter(Boolean).join(' ');
        return `<div class="${rowClasses}">
            <div class="debug-cell debug-ts">${escapeHtml(ts)}</div>
            <div class="debug-cell debug-level">${escapeHtml(level)}</div>
            <div class="debug-cell debug-action">${escapeHtml(action)}</div>
            <div class="debug-cell debug-msg">${safeMessage}</div>
        </div>`;
    }).join('')}</div>`);
    if (shouldStickToBottom) debugLogEl.scrollTop = debugLogEl.scrollHeight;
}

/**
 * Planuje renderowanie logów debugowania.
 * @complexity O(1)
 */
function scheduleDebugRender() {
    if (debugRenderQueued) return;
    debugRenderQueued = true;
    window.requestAnimationFrame(() => {
        debugRenderQueued = false;
        renderDebugLog();
    });
}

/**
 * Kopiuje tekst do schowka systemowego.
 * @param {string} text Tekst do skopiowania.
 * @returns {Promise<boolean>} Czy sukces.
 * @complexity O(N)
 */
async function copyTextToClipboard(text) {
    const value = String(text || '');
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', 'true');
        ta.className = 'qe-clipboard-ta';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

/**
 * Rejestruje akcję w panelu debugowania.
 * @param {string} action Akcja.
 * @param {any} payload Dane.
 * @param {string} level Poziom logowania.
 * @complexity O(N)
 */
function logAction(action, payload, level = 'INFO') {
    const act = String(action || '');
    const lvl = String(level || 'INFO').toUpperCase();
    const entry = { ts: Date.now(), action: act, payload: payload ?? null, level: lvl };
    entry.searchText = `${act} ${lvl} ${safeStringifyForSearch(payload)}`.toLowerCase();
    debugEntries.push(entry);
    scheduleDebugRender();
}

/**
 * Otwiera połączenie z bazą IndexedDB.
 * @returns {Promise<IDBDatabase>} Połączenie.
 * @complexity O(1)
 */
function openDocsDb() {
    if (docsDbPromise) return docsDbPromise;
    docsDbPromise = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(DOCS_DB_NAME, DOCS_DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(DOCS_DB_STORE)) {
                    db.createObjectStore(DOCS_DB_STORE, { keyPath: 'name' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Nie można otworzyć IndexedDB'));
        } catch (err) {
            reject(err);
        }
    });
    return docsDbPromise;
}

/**
 * Pobiera listę plików z bazy danych.
 * @returns {Promise<Array<Object>>} Lista plików.
 * @complexity O(F)
 */
async function docsListFiles() {
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_DB_STORE, 'readonly');
        const store = tx.objectStore(DOCS_DB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
            const rows = Array.isArray(req.result) ? req.result : [];
            resolve(rows.map(r => ({
                name: String(r?.name ?? ''),
                size: Number(r?.size ?? (r?.blob?.size ?? 0)),
                updatedAt: Number(r?.updatedAt ?? 0)
            })).filter(r => r.name));
        };
        req.onerror = () => reject(req.error || new Error('Błąd odczytu /docs'));
    });
}

/**
 * Pobiera Blob pliku z bazy danych.
 * @param {string} fileName Nazwa pliku.
 * @returns {Promise<Blob|null>} Blob.
 * @complexity O(log F)
 */
async function docsGetBlob(fileName) {
    const safe = String(fileName || '');
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_DB_STORE, 'readonly');
        const store = tx.objectStore(DOCS_DB_STORE);
        const req = store.get(safe);
        req.onsuccess = () => resolve(req.result?.blob ?? null);
        req.onerror = () => reject(req.error || new Error('Błąd odczytu pliku'));
    });
}

/**
 * Zapisuje Blob pliku w bazie danych.
 * @param {string} fileName Nazwa pliku.
 * @param {Blob} blob Blob.
 * @complexity O(log F + S)
 */
async function docsPutBlob(fileName, blob) {
    const safe = String(fileName || '').trim();
    if (!safe) throw new Error('Brak nazwy pliku');
    const db = await openDocsDb();
    const record = { name: safe, blob, size: blob?.size ?? 0, updatedAt: Date.now() };
    await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_DB_STORE, 'readwrite');
        const store = tx.objectStore(DOCS_DB_STORE);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('Błąd zapisu pliku'));
    });
}

// Inicjalizacja
async function init() {
    ensureFetchPolyfill();
    setupTheme();
    setupEventListeners();
    setupLoadingContinueHandlers();
    compileKeyLabTokenSets();
    queueSelfTests();

    // Grafika/logo są ładowane w idle, żeby nie blokować startu.
    lazyLoadWelcomeGraphic();
    renderHeaderLogo();

    setSearchEnabled(false);
    startLoadingScreen();
    loadingStartedAt = performance.now();
    logAction('boot', { phase: 'start' });

    await performInitialDataLoad();
}

async function performInitialDataLoad() {
    try {
        await openDocsDb();
        await loadAllFiles({ fullReload: true, showProgress: true });
        loadingDataReady = true;
        setSearchEnabled(allData.length > 0);
        if (allData.length === 0) {
            setLoadingStatusText('Brak danych. Kliknij „Dalej”, a potem zaimportuj pliki .xlsx/.xls/.csv.');
        }
    } catch (err) {
        handleInitialLoadError(err);
    } finally {
        finalizeBoot();
    }
}

function handleInitialLoadError(err) {
    loadingFailed = true;
    setSearchEnabled(false);
    showLoadingError('Błąd ładowania danych. Zaimportuj pliki .xlsx/.xls/.csv.');
    logAction('boot', { phase: 'error', message: err?.message ? String(err.message) : 'error' }, 'ERROR');
}

function finalizeBoot() {
    loadingProgressDone = true;
    prepareManualContinue();
    const totalMs = Math.round(performance.now() - loadingStartedAt);
    logAction('boot', { phase: 'done', ms: totalMs });
}

// Obsługa motywów
function setupTheme() {
    const savedTheme = storageGet('theme') || 'dark';
    applyTheme(savedTheme);
    themeToggle.checked = savedTheme === 'dark';

    themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        applyTheme(newTheme);
        storageSet('theme', newTheme);
        logClientEvent('theme', { theme: newTheme });
    });
}

function applyTheme(theme) {
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(theme + '-theme');
    themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';

    // Logo w headerze i grafika powitalna reagują na motyw:
    // - w dark theme delikatnie jaśniejszy tekst dla czytelności
    renderHeaderLogo();
    refreshWelcomeGraphicIfPresent();
}

// Event Listeners
function setupEventListeners() {
    setupSearchListeners();
    setupImportListeners();
    setupDebugListeners();
    setupDragAndDropListeners();
    setupNavigationListeners();
    setupGlobalErrorListeners();

    document.addEventListener('qe:preview-ready', () => highlightLabsInPreviewTable(), { passive: true });
}

function setupSearchListeners() {
    const debouncedSearch = debounce((query) => performSearch(query), 180);
    const debouncedLogSearch = debounce((query) => logClientEvent('search', { query }), 450);
    debouncedSearchRef = debouncedSearch;
    debouncedLogSearchRef = debouncedLogSearch;

    searchInput.addEventListener('input', (e) => {
        if (!isSearchEnabled) return;
        const query = e.target.value.trim();
        handleSearchInput(query, debouncedSearch, debouncedLogSearch);
    });

    searchInput.addEventListener('keydown', handleKeyNavigation);
}

function handleSearchInput(query, debouncedSearch, debouncedLogSearch) {
    if (query.length >= 3) {
        debouncedSearch(query);
        debouncedLogSearch(query);
    } else {
        debouncedSearch.cancel();
        debouncedLogSearch.cancel();
        
        if (query.length > 0) {
            statusIndicator.textContent = 'Wpisz minimum 3 znaki, aby wyszukać...';
            statusIndicator.classList.add('status--hint');
        } else {
            statusIndicator.textContent = 'Dane gotowe.';
            statusIndicator.classList.remove('status--hint');
        }
        
        clearResults();
    }
}

function setupImportListeners() {
    if (importButton) importButton.addEventListener('click', () => {
        logAction('import', { phase: 'open_dialog' }, 'INFO');
        fileInput?.click();
    });
    if (importGoogleDriveButton) importGoogleDriveButton.addEventListener('click', async () => {
        logAction('import', { phase: 'open_google_picker' }, 'INFO');
        await handleImportGoogleDrive();
    });
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) await handleImportFiles(files);
            fileInput.value = '';
        });
    }
}

function setupDebugListeners() {
    if (debugTrayToggle) {
        debugTrayToggle.addEventListener('click', () => setDebugUiOpen(!debugUiOpen));
    }
    if (debugMinimizeButton) {
        debugMinimizeButton.addEventListener('click', () => setDebugUiOpen(false));
    }
    if (debugSearchInput) {
        debugSearchInput.addEventListener('input', () => {
            debugSearchTerm = String(debugSearchInput.value || '');
            scheduleDebugRender();
        });
    }
    if (debugCopyButton) {
        debugCopyButton.addEventListener('click', handleDebugCopy);
    }
    if (debugClearButton) {
        debugClearButton.addEventListener('click', () => {
            debugEntries = [];
            scheduleDebugRender();
        });
    }
}

async function handleDebugCopy() {
    const entries = getVisibleDebugEntries();
    const text = entries.map((e) => {
        const ts = formatTimestamp(e.ts);
        const level = String(e.level || 'INFO').toUpperCase();
        const action = String(e.action || '');
        const payload = safeStringifyForSearch(e.payload);
        return `[${ts}] [${level}] ${action}${payload ? ' ' + payload : ''}`;
    }).join('\n');
    const ok = await copyTextToClipboard(text);
    logAction('debug', { action: 'copy', ok, lines: entries.length }, ok ? 'INFO' : 'WARN');
}

function setupDragAndDropListeners() {
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => {
        const dt = e.dataTransfer;
        if (!dt || !Array.from(dt.types || []).includes('Files')) return;
        dragDepth += 1;
        setDropZoneVisible(true);
    });
    document.addEventListener('dragleave', (e) => {
        const dt = e.dataTransfer;
        if (!dt || !Array.from(dt.types || []).includes('Files')) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) setDropZoneVisible(false);
    });
    document.addEventListener('dragover', (e) => {
        const dt = e.dataTransfer;
        if (!dt || !Array.from(dt.types || []).includes('Files')) return;
        e.preventDefault();
    });
    document.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        if (!dt || !dt.files || dt.files.length === 0) return;
        e.preventDefault();
        dragDepth = 0;
        setDropZoneVisible(false);
        logAction('import', { phase: 'drop', files: dt.files.length }, 'INFO');
        await handleImportFiles(Array.from(dt.files));
    });
}

function setupNavigationListeners() {
    backToSearchBtn.addEventListener('click', () => {
        filePreviewView.classList.add('hidden');
        searchView.classList.remove('hidden');
        logClientEvent('navigate', { to: 'search' });
    });

    if (homeLink) {
        homeLink.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            resetToInitialState({ source: 'home' });
            logClientEvent('navigate', { to: 'home' });
            try { history.pushState(null, '', './'); } catch { }
        });
    }

    if (showMoreButton) {
        showMoreButton.addEventListener('click', () => {
            logClientEvent('paginate', { action: 'show_more' });
            loadMoreResults();
        });
    }
}

function setupGlobalErrorListeners() {
    window.addEventListener('error', (e) => {
        const msg = e?.message ? String(e.message) : 'window.error';
        logAction('error', { message: msg }, 'ERROR');
    });
    window.addEventListener('unhandledrejection', (e) => {
        const reason = e?.reason;
        const msg = reason?.message ? String(reason.message) : (reason ? String(reason) : 'unhandledrejection');
        logAction('error', { message: msg }, 'ERROR');
    });
}

// Ładowanie i procesowanie plików
async function loadAllFiles({ fullReload, showProgress } = { fullReload: false, showProgress: false }) {
    if (isLoading) return;
    isLoading = true;
    const loadStart = performance.now();

    try {
        const spreadsheetFiles = await getSpreadsheetFiles();
        fileCountSpan.textContent = spreadsheetFiles.length;

        if (fullReload) resetAppData();

        const filesToLoad = fullReload
            ? spreadsheetFiles
            : spreadsheetFiles.filter(f => !loadedFiles.has(f));

        if (showProgress) updateLoadingProgressStart(filesToLoad.length);

        if (filesToLoad.length > 0) {
            await processFilesWithConcurrency(filesToLoad, showProgress);
            statusIndicator.textContent = loadErrors.length > 0
                ? `Dane gotowe (błędy: ${loadErrors.length}).`
                : 'Dane gotowe.';
        } else {
            statusIndicator.textContent = 'Dane aktualne.';
        }

        if (isSearchEnabled && lastQuery && lastQuery.trim().length >= 3) {
            performSearch(lastQuery.trim());
        }
    } catch (error) {
        handleLoadError(error, showProgress);
        if (showProgress) throw error;
    } finally {
        finalizeLoad(loadStart, showProgress);
    }
}

async function getSpreadsheetFiles() {
    statusIndicator.textContent = 'Sprawdzanie plików...';
    const files = await docsListFiles();
    const spreadsheetFiles = Array.isArray(files)
        ? files.map(f => String(f?.name ?? '')).filter(f => {
            const lower = f.toLowerCase();
            return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
        })
        : [];
    spreadsheetFiles.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
    return spreadsheetFiles;
}

function resetAppData() {
    allData = [];
    currentResults = [];
    selectedResultIndex = -1;
    lastQuery = '';
    loadedFiles = new Set();
    fullFileData = {};
    loadErrors = [];
}

function updateLoadingProgressStart(total) {
    setLoadingStatusText(total === 0 ? 'Brak plików .xlsx/.csv. Zaimportuj dane.' : 'Wczytywanie plików...');
    setLoadingProgressPercent(total === 0 ? 100 : 0, { force: true });
}

async function processFilesWithConcurrency(filesToLoad, showProgress) {
    let done = 0;
    const total = filesToLoad.length;
    const concurrency = Math.max(1, Math.min(6, (navigator?.hardwareConcurrency ? Math.floor(navigator.hardwareConcurrency / 2) : 4)));
    let cursor = 0;
    
    const workers = new Array(Math.min(concurrency, total)).fill(0).map(async () => {
        while (true) {
            const i = cursor++;
            if (i >= total) break;
            const file = filesToLoad[i];
            const displayName = formatFileName(file);
            if (showProgress) setLoadingStatusText(`Wczytuję: ${displayName}`);

            try {
                await processFile(file);
                loadedFiles.add(file);
            } catch (err) {
                loadErrors.push({ fileName: String(file), message: err?.message ? String(err.message) : 'Błąd pliku' });
                logAction('load_file', { fileName: String(file), message: err?.message ? String(err.message) : 'Błąd pliku' }, 'WARN');
            } finally {
                done += 1;
                if (showProgress) {
                    const percent = total > 0 ? (done / total) * 100 : 100;
                    setLoadingProgressPercent(percent);
                }
            }
        }
    });
    await Promise.all(workers);
}

function handleLoadError(error, showProgress) {
    statusIndicator.textContent = 'Błąd ładowania.';
    if (showProgress) showLoadingError('Błąd ładowania danych.');
    logAction('load', { message: error?.message ? String(error.message) : 'Błąd ładowania' }, 'ERROR');
}

function finalizeLoad(loadStart, showProgress) {
    isLoading = false;
    if (showProgress) {
        const label = loadErrors.length > 0 ? `Gotowe (błędy: ${loadErrors.length}).` : 'Gotowe.';
        setLoadingStatusText(label);
        setLoadingProgressPercent(100);
    }
    const loadTime = Math.round(performance.now() - loadStart);
    logAction('load', { ms: loadTime, errors: loadErrors.length });
}

async function processFile(fileName) {
    const blob = await docsGetBlob(fileName);
    if (!blob) throw new Error('Nie można odczytać pliku z /docs');
    await parseSpreadsheet(blob, fileName);
}

async function parseSpreadsheet(source, fileName) {
    try {
        const workbook = await readWorkbook(source, fileName);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true, defval: '' });

        const tableModel = buildTableModel(matrix);
        fullFileData[fileName] = tableModel;
        addTableRows(tableModel, fileName);
    } catch (err) {
        logAction('parse', { fileName: String(fileName || ''), message: err?.message ? String(err.message) : 'Błąd parsowania' }, 'ERROR');
        throw err;
    }
}

async function readWorkbook(source, fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.csv')) {
        const csvContent = typeof source === 'string' 
            ? source 
            : (source && typeof source.text === 'function' ? await source.text() : '');
        return XLSX.read(csvContent, { type: 'string' });
    }
    
    const buffer = await getArrayBufferFromSource(source);
    return XLSX.read(buffer);
}

async function getArrayBufferFromSource(source) {
    if (source instanceof ArrayBuffer) return source;
    if (ArrayBuffer.isView(source)) {
        const view = source;
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    if (source && typeof source.arrayBuffer === 'function') return await source.arrayBuffer();
    throw new Error('Nieprawidłowe dane wejściowe do parsowania');
}

function addTableRows(tableModel, fileName) {
    if (!tableModel || !Array.isArray(tableModel.rows)) return 0;
    const existingKeys = new Set(allData.map(d => `${d.fileName}:${d.rowIndex}`));

    const normalizedRows = [];
    for (const row of tableModel.rows) {
        const key = `${fileName}:${row.originalRowIndex}`;
        if (existingKeys.has(key)) continue;

        const normalizedRow = createNormalizedRow(row, tableModel, fileName);
        if (normalizedRow) normalizedRows.push(normalizedRow);
    }

    allData = allData.concat(normalizedRows);
    return normalizedRows.length;
}

function createNormalizedRow(row, tableModel, fileName) {
    const displayText = getRowDisplayText(row, tableModel);
    if (!displayText.trim()) return null;

    const searchableText = `${displayText} ${fileName} ${row.cells.join(' ')}`;
    return {
        fileName: fileName,
        rowIndex: row.originalRowIndex,
        displayText: displayText,
        searchable: normalizeText(searchableText),
        searchableFuzzy: fuzzyNormalizeText(searchableText),
        isComplete: tableModel.isCompleteStructure,
        headerMap: tableModel.headerMap,
        cells: row.cells
    };
}

function getRowDisplayText(row, tableModel) {
    if (tableModel.isCompleteStructure) {
        const h = tableModel.headerMap;
        const time = row.cells[h.GODZ] || '-';
        const address = row.cells[h.ADRES] || '';
        const facility = row.cells[h.NAZWA_PLACOWKI] || '';
        return `${time} | ${address} | ${facility}`;
    }
    return row.cells.filter(c => !isEmptyCell(c)).join(' | ');
}

function removeFileData(fileName) {
    const safe = String(fileName || '');
    if (!safe) return;
    allData = allData.filter(d => d?.fileName !== safe);
    delete fullFileData[safe];
    loadErrors = loadErrors.filter(e => e?.fileName !== safe);
}

function setSearchEnabled(enabled) {
    isSearchEnabled = enabled;
    searchInput.disabled = !enabled;
    searchInput.setAttribute('aria-disabled', (!enabled).toString());
}

function startLoadingScreen() {
    if (!loadingOverlay) return;
    loadingOverlay.classList.remove('hidden');
    loadingOverlay.setAttribute('aria-hidden', 'false');
    loadingOverlay.setAttribute('aria-busy', 'true');
    if (loadingError) {
        loadingError.textContent = '';
        loadingError.classList.add('hidden');
    }
    if (loadingContinueButton) loadingContinueButton.disabled = true;
    loadingProgressDone = false;
    setLoadingProgressPercent(0, { force: true });
    setLoadingStatusText('Inicjalizacja...');

}

function focusBodySafely() {
    const body = document.body;
    if (!body) return;
    const prevTabIndex = body.getAttribute('tabindex');
    body.setAttribute('tabindex', '-1');
    try { body.focus({ preventScroll: true }); } catch { try { body.focus(); } catch { } }
    if (prevTabIndex == null) body.removeAttribute('tabindex');
    else body.setAttribute('tabindex', prevTabIndex);
}

function stopLoadingScreen() {
    if (!loadingOverlay) return;

    const active = document.activeElement;
    if (active && loadingOverlay.contains(active)) {
        try { active.blur(); } catch { }
        focusBodySafely();
    }

    loadingOverlay.classList.add('hidden');
    loadingOverlay.setAttribute('aria-hidden', 'true');
}

function setupLoadingContinueHandlers() {
    if (loadingContinueButton) {
        loadingContinueButton.addEventListener('click', continueToApp);
    }
}

function continueToApp() {
    stopLoadingScreen();

    // Wymóg: wejście aplikacji ma mieć opóźnienie 0.3s od DOM ready.
    const elapsedSinceDomReady = performance.now() - DOM_READY_TS;
    const remainingDelay = Math.max(0, 300 - elapsedSinceDomReady);
    window.setTimeout(() => {
        if (appShell) {
            appShell.classList.remove('app-shell-hidden');
            appShell.setAttribute('aria-hidden', 'false');
        }
        if (isSearchEnabled) searchInput.focus();
    }, remainingDelay);
}


function getLogoPalette() {
    // Uwaga: wartości CSS variables bierzemy z body, bo motyw jest ustawiany na body (.dark-theme/.light-theme).
    const bodyStyle = getComputedStyle(document.body);
    const primary = bodyStyle.getPropertyValue('--primary-color').trim() || '#0066CC';
    const baseTextColor = bodyStyle.getPropertyValue('--text-color').trim() || '#333333';
    const isDark = document.body.classList.contains('dark-theme');
    const textStrong = isDark ? 'rgba(255, 255, 255, 0.92)' : baseTextColor;
    const textSoft = isDark ? 'rgba(255, 255, 255, 0.78)' : baseTextColor;
    return { primary, textStrong, textSoft };
}

function buildQuickEvoLogoSvg({ size }) {
    const { primary, textStrong, textSoft } = getLogoPalette();
    const fontSize = size === 'header' ? 40 : 56;
    const lineY = size === 'header' ? 14 : 18;
    const textY = size === 'header' ? 4 : 0;
    const viewBox = '0 0 640 180';
    const prefix = `qe${++logoInstanceCounter}`;

    // SVG jest wstrzykiwany w 2 miejscach (splash + header). Prefix eliminuje konflikt id w <defs>.
    return `
        <svg viewBox="${viewBox}" role="img" aria-label="QuickEvo" xmlns="http://www.w3.org/2000/svg" data-qe-logo-size="${size}">
            <defs>
                <linearGradient id="${prefix}Grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="${primary}" stop-opacity="0.95"></stop>
                    <stop offset="1" stop-color="${primary}" stop-opacity="0.35"></stop>
                </linearGradient>
                <filter id="${prefix}Soft" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur"></feGaussianBlur>
                    <feColorMatrix in="blur" type="matrix"
                        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0" result="soft"></feColorMatrix>
                    <feMerge>
                        <feMergeNode in="soft"></feMergeNode>
                        <feMergeNode in="SourceGraphic"></feMergeNode>
                    </feMerge>
                </filter>
            </defs>

            <g transform="translate(72 90)" filter="url(#${prefix}Soft)">
                <circle class="qe-pulse" cx="0" cy="0" r="34" fill="url(#${prefix}Grad)"></circle>
                <circle cx="0" cy="0" r="52" fill="none" stroke="${primary}" stroke-opacity="0.35" stroke-width="3"></circle>
                <g class="qe-orbit" data-qe-orbit="1">
                    <circle class="qe-orbit-dot qe-orbit-dot--a" data-qe-orbit-dot="a" cx="52" cy="0" r="6" fill="${primary}"></circle>
                    <circle class="qe-orbit-dot qe-orbit-dot--b" data-qe-orbit-dot="b" cx="-26" cy="45" r="4" fill="${primary}" fill-opacity="0.75"></circle>
                </g>
            </g>

            <g transform="translate(150 110)">
                <text x="0" y="${textY}" font-family="Segoe UI, system-ui, -apple-system, Arial" font-size="${fontSize}" font-weight="800" fill="${textStrong}">
                    Quick<tspan font-weight="300" fill="${textSoft}">Evo</tspan>
                </text>
                <path d="M0 ${lineY} H460" stroke="${primary}" stroke-opacity="0.30" stroke-width="3" stroke-linecap="round"></path>
            </g>
        </svg>
    `;
}

const logoOrbitControllers = new WeakMap();

function parseCssNumber(value, fallback) {
    const n = parseFloat(String(value ?? '').trim());
    return Number.isFinite(n) ? n : fallback;
}

function getLogoOrbitConfig(size) {
    const rootStyle = getComputedStyle(document.documentElement);
    const radius = parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-radius-${size}`), 52);
    const period = Math.max(0.2, parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-period-${size}`), size === 'header' ? 4.8 : 3.2));
    const dirRaw = parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-direction-${size}`), 1);
    const dir = dirRaw >= 0 ? 1 : -1;
    return { radius, period, dir };
}

function shouldReduceMotion() {
    try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}

function startLogoOrbit(svg, size) {
    if (!svg || logoOrbitControllers.has(svg)) return;
    if (shouldReduceMotion()) return;

    const orbitGroup = svg.querySelector('g[data-qe-orbit="1"]');
    if (!orbitGroup) return;
    const dotA = orbitGroup.querySelector('[data-qe-orbit-dot="a"]');
    const dotB = orbitGroup.querySelector('[data-qe-orbit-dot="b"]');
    if (!dotA || !dotB) return;

    let cfg = getLogoOrbitConfig(size);
    let lastCfgTs = 0;
    const startTs = performance.now();
    const phaseB = 2.05;
    const radiusBScale = 0.72;

    const tick = (ts) => {
        if (!svg.isConnected) {
            logoOrbitControllers.delete(svg);
            return;
        }
        if (shouldReduceMotion()) {
            logoOrbitControllers.delete(svg);
            return;
        }
        if ((ts - lastCfgTs) > 700) {
            cfg = getLogoOrbitConfig(size);
            lastCfgTs = ts;
        }

        const t = (ts - startTs) / 1000;
        const theta = cfg.dir * (t / cfg.period) * Math.PI * 2;

        const ax = cfg.radius * Math.cos(theta);
        const ay = cfg.radius * Math.sin(theta);
        dotA.setAttribute('cx', ax.toFixed(2));
        dotA.setAttribute('cy', ay.toFixed(2));

        const bx = (cfg.radius * radiusBScale) * Math.cos(theta + phaseB);
        const by = (cfg.radius * radiusBScale) * Math.sin(theta + phaseB);
        dotB.setAttribute('cx', bx.toFixed(2));
        dotB.setAttribute('cy', by.toFixed(2));

        const rafId = window.requestAnimationFrame(tick);
        logoOrbitControllers.set(svg, { rafId });
    };

    const rafId = window.requestAnimationFrame(tick);
    logoOrbitControllers.set(svg, { rafId });
}

function startLogoOrbitInContainer(container, size) {
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    startLogoOrbit(svg, size);
}

function renderHeaderLogo() {
    if (!appHeaderLogo) return;
    setElementSvg(appHeaderLogo, buildQuickEvoLogoSvg({ size: 'header' }));
    startLogoOrbitInContainer(appHeaderLogo, 'header');
}

function refreshWelcomeGraphicIfPresent() {
    const container = document.getElementById('welcome-graphic');
    if (!container) return;
    if (container.dataset.loaded !== '1') return;
    setElementSvg(container, buildQuickEvoLogoSvg({ size: 'welcome' }));
    startLogoOrbitInContainer(container, 'welcome');
}

function lazyLoadWelcomeGraphic() {
    const container = document.getElementById('welcome-graphic');
    if (!container) return;

    const inject = () => {
        if (container.dataset.loaded === '1') return;
        container.dataset.loaded = '1';
        setElementSvg(container, buildQuickEvoLogoSvg({ size: 'welcome' }));
        startLogoOrbitInContainer(container, 'welcome');
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(inject, { timeout: 900 });
    } else {
        window.setTimeout(inject, 350);
    }
}

/**
 * Aktualizuje pasek postępu loadera.
 * - Nie cofa paska (chyba że force=true), żeby uniknąć "szarpania" UI.
 * - Edge cases: Na błędach/timeoutach pasek zostaje na ostatniej znanej wartości.
 */
function setLoadingProgressPercent(percent, { force = false } = {}) {
    if (!loadingOverlay) return;
    const safePercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
    const next = force ? safePercent : Math.max(loadingProgressValue, safePercent);
    loadingProgressValue = next;
    const rounded = Math.round(next);
    if (loadingProgressMeta) loadingProgressMeta.textContent = `${rounded}%`;
    if (loadingProgressBar) loadingProgressBar.value = next;
}

function setLoadingStatusText(text) {
    if (loadingStatusText) loadingStatusText.textContent = text || '';
}

function showLoadingError(message) {
    setLoadingStatusText('Wystąpił problem podczas ładowania.');
    if (!loadingError) return;
    loadingError.textContent = message || 'Nieznany błąd ładowania.';
    loadingError.classList.remove('hidden');
}

function prepareManualContinue() {
    if (loadingFailed) {
        showLoadingError('Nie udało się załadować wszystkich danych. Możesz kontynuować i spróbować ponownie później.');
    } else if (loadErrors.length > 0) {
        showLoadingError(`Załadowano aplikację z błędami plików: ${loadErrors.length}.`);
        if (loadingStatusText) {
            loadingStatusText.textContent = 'Podstawowe dane są gotowe.';
        }
    } else {
        setLoadingStatusText('Ładowanie zakończone pomyślnie.');
    }

    if (loadingProgressDone && (loadingDataReady || loadingFailed)) {
        if (loadingContinueButton) loadingContinueButton.disabled = false;
        if (loadingOverlay) loadingOverlay.setAttribute('aria-busy', 'false');
    }
}

function debounce(fn, delayMs) {
    let timerId = null;
    const debounced = (...args) => {
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(() => fn(...args), delayMs);
    };
    debounced.cancel = () => {
        if (timerId) clearTimeout(timerId);
        timerId = null;
    };
    return debounced;
}

function buildTableModel(matrix) {
    const rect = normalizeMatrix(matrix);
    const bounds = computeNonEmptyBounds(rect);
    if (!bounds) return { headers: [], rows: [], metaLines: [], isCompleteStructure: false };

    const cropped = rect
        .slice(bounds.minRow, bounds.maxRow + 1)
        .map(row => row.slice(bounds.minCol, bounds.maxCol + 1));

    const headerRowRel = findHeaderRowIndex(cropped);
    const rawHeaders = cropped[headerRowRel].map(cellToHeaderText);
    const headerMap = mapRequiredHeaders(rawHeaders);
    const isCompleteStructure = Object.keys(headerMap).length === 5; // Liczba wymaganych nagłówków

    const metaLines = extractMetaLines(cropped, headerRowRel);
    const dataRelRows = cropped.slice(headerRowRel + 1);
    const rawDataRows = processDataRows(dataRelRows, headerMap, bounds.minRow + headerRowRel + 1);

    return { headers: rawHeaders, rows: rawDataRows, metaLines, isCompleteStructure, headerMap };
}

function mapRequiredHeaders(rawHeaders) {
    const requiredHeaders = {
        'NR_POL': ['NR. PÓŁ', 'NR PÓŁ', 'NR. POL', 'NR POL', 'PÓŁKA', 'POLKA'],
        'GODZ': ['GODZ', 'GODZINA', 'GODZ.'],
        'ADRES': ['ADRES', 'ULICA'],
        'NAZWA_PLACOWKI': ['NAZWA PLACÓWKI', 'PLACÓWKA', 'PLACOWKA', 'NAZWA'],
        'UWAGI': ['UWAGI']
    };

    const headerMap = {};
    Object.entries(requiredHeaders).forEach(([key, aliases]) => {
        const index = rawHeaders.findIndex(h => {
            const normH = fuzzyNormalizeText(h).toUpperCase();
            return aliases.some(alias => fuzzyNormalizeText(alias).toUpperCase() === normH);
        });
        if (index >= 0) headerMap[key] = index;
    });
    return headerMap;
}

function extractMetaLines(cropped, headerRowRel) {
    const metaLines = [];
    for (let r = 0; r < headerRowRel; r++) {
        const parts = cropped[r]
            .filter(v => !isEmptyCell(v))
            .map(v => String(formatCellValue(v)).trim())
            .filter(v => v.length > 0);
        if (parts.length > 0) metaLines.push(parts.join(' | '));
    }
    return metaLines;
}

function processDataRows(dataRelRows, headerMap, startRowIndex) {
    const rawDataRows = [];
    for (let r = 0; r < dataRelRows.length; r++) {
        const row = dataRelRows[r];
        if (row.every(isEmptyCell)) continue;
        
        const cleanedCells = row.map((cell, idx) => formatCellContent(cell, idx, headerMap));
        rawDataRows.push({ 
            originalRowIndex: startRowIndex + r, 
            cells: cleanedCells 
        });
    }
    return rawDataRows;
}

function formatCellContent(cell, idx, headerMap) {
    if (idx === headerMap['NR_POL']) {
        const val = parseInt(cell);
        return isNaN(val) ? '' : val;
    }
    
    const formatted = formatCellValue(cell);
    if (idx === headerMap['GODZ']) {
        return (formatted === '' || formatted === '-') ? '-' : formatted;
    }
    return formatted;
}

function normalizeMatrix(matrix) {
    const safe = Array.isArray(matrix) ? matrix : [];
    const maxCols = safe.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
    return safe.map((row) => {
        const r = Array.isArray(row) ? row.slice() : [];
        while (r.length < maxCols) r.push('');
        return r;
    });
}

function computeNonEmptyBounds(matrix) {
    let minRow = Infinity;
    let maxRow = -1;
    let minCol = Infinity;
    let maxCol = -1;

    for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r];
        for (let c = 0; c < row.length; c++) {
            if (!isEmptyCell(row[c])) {
                if (r < minRow) minRow = r;
                if (r > maxRow) maxRow = r;
                if (c < minCol) minCol = c;
                if (c > maxCol) maxCol = c;
            }
        }
    }

    if (maxRow === -1) return null;
    return { minRow, maxRow, minCol, maxCol };
}

function findHeaderRowIndex(cropped) {
    const counts = cropped.map(countNonEmpty);
    for (let i = 0; i < cropped.length; i++) {
        if (counts[i] < 2) continue;
        const laterHasData = counts.slice(i + 1).some(c => c >= 2);
        if (laterHasData) return i;
    }
    return 0;
}

// Pomocnicze funkcje tekstowe i walidacyjne
function countNonEmpty(row) {
    if (!Array.isArray(row)) return 0;
    let n = 0;
    for (const cell of row) {
        if (!isEmptyCell(cell)) n += 1;
    }
    return n;
}

function isEmptyCell(cell) {
    if (cell === null || cell === undefined) return true;
    if (typeof cell === 'string') return cell.trim() === '';
    return false;
}

function cellToHeaderText(cell) {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') return cell.trim();
    const time = parseTimeString(String(cell));
    if (time) return time;
    return String(cell).trim();
}

function isTimeValue(value) {
    if (value === null || value === undefined) return false;

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 0 && value < 1) return true;
        if (value >= 1000 && value < 60000) {
            const frac = value % 1;
            return frac > 0 && frac < 1;
        }
        return false;
    }

    if (typeof value === 'string') return Boolean(parseTimeString(value));
    return false;
}

let searchSeq = 0;
let activeSearchSeq = 0;

async function performSearch(query) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
        handleSearchShortQuery();
        return;
    }

    statusIndicator.textContent = 'Szukanie...';
    statusIndicator.classList.remove('status--hint');
    lastQuery = trimmedQuery;
    activeSearchSeq = ++searchSeq;
    selectedResultIndex = -1;

    try {
        matchedResults = await executeSearch(trimmedQuery);
        
        currentResults = [];
        clearElement(resultsList);
        setShowMoreErrorMessage('');

        if (matchedResults.length === 0) {
            handleNoSearchResults();
            return;
        }

        statusIndicator.textContent = 'Dane gotowe.';
        await loadMoreResults({ reset: true, seq: activeSearchSeq });
    } catch (err) {
        handleSearchError(err);
    }
}

function handleSearchShortQuery() {
    statusIndicator.textContent = 'Wpisz minimum 3 znaki, aby wyszukać...';
    statusIndicator.classList.add('status--hint');
    clearResults();
}

async function executeSearch(query) {
    if (searchCache.has(query)) return searchCache.get(query);

    const lowerQuery = normalizeText(query);
    const fuzzyQuery = fuzzyNormalizeText(query);

    const filtered = allData.filter(item => matchItem(item, lowerQuery, fuzzyQuery));
    const grouped = groupSearchResults(filtered);
    
    updateSearchCache(query, grouped);
    return grouped;
}

function matchItem(item, lowerQuery, fuzzyQuery) {
    const matches = item.searchable.includes(lowerQuery) || item.searchableFuzzy.includes(fuzzyQuery);
    if (!matches) return false;

    if (item.isComplete) {
        const h = item.headerMap;
        if (!h) return true;
        return item.cells.some((cell, idx) => {
            if (idx === h.NR_POL || idx === h.UWAGI) return false;
            const cellText = String(cell ?? '');
            return normalizeText(cellText).includes(lowerQuery) || fuzzyNormalizeText(cellText).includes(fuzzyQuery);
        });
    }
    return true;
}

function groupSearchResults(filtered) {
    const groups = new Map();
    for (const item of filtered) {
        if (!groups.has(item.fileName)) {
            groups.set(item.fileName, {
                fileName: item.fileName,
                isComplete: item.isComplete,
                items: []
            });
        }
        groups.get(item.fileName).items.push(item);
    }
    return Array.from(groups.values());
}

function updateSearchCache(query, results) {
    if (searchCache.size > 50) {
        const firstKey = searchCache.keys().next().value;
        searchCache.delete(firstKey);
    }
    searchCache.set(query, results);
}

function handleNoSearchResults() {
    resultsInfo.textContent = 'Brak wyników.';
    statusIndicator.textContent = 'Dane gotowe.';
    updateResultsFooter();
}

function handleSearchError(err) {
    console.error('Search error:', err);
    logAction('search_error', { message: err.message }, 'ERROR');
    statusIndicator.textContent = 'Błąd wyszukiwania.';
    resultsInfo.textContent = 'Wystąpił błąd podczas przeszukiwania danych.';
}

function renderResults(query, { append = false, startIndex = 0 } = {}) {
    if (!append) clearElement(resultsList);

    if (currentResults.length === 0) {
        handleNoResultsToRender();
        return;
    }

    updateResultsCountInfo();

    const fragment = document.createDocumentFragment();
    for (let index = startIndex; index < currentResults.length; index++) {
        const group = currentResults[index];
        const groupDiv = createResultGroupElement(group, index, query);
        fragment.appendChild(groupDiv);
    }
    resultsList.appendChild(fragment);

    updateResultsFooter();
}

function handleNoResultsToRender() {
    resultsInfo.textContent = 'Brak wyników.';
    updateResultsFooter();
}

function updateResultsCountInfo() {
    const totalRoutes = loadedFiles.size;
    const matchedRoutesCount = matchedResults.length;
    resultsInfo.innerHTML = `Trasy: ${matchedRoutesCount} / ${totalRoutes}`;
}

function createResultGroupElement(group, index, query) {
    const routeName = formatRouteNameForResults(group.fileName);
    const groupDiv = document.createElement('div');
    groupDiv.className = 'result-group';
    groupDiv.dataset.index = index;
    if (index === selectedResultIndex) groupDiv.classList.add('selected');

    const rowsHtml = group.items.map(item => {
        const isLab = item.isComplete ? rowMatchesKeyLab(item.cells.join(' ')) : false;
        const rowClass = isLab ? 'result-row result-row--lab' : 'result-row';
        const summaryHtml = buildResultSummaryHtml(item, query, { isLab });
        return `
            <div class="${rowClass}" data-row-index="${item.rowIndex}" data-file-name="${escapeHtml(item.fileName)}">
                <div class="result-content">${summaryHtml}</div>
            </div>
        `;
    }).join('');

    setElementHtml(groupDiv, `
        <div class="result-group-header">
            <span class="result-filename"><span class="result-route-name">${routeName}</span></span>
        </div>
        <div class="result-group-body">
            ${rowsHtml}
        </div>
    `);
    return groupDiv;
}

// Obsługa kliknięć w wyniki (delegacja zdarzeń)
resultsList.addEventListener('click', (e) => {
    const row = e.target.closest('.result-row');
    if (row) {
        const fileName = row.dataset.fileName;
        const rowIndex = parseInt(row.dataset.rowIndex);
        if (fileName && !isNaN(rowIndex)) {
            showFilePreview(fileName, rowIndex);
        }
        return;
    }

    const group = e.target.closest('.result-group');
    if (group) {
        const index = parseInt(group.dataset.index);
        const groupData = currentResults[index];
        if (groupData) {
            showFilePreview(groupData.fileName, groupData.items[0].rowIndex);
        }
    }
});

/**
 * Czyści nazwę pliku z fragmentów w nawiasach okrągłych
 */
function formatFileName(fileName) {
    // Usuwa zawartość w nawiasach okrągłych wraz z nawiasami
    let name = fileName.replace(/\s*\([^)]*\)/g, '');
    // Usuwa rozszerzenie .xlsx dla czystości widoku (opcjonalnie, ale poprawia estetykę)
    name = name.replace(/\.xlsx$/i, '');
    // Usuwa podwójne spacje powstałe po usunięciu nawiasów
    return name.replace(/\s+/g, ' ').trim();
}

/**
 * Parser nazwy trasy na potrzeby listy wyników.
 * Wymagania:
 * - ekstrakcja identyfikatora z nazwy pliku
 * - format: "TRASA X" (X = numer/litera, ewentualnie np. "S-1")
 * - usunięcie dat, nawiasów i znaków zbędnych z wyświetlanej nazwy trasy
 */
function formatRouteNameForResults(fileName) {
    const base = String(fileName || '')
        .replace(/\.xlsx$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const match = base.match(/\btrasa\b\s*([A-Za-zĄĆĘŁŃÓŚŹŻ0-9]+(?:\s*[-–]\s*\d+)?)\b/i);
    if (match && match[1]) {
        const code = match[1]
            .replace(/\s*[-–]\s*/g, '-')
            .replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻ0-9-]/g, '')
            .toUpperCase();
        if (code) return `TRASA ${code}`;
    }

    // Fallback: gdy plik nie jest trasą (np. grafik/inna lista), pokazujemy możliwie czystą nazwę.
    return base
        .replace(/[\[\]\{\}]/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, '')
        .replace(/[^\p{L}\p{N}\s-]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

/**
 * Buduje podgląd wiersza w wynikach:
 * - pomija 1. kolumnę z numerem półki
 * - pokazuje tylko 3 pola: godzina, adres, placówka
 */
function buildResultSummaryHtml(result, query, { isLab = false } = {}) {
    if (result.isComplete) {
        const parts = result.displayText.split('|').map(s => s.trim());
        const time = parts[0] || '—';
        const address = parts[1] || '';
        const facility = parts[2] || '';
        
        const facilityClass = isLab ? 'result-col result-facility result-facility--lab' : 'result-col result-facility';
        return [
            `<span class="result-col result-time">${highlightText(time, query)}</span>`,
            `<span class="result-col result-address">${highlightText(address, query)}</span>`,
            `<span class="${facilityClass}">${highlightText(facility, query)}</span>`
        ].map((html, idx) => (idx === 0 ? html : `<span class="result-sep">|</span>${html}`)).join('');
    } else {
        // Dla niekompletnej struktury: wyświetl cały wiersz jako rozdzielone komórki
        return result.cells
            .filter(c => !isEmptyCell(c))
            .map(c => `<span class="result-cell-fragment">${highlightText(String(c), query)}</span>`)
            .join('<span class="result-sep">|</span>');
    }
}

function setShowMoreErrorMessage(message) {
    if (!showMoreError) return;
    const text = String(message || '').trim();
    showMoreError.textContent = text;
    showMoreError.classList.toggle('hidden', text.length === 0);
}

function setShowMoreLoadingState(isLoading) {
    isLoadingMoreResults = Boolean(isLoading);
    if (showMoreLoading) showMoreLoading.classList.toggle('hidden', !isLoadingMoreResults);
    if (showMoreButton) showMoreButton.disabled = isLoadingMoreResults;
}

function updateResultsFooter() {
    if (!resultsFooter) return;

    const hasResults = matchedResults.length > 0;
    const hasMore = currentResults.length < matchedResults.length;
    const hasError = Boolean(showMoreError && showMoreError.textContent && showMoreError.textContent.trim().length > 0);

    if (showMoreButton) showMoreButton.classList.toggle('hidden', !hasMore);
    if (showMoreLoading) showMoreLoading.classList.toggle('hidden', !isLoadingMoreResults);
    if (showMoreError) showMoreError.classList.toggle('hidden', !hasError);

    const shouldShowFooter = hasResults && (hasMore || isLoadingMoreResults || hasError) && matchedResults.length > PAGE_SIZE;
    resultsFooter.classList.toggle('hidden', !shouldShowFooter);
}

function waitMs(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function loadMoreResults({ reset = false, seq = activeSearchSeq } = {}) {
    if (isLoadingMoreResults) return;
    if (!lastQuery || lastQuery.trim().length < 3) return;

    const localSeq = seq;
    const offset = reset ? 0 : currentResults.length;
    if (offset >= matchedResults.length) {
        updateResultsFooter();
        return;
    }

    if (reset) {
        currentResults = [];
        clearElement(resultsList);
        selectedResultIndex = -1;
    }

    setShowMoreErrorMessage('');
    setShowMoreLoadingState(true);
    updateResultsFooter();

    try {
        await waitMs(160);
        if (localSeq !== activeSearchSeq) return;

        const next = matchedResults.slice(offset, offset + PAGE_SIZE);
        const startIndex = currentResults.length;
        currentResults = currentResults.concat(next);
        renderResults(lastQuery, { append: !reset, startIndex });
    } catch (err) {
        if (localSeq !== activeSearchSeq) return;
        setShowMoreErrorMessage('Błąd sieci podczas pobierania kolejnych wyników. Spróbuj ponownie.');
        updateResultsFooter();
    } finally {
        if (localSeq !== activeSearchSeq) return;
        setShowMoreLoadingState(false);
        updateResultsFooter();
    }
}

function goHome() {
    if (filePreviewView) filePreviewView.classList.add('hidden');
    if (searchView) searchView.classList.remove('hidden');
    if (isSearchEnabled) searchInput.focus();
}

// Reset stanu aplikacji do formy identycznej jak po pierwszym wejściu do aplikacji po ekranie powitalnym.
function resetToInitialState({ source } = {}) {
    const now = Date.now();
    if (now - lastHomeResetTs < 450) return;
    lastHomeResetTs = now;

    if (debouncedSearchRef && typeof debouncedSearchRef.cancel === 'function') debouncedSearchRef.cancel();
    if (debouncedLogSearchRef && typeof debouncedLogSearchRef.cancel === 'function') debouncedLogSearchRef.cancel();

    if (searchInput) {
        searchInput.value = '';
    }
    clearResults();

    const thead = document.getElementById('table-header');
    const tbody = document.getElementById('table-body');
    clearElement(thead);
    clearElement(tbody);
    if (previewMeta) {
        previewMeta.textContent = '';
        previewMeta.classList.add('hidden');
    }
    const previewFilename = document.getElementById('preview-filename');
    if (previewFilename) previewFilename.textContent = '';

    goHome();
    logClientEvent('home', { source: source || 'unknown' });
}

function queuePreviewReadyEvent(fileName) {
    const detail = { fileName: String(fileName || '') };
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            document.dispatchEvent(new CustomEvent('qe:preview-ready', { detail }));
        });
    });
}

function compileKeyLabTokenSets() {
    const compiled = [];
    for (const entry of KEY_LAB_TOKEN_SETS) {
        const phrase = Array.isArray(entry) ? entry.join(' ') : String(entry ?? '');
        const normalized = normalizeText(phrase).replace(/[^a-z0-9]+/g, ' ').trim();
        if (!normalized) continue;
        const tokens = normalized.split(/\s+/g).filter(Boolean);
        if (tokens.length === 0) continue;

        const collapsed = [];
        for (let i = 0; i < tokens.length; i++) {
            const cur = tokens[i];
            const next = tokens[i + 1];
            if (cur && next && cur.length === 1 && next.length === 1) {
                collapsed.push(cur + next);
                i += 1;
                continue;
            }
            collapsed.push(cur);
        }

        const unique = Array.from(new Set(collapsed.filter(Boolean)));
        if (unique.length > 0) compiled.push(unique);
    }
    compiledKeyLabTokenSets = compiled;
}

function rowMatchesKeyLab(text) {
    const normalized = normalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized) return false;
    const tokens = normalized.split(/\s+/g).filter(Boolean);
    if (tokens.length === 0) return false;
    const tokenSet = new Set(tokens);
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i].length === 1 && tokens[i + 1].length === 1) {
            tokenSet.add(tokens[i] + tokens[i + 1]);
        }
    }

    if (!Array.isArray(compiledKeyLabTokenSets) || compiledKeyLabTokenSets.length === 0) {
        compileKeyLabTokenSets();
    }

    for (const requiredTokens of compiledKeyLabTokenSets) {
        let ok = true;
        for (const token of requiredTokens) {
            if (!tokenSet.has(token)) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }

    return false;
}

function highlightLabsInPreviewTable() {
    const tbody = document.getElementById('table-body');
    if (!tbody || !tbody.rows) return;

    const rows = tbody.rows;
    for (let r = 0; r < rows.length; r++) {
        const tr = rows[r];
        const cells = tr.cells;
        let rowText = '';
        for (let c = 0; c < cells.length; c++) {
            const td = cells[c];
            const t = td?.textContent ? String(td.textContent) : '';
            if (t) rowText += ` ${t}`;
        }
        
        const isLab = rowMatchesKeyLab(rowText);
        tr.classList.toggle('highlight-lab', isLab);

        if (isLab) {
            const facilityCell = tr.querySelector('.facility-column');
            if (facilityCell && !facilityCell.querySelector('.lab-badge')) {
                const originalText = facilityCell.textContent;
                facilityCell.innerHTML = `<span class="lab-badge">${escapeHtml(originalText)}</span>`;
            }
        }
    }
}

function handleKeyNavigation(e) {
    if (currentResults.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedResultIndex = Math.min(selectedResultIndex + 1, currentResults.length - 1);
        renderResults(lastQuery);
        scrollToSelected();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
        renderResults(lastQuery);
        scrollToSelected();
    } else if (e.key === 'Enter' && selectedResultIndex >= 0) {
        const group = currentResults[selectedResultIndex];
        showFilePreview(group.fileName, group.items[0].rowIndex);
    }
}

function scrollToSelected() {
    const selected = resultsList.querySelector('.result-group.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// Podgląd pliku
let lastPreviewState = { fileName: null, rowIndex: null };

function showFilePreview(fileName, highlightRowIndex) {
    const tableModel = fullFileData[fileName];
    if (!tableModel || !Array.isArray(tableModel.headers) || !Array.isArray(tableModel.rows)) return;

    lastPreviewState = { fileName, rowIndex: highlightRowIndex };
    togglePreviewView(true, fileName, tableModel.metaLines);

    const thead = document.getElementById('table-header');
    const tbody = document.getElementById('table-body');
    clearElement(thead);
    clearElement(tbody);
    
    renderPreviewHeader(thead, tableModel.headers);
    const highlightedRowEl = renderPreviewBody(tbody, tableModel, highlightRowIndex);

    if (highlightedRowEl) highlightedRowEl.scrollIntoView({ block: 'center' });
    queuePreviewReadyEvent(fileName);
    logClientEvent('preview', { fileName: String(fileName || ''), rowIndex: Number.isInteger(highlightRowIndex) ? highlightRowIndex : null });
}

function togglePreviewView(show, fileName, metaLines) {
    if (show) {
        searchView.classList.add('hidden');
        filePreviewView.classList.remove('hidden');
        document.getElementById('preview-filename').textContent = formatFileName(fileName);
        updatePreviewMeta(metaLines);
    } else {
        filePreviewView.classList.add('hidden');
        searchView.classList.remove('hidden');
    }
}

function updatePreviewMeta(metaLines) {
    if (!previewMeta) return;
    const lines = Array.isArray(metaLines) ? metaLines : [];
    if (lines.length > 0) {
        previewMeta.textContent = lines.join('\n');
        previewMeta.classList.remove('hidden');
    } else {
        previewMeta.textContent = '';
        previewMeta.classList.add('hidden');
    }
}

function renderPreviewHeader(thead, headers) {
    const idxTh = document.createElement('th');
    idxTh.textContent = '#';
    thead.appendChild(idxTh);

    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h || '';
        thead.appendChild(th);
    });
}

function renderPreviewBody(tbody, tableModel, highlightRowIndex) {
    let highlightedRowEl = null;
    tableModel.rows.forEach((rowObj) => {
        const tr = document.createElement('tr');
        if (rowObj.originalRowIndex === highlightRowIndex) {
            tr.classList.add('highlighted-row');
            highlightedRowEl = tr;
        }

        const tdNum = document.createElement('td');
        tdNum.className = 'row-num';
        tdNum.textContent = String(rowObj.originalRowIndex + 1);
        tr.appendChild(tdNum);

        rowObj.cells.forEach((cell, cellIdx) => {
            const td = document.createElement('td');
            td.textContent = (cell === null || cell === undefined) ? '' : String(cell);
            if (tableModel.headers[cellIdx]) {
                const h = normalizeText(String(tableModel.headers[cellIdx]));
                if (h.includes('nazwa') || h.includes('placowk')) td.classList.add('facility-column');
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    return highlightedRowEl;
}

function formatTimeFromDayFraction(fraction) {
    const totalMinutes = Math.round(fraction * 24 * 60);
    const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${pad2(hours)}:${pad2(minutes)}`;
}

function parseTimeString(value) {
    const s = String(value).trim();
    const match = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?(?:[.,]\d+)?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23) return null;
    if (minutes < 0 || minutes > 59) return null;
    return `${pad2(hours)}:${pad2(minutes)}`;
}

/**
 * Formatuje wartość komórki (szczególnie czas Excela)
 */
function formatCellValue(value) {
    if (value === null || value === undefined) return '';

    // Obsługa wartości liczbowych oraz stringów, które są liczbami (np. z plików CSV)
    let num = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        // Sprawdzamy czy to ułamek dziesiętny (format Excela dla czasu)
        if (trimmed !== '' && /^-?\d*\.?\d+$/.test(trimmed)) {
            num = parseFloat(trimmed);
        }
    }

    if (typeof num === 'number' && Number.isFinite(num)) {
        // Czas w Excelu to ułamek doby (0-1)
        if (num > 0 && num < 1) {
            return formatTimeFromDayFraction(num);
        }

        // Czasem Excel przechowuje czas jako duże liczby z ułamkiem (np. data + czas)
        if (num >= 1000 && num < 60000) {
            const frac = num % 1;
            if (frac > 0 && frac < 1) return formatTimeFromDayFraction(frac);
        }
    }

    const asString = String(value).trim();
    const timeParsed = parseTimeString(asString);
    if (timeParsed) return timeParsed;

    return asString;
}

async function importSpreadsheetArrayBuffer(fileName, arrayBuffer, mimeType) {
    const safeName = String(fileName || '').trim();
    if (!safeName) throw new Error('Brak nazwy pliku');
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error('Brak danych pliku (ArrayBuffer)');

    const blob = new Blob([arrayBuffer], { type: String(mimeType || '') || 'application/octet-stream' });
    await docsPutBlob(safeName, blob);
    removeFileData(safeName);
    loadedFiles.delete(safeName);
    await parseSpreadsheet(arrayBuffer, safeName);
    loadedFiles.add(safeName);
}

async function runWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const max = Math.max(1, Number(limit || 1));
    let idx = 0;
    const workers = new Array(Math.min(max, list.length)).fill(null).map(async () => {
        while (true) {
            const i = idx;
            idx += 1;
            if (i >= list.length) break;
            await worker(list[i], i);
        }
    });
    await Promise.all(workers);
}

async function handleImportGoogleDrive() {
    const api = window.GoogleDriveImport;
    if (!api) {
        handleGoogleDriveUnavailable();
        return;
    }

    setGoogleDriveLoadingState(true);
    const summary = { files: [], records: 0, errors: 0, rejected: 0 };
    const before = allData.length;

    try {
        const picked = await api.pickExcelFiles();
        const pickedFiles = Array.isArray(picked?.files) ? picked.files : [];
        if (pickedFiles.length === 0) {
            handleGoogleDriveCancel();
            return;
        }

        const accepted = filterGoogleDriveFiles(pickedFiles, api);
        summary.errors += (pickedFiles.length - accepted.length);

        if (accepted.length === 0) {
            uploadStatus.textContent = 'Google Drive: brak poprawnych plików (.xlsx/.xls).';
            return;
        }

        await importFilesFromGoogleDrive(accepted, api, summary);
        finalizeGoogleDriveImport(summary, before);
    } catch (err) {
        handleGoogleDriveError(err);
    } finally {
        setGoogleDriveLoadingState(false);
    }
}

function handleGoogleDriveUnavailable() {
    const msg = 'Import z Google Drive jest niedostępny (brak modułu).';
    console.error(msg);
    logAction('import', { source: 'google_drive', message: msg }, 'ERROR');
    uploadProgressContainer.classList.remove('hidden');
    uploadStatus.textContent = msg;
    window.setTimeout(() => uploadProgressContainer.classList.add('hidden'), 1500);
}

function setGoogleDriveLoadingState(loading) {
    if (importGoogleDriveButton) {
        importGoogleDriveButton.setAttribute('aria-busy', String(loading));
        importGoogleDriveButton.disabled = loading;
    }
    if (loading) {
        uploadProgressContainer.classList.remove('hidden');
        if (uploadProgress) uploadProgress.value = 0;
        uploadStatus.textContent = 'Google Drive: inicjalizacja...';
    } else {
        window.setTimeout(() => uploadProgressContainer.classList.add('hidden'), 900);
    }
}

function handleGoogleDriveCancel() {
    uploadStatus.textContent = 'Google Drive: anulowano.';
    logAction('import', { source: 'google_drive', phase: 'cancel' }, 'INFO');
}

function filterGoogleDriveFiles(pickedFiles, api) {
    return pickedFiles.filter(f => {
        const name = String(f?.name || '');
        const ok = typeof api.validateExcelFileName === 'function' 
            ? api.validateExcelFileName(name) 
            : (name.toLowerCase().endsWith('.xlsx') || name.toLowerCase().endsWith('.xls'));
        if (!ok) logAction('import', { source: 'google_drive', fileName: name, reason: 'extension' }, 'WARN');
        return ok;
    }).map(f => ({ id: String(f.id), name: String(f.name), mimeType: String(f.mimeType) }));
}

async function importFilesFromGoogleDrive(accepted, api, summary) {
    let done = 0;
    const total = accepted.length;
    uploadStatus.textContent = `Google Drive: importuję ${total} plik(ów)...`;

    await runWithConcurrency(accepted, 2, async (meta) => {
        const name = String(meta.name).trim();
        try {
            uploadStatus.textContent = `Google Drive: pobieram ${formatFileName(name)}...`;
            const ab = await api.downloadFileArrayBuffer(meta.id, ''); // Access token is managed inside api
            if (Number(ab?.byteLength || 0) > MAX_IMPORT_BYTES) throw new Error('Plik przekracza limit 5MB');
            
            await importSpreadsheetArrayBuffer(name, ab, meta.mimeType);
            summary.files.push(name);
        } catch (err) {
            summary.errors += 1;
            logAction('import', { source: 'google_drive', fileName: name, message: err.message }, 'ERROR');
        } finally {
            done += 1;
            if (uploadProgress) uploadProgress.value = Math.round((done / total) * 100);
        }
    });
}

async function finalizeGoogleDriveImport(summary, before) {
    summary.records = Math.max(0, allData.length - before);
    uploadStatus.textContent = 'Google Drive: import zakończony.';
    logAction('import', { source: 'google_drive', files: summary.files.length, records: summary.records, errors: summary.errors }, 'INFO');

    displayImportSummary(summary);
    fileCountSpan.textContent = String((await docsListFiles()).length);
    setSearchEnabled(allData.length > 0);

    if (lastQuery && lastQuery.trim().length >= 3 && isSearchEnabled) {
        performSearch(lastQuery.trim());
    }
}

function displayImportSummary(summary) {
    const safeFilesList = summary.files.map(f => escapeHtml(formatFileName(f))).join(', ');
    setElementHtml(resultsInfo, `Zaimportowano rekordów: <strong>${escapeHtml(summary.records)}</strong><br>Pliki: <strong>${safeFilesList || '-'}</strong><br>Błędy: <strong>${escapeHtml(summary.errors)}</strong>`);
}

function handleGoogleDriveError(err) {
    const msg = err?.message ? String(err.message) : 'Błąd importu z Google Drive';
    console.error(err);
    logAction('import', { source: 'google_drive', message: msg }, 'ERROR');
    uploadStatus.textContent = `Google Drive: ${msg}`;
}

async function handleImportFiles(files) {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) return;

    const { accepted, rejected } = filterImportFiles(list);
    rejected.forEach(r => logAction('import', { fileName: r.name, reason: r.reason }, 'WARN'));

    setImportLoadingState(true, accepted.length);
    const summary = { files: [], records: 0, errors: rejected.length };

    try {
        const before = allData.length;
        await processImportFiles(accepted, summary);
        finalizeFileImport(summary, before);
    } finally {
        setImportLoadingState(false);
    }
}

function filterImportFiles(files) {
    const accepted = [];
    const rejected = [];
    for (const f of files) {
        const name = String(f?.name || '');
        const lower = name.toLowerCase();
        const okExt = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
        const okSize = Number(f?.size || 0) <= MAX_IMPORT_BYTES;
        if (!okExt) rejected.push({ name, reason: 'extension' });
        else if (!okSize) rejected.push({ name, reason: 'size' });
        else accepted.push(f);
    }
    return { accepted, rejected };
}

function setImportLoadingState(loading, total = 0) {
    if (loading) {
        uploadProgressContainer.classList.remove('hidden');
        if (uploadProgress) uploadProgress.value = 0;
        uploadStatus.textContent = `Import: ${total} plik(ów)...`;
    } else {
        window.setTimeout(() => uploadProgressContainer.classList.add('hidden'), 900);
    }
}

async function processImportFiles(accepted, summary) {
    let processed = 0;
    for (const file of accepted) {
        const name = String(file.name || '').trim();
        if (!name) continue;

        uploadStatus.textContent = `Importuję: ${formatFileName(name)}`;
        if (uploadProgress) uploadProgress.value = Math.max(0, Math.min(95, (processed / accepted.length) * 100));

        try {
            await docsPutBlob(name, file);
            removeFileData(name);
            loadedFiles.delete(name);
            await processFile(name);
            loadedFiles.add(name);
            summary.files.push(name);
        } catch (err) {
            summary.errors += 1;
            logAction('import', { fileName: name, message: err.message }, 'ERROR');
        } finally {
            processed += 1;
        }
    }
}

async function finalizeFileImport(summary, before) {
    summary.records = Math.max(0, allData.length - before);
    if (uploadProgress) uploadProgress.value = 100;
    uploadStatus.textContent = 'Import zakończony.';
    logAction('import', { files: summary.files.length, records: summary.records, errors: summary.errors }, 'INFO');

    displayImportSummary(summary);
    fileCountSpan.textContent = String((await docsListFiles()).length);
    setSearchEnabled(allData.length > 0);

    if (lastQuery && lastQuery.trim().length >= 3 && isSearchEnabled) {
        performSearch(lastQuery.trim());
    }
}

// Pomocnicze
let searchCache = new Map(); // Cache dla wyników wyszukiwania

function normalizeText(text) {
    return String(text ?? '').toLowerCase().trim();
}

function fuzzyNormalizeText(text) {
    return normalizeText(text)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ł/g, "l");
}

let selfTestsQueued = false;

function shouldRunSelfTests() {
    try {
        return new URLSearchParams(window.location.search).get('qeTest') === '1';
    } catch {
        return false;
    }
}

function queueSelfTests() {
    if (selfTestsQueued) return;
    if (!shouldRunSelfTests()) return;
    selfTestsQueued = true;
    window.setTimeout(() => runSelfTests(), 0);
}

function runSelfTests() {
    const errors = [];

    const assert = (condition, message) => {
        if (!condition) errors.push(message);
    };

    assert(rowMatchesKeyLab('LM - Dzika'), 'Dopasowanie: "LM - Dzika"');
    assert(rowMatchesKeyLab('dzika laboratorium'), 'Dopasowanie: "dzika laboratorium"');
    assert(rowMatchesKeyLab('laboratorium dzika'), 'Dopasowanie: "laboratorium dzika"');
    assert(rowMatchesKeyLab('Piaseczno — LABORATORIUM'), 'Dopasowanie: "Piaseczno — LABORATORIUM"');
    assert(rowMatchesKeyLab('Łódź   laboratorium'), 'Dopasowanie: "Łódź   laboratorium"');
    assert(rowMatchesKeyLab('Wołomin/laboratorium'), 'Dopasowanie: "Wołomin/laboratorium"');
    assert(rowMatchesKeyLab('Szpital Medicover'), 'Dopasowanie: "Szpital Medicover"');
    assert(!rowMatchesKeyLab('dzika'), 'Brak fałszywego dopasowania dla samego "dzika"');
    assert(normalizeText('Łódź') === 'lodz', 'Normalizacja polskich znaków (Łódź → lodz)');
    assert(Boolean(parseDisplayText(' | Warszawa, Dzika 4 | Dzika Laboratorium')), 'Brak godziny nie blokuje wyniku');
    assert(Boolean(parseDisplayText('- | Warszawa, Dzika 4 | Dzika Laboratorium')), 'Niepoprawna godzina nie blokuje wyniku');

    if (errors.length > 0) {
        logAction('self_test', { ok: false, errors }, 'WARN');
    } else {
        logAction('self_test', { ok: true }, 'INFO');
    }
}

function highlightText(text, query) {
    if (!query) return text;
    
    // Normalizujemy tekst i zapytanie do formy bez diakrytyków na potrzeby wyszukiwania pozycji
    const normText = fuzzyNormalizeText(text);
    const normQuery = fuzzyNormalizeText(query);
    
    if (!normQuery) return text;

    let result = '';
    let lastIdx = 0;
    let idx = normText.indexOf(normQuery);

    while (idx !== -1) {
        // Dodajemy tekst przed dopasowaniem
        result += escapeHtml(text.slice(lastIdx, idx));
        // Dodajemy podświetlone dopasowanie (z oryginalnymi znakami)
        result += `<span class="highlight">${escapeHtml(text.slice(idx, idx + normQuery.length))}</span>`;
        
        lastIdx = idx + normQuery.length;
        idx = normText.indexOf(normQuery, lastIdx);
    }
    
    result += escapeHtml(text.slice(lastIdx));
    return result;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearResults() {
    lastQuery = '';
    matchedResults = [];
    currentResults = [];
    selectedResultIndex = -1;
    setShowMoreErrorMessage('');
    setShowMoreLoadingState(false);
    clearElement(resultsList);
    resultsInfo.textContent = '';
    updateResultsFooter();
}

// Rejestruje zdarzenia użytkownika do DebugLog (np. wyszukiwania, nawigacja, kliknięcia).
function logClientEvent(type, payload) {
    const safeType = String(type || '').slice(0, 64);
    if (!safeType) return;

    const normalizeForLog = (value) => {
        if (typeof value === 'string') return normalizeText(value);
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(normalizeForLog);
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = normalizeForLog(value[key]);
        }
        return out;
    };

    const safePayload = normalizeForLog(payload);
    logAction(safeType, safePayload ?? null, 'INFO');
}

// Start aplikacji
init();
