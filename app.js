/**
 * QuickEvo - Logika Frontendowa
 */

let allData = []; // Znormalizowane wiersze z wszystkich plików (rekordy do wyszukiwania)
let currentResults = []; // Aktualnie wyświetlana strona wyników
let matchedResults = []; // Wszystkie dopasowania dla bieżącego zapytania
let selectedResultIndex = -1; // Indeks zaznaczonego wyniku (nawigacja klawiaturą)
let lastQuery = ''; // Ostatnie zapytanie użyte do wyszukiwania
let loadedFiles = new Set(); // Zbiór nazw plików już przetworzonych do indeksu
let fullFileData = {}; // Mapowanie: nazwa pliku -> pełny model tabeli do podglądu
let isSearchEnabled = false; // Flaga dostępności wyszukiwarki (po załadowaniu danych)
let isLoading = false; // Flaga globalnego ładowania plików
let isLoadingMoreResults = false; // Flaga stronicowania wyników
let loadErrors = []; // Lista błędów wczytywania poszczególnych plików
const PAGE_SIZE = 10; // Rozmiar strony wyników
const KEY_LAB_TOKEN_SETS = [ // Zestawy tokenów do wykrywania wierszy związanych z laboratorium
    ['dzika', 'laboratorium'],
    ['dzika', 'lm'],
    ['piaseczno', 'laboratorium'],
    ['lodz', 'laboratorium'],
    ['wolomin', 'laboratorium'],
    ['szpital', 'medicover'],
    ['wilanow', 'laboratorium']
];
let compiledKeyLabTokenSets = []; // Zestawy tokenów skompilowane do szybkich dopasowań
let lastHomeResetTs = 0; // Timestamp ostatniego resetu stanu z przycisku „Home”
let debouncedSearchRef = null; // Referencja do debounce dla wyszukiwania
let debouncedLogSearchRef = null; // Referencja do debounce dla logowania wyszukiwań

// Elementy DOM (referencje do kluczowych elementów UI)
const searchInput = document.getElementById('search-input'); // Input wyszukiwania
const resultsList = document.getElementById('results-list'); // Kontener listy wyników
const resultsInfo = document.getElementById('results-info'); // Informacja o wynikach (liczba/stan)
const statusIndicator = document.getElementById('status-indicator'); // Tekst statusu pod polem wyszukiwania
const fileCountSpan = document.getElementById('file-count'); // Licznik monitorowanych plików
const themeToggle = document.getElementById('theme-toggle'); // Przełącznik motywu
const themeIcon = document.getElementById('theme-icon'); // Ikona motywu (słońce/księżyc)
const importButton = document.getElementById('import-button'); // Przycisk otwierający import
const fileInput = document.getElementById('file-input'); // Ukryty input plików
const uploadProgressContainer = document.getElementById('upload-progress-container'); // Kontener paska importu
const uploadProgress = document.getElementById('upload-progress'); // Pasek postępu importu (<progress>)
const uploadStatus = document.getElementById('upload-status'); // Tekst statusu importu
const searchView = document.getElementById('search-view'); // Widok wyszukiwania
const filePreviewView = document.getElementById('file-preview-view'); // Widok podglądu pliku
const backToSearchBtn = document.getElementById('back-to-search'); // Powrót do wyszukiwania
const previewMeta = document.getElementById('preview-meta'); // Meta dane podglądu
const loadingOverlay = document.getElementById('loading-overlay'); // Overlay ładowania
const loadingStatusText = document.getElementById('loading-status-text'); // Tekst statusu w overlay
const loadingProgressBar = document.getElementById('loading-progress-bar'); // Pasek postępu overlay (<progress>)
const loadingProgressMeta = document.getElementById('loading-progress-meta'); // Procent postępu overlay
const loadingError = document.getElementById('loading-error'); // Pole błędu w overlay
const loadingContinueButton = document.getElementById('loading-continue-button'); // Przycisk „Dalej” w overlay
const appShell = document.getElementById('app-shell'); // Główna otoczka aplikacji
const appHeaderLogo = document.getElementById('app-header-logo'); // Kontener loga w nagłówku
const homeLink = document.getElementById('home-link'); // Link „Home” (reset stanu)
const resultsFooter = document.getElementById('results-footer'); // Stopka wyników (paginacja)
const showMoreButton = document.getElementById('show-more-button'); // Przycisk „Pokaż więcej”
const showMoreLoading = document.getElementById('show-more-loading'); // Loader paginacji
const showMoreError = document.getElementById('show-more-error'); // Błąd paginacji
const dropZone = document.getElementById('drop-zone'); // Overlay drag&drop
const debugTray = document.getElementById('debug-tray'); // Panel DebugLog
const debugTrayToggle = document.getElementById('debug-tray-toggle'); // Przełącznik panelu DebugLog
const debugSearchInput = document.getElementById('debug-search'); // Wyszukiwanie w logach
const debugCopyButton = document.getElementById('debug-copy'); // Kopiowanie logów
const debugMinimizeButton = document.getElementById('debug-minimize'); // Zamykanie panelu logów
const debugLogEl = document.getElementById('debug-log'); // Kontener listy logów
const debugClearButton = document.getElementById('debug-clear'); // Czyszczenie logów

// Timestamp referencyjny do wyliczenia opóźnienia wejścia aplikacji (0.3s po "gotowym" DOM).
const DOM_READY_TS = performance.now();

// Loader progress: pamiętamy ostatnią wartość, żeby nie cofać paska (naturalniejsze odczucie).
let loadingProgressValue = 0;
let loadingProgressDone = false;
let loadingDataReady = false;
let loadingFailed = false;
let loadingStartedAt = 0;


// Unikalny prefix dla definicji SVG (<defs>) aby uniknąć kolizji id przy wielu instancjach loga.
let logoInstanceCounter = 0;

const DOCS_DB_NAME = 'quickevo_docs_v2';
const DOCS_DB_VERSION = 1;
const DOCS_DB_STORE = 'files';
let docsDbPromise = null;
let debugEntries = [];
const DEBUG_RENDER_LIMIT = 900;
let debugUiOpen = false;
let debugRenderQueued = false;
let debugSearchTerm = '';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const STATIC_DOCS_FALLBACK = [
    '0(Ł-10) I kurs.xlsx',
    '0(Ł-11) II kurs.xlsx',
    'TRASA 1    (M-Aleje) 30.03.2026.xlsx',
    'TRASA 10 (PON I SR I PT ) (B).xlsx',
    'TRASA 10 (WT I CZW) (B) 30.03.2026.xlsx',
    'TRASA 11   (J).xlsx',
    'TRASA 12   (U).xlsx',
    'TRASA 13  (Y).xlsx',
    'TRASA 14 (PN I SR I PT)  (O).xlsx',
    'TRASA 15  (F).xlsx',
    'TRASA 16  (CMP 1) 30.03.2026.xlsx',
    'TRASA 17  (CMP 2) 30.03.2026.xlsx',
    'TRASA 18  (CMP 3) 30.03.2026.xlsx',
    'TRASA 19  (CMP 4) 30.03.2026.xlsx',
    'TRASA 2    (M-Puławska) 30.03.2026.xlsx',
    'TRASA 20  (CMP 5).xlsx',
    'TRASA 21  (CMP 6).xlsx',
    'TRASA 26   (Ż).xlsx',
    'TRASA 3    (H).xlsx',
    'TRASA 30   (S WILANÓW).xlsx',
    'TRASA 31   (A WILANÓW).xlsx',
    'TRASA 32   (D WILANÓW).xlsx',
    'TRASA 33   (N-Dzika-Wilanów-Piaseczno).xlsx',
    'TRASA 36   (L).xlsx',
    'TRASA 37   (Ł NOC).xlsx',
    'TRASA 39   (Sochaczew).xlsx',
    'TRASA 4    (P).xlsx',
    'TRASA 40 ( WYSZOGRÓD PON - PT).xlsx',
    'TRASA 41 BIAŁYSTOK.xlsx',
    'TRASA 5    (R).xlsx',
    'TRASA 6    (G).xlsx',
    'TRASA 7    (K).xlsx',
    'TRASA 8  (PN I SR I PT)(E) 30.03.2026.xlsx',
    'TRASA 8  (WT I CZW)  (E).xlsx',
    'TRASA 9     (T).xlsx',
    'TRASA J  (WT I PT) (BIAŁOBRZEGI).xlsx',
    'TRASA N-2  (NIEDZIELA SKIERNIEWICE).xlsx',
    'Trasa 22     (WIECZOREK 4).xlsx',
    'Trasa 23    (WIECZOREK 5).xlsx',
    'Trasa 24    (WIECZOREK 6).xlsx',
    'Trasa 25    (WIECZOREK 7).xlsx',
    'Trasa A      (WIECZOREK 1).xlsx',
    'Trasa B      (WIECZOREK 2).xlsx',
    'Trasa C      (WIECZOREK 3).xlsx',
    'Trasa D     (WIECZOREK I).xlsx',
    'Trasa E     (WIECZOREK II).xlsx',
    'Trasa F     (WIECZOREK III).xlsx',
    'Trasa G    (WIECZOREK IV).xlsx',
    'Trasa H    (WIECZOREK V).xlsx',
    'Trasa I      (WIECZOREK RADOM).xlsx',
    'Trasa N - 1 (NIEDZIELA WOŁOMIN).xlsx',
    'Trasa S-1     (SOBOTA A).xlsx',
    'Trasa S-10   (SOBOTA CMP 1).xlsx',
    'Trasa S-11  (SOBOTA CMP 2).xlsx',
    'Trasa S-12  (SOBOTA R).xlsx',
    'Trasa S-2     (SOBOTA AII).xlsx',
    'Trasa S-3    (SOBOTA M).xlsx',
    'Trasa S-4    (SOBOTA MII).xlsx',
    'Trasa S-5    (SOBOTA N).xlsx',
    'Trasa S-6    (SOBOTA NII).xlsx',
    'Trasa S-7    (SOBOTA S).xlsx',
    'Trasa S-8    (SOBOTA W).xlsx',
    'Trasa S-9    (SOBOTA Ł).xlsx'
];

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

const memoryStorage = new Map();
function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch { }
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
}
function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return; } catch { }
    memoryStorage.set(key, String(value));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

const htmlDomParser = new DOMParser();
const svgDomParser = new DOMParser();
function clearElement(el) {
    if (!el) return;
    el.replaceChildren();
}
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

function pad2(value) {
    return String(value).padStart(2, '0');
}

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

function setDropZoneVisible(visible) {
    if (!dropZone) return;
    dropZone.classList.toggle('hidden', !visible);
    dropZone.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

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

function setDebugUiOpen(open) {
    debugUiOpen = Boolean(open);
    if (!debugTray) return;
    debugTray.classList.toggle('debug-tray--open', debugUiOpen);
    debugTray.setAttribute('aria-expanded', debugUiOpen ? 'true' : 'false');
    if (debugUiOpen) scheduleDebugRender();
}

function safeStringifyForSearch(value) {
    try {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

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

function getVisibleDebugEntries() {
    const total = debugEntries.length;
    const startIdx = Math.max(0, total - DEBUG_RENDER_LIMIT);
    const slice = debugEntries.slice(startIdx);
    const term = String(debugSearchTerm || '').trim().toLowerCase();
    return term ? slice.filter(e => String(e?.searchText || '').includes(term)) : slice;
}

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

function scheduleDebugRender() {
    if (debugRenderQueued) return;
    debugRenderQueued = true;
    window.requestAnimationFrame(() => {
        debugRenderQueued = false;
        renderDebugLog();
    });
}

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

function logAction(action, payload, level = 'INFO') {
    const act = String(action || '');
    const lvl = String(level || 'INFO').toUpperCase();
    const entry = { ts: Date.now(), action: act, payload: payload ?? null, level: lvl };
    entry.searchText = `${act} ${lvl} ${safeStringifyForSearch(payload)}`.toLowerCase();
    debugEntries.push(entry);
    scheduleDebugRender();
}

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

async function docsClearAll() {
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_DB_STORE, 'readwrite');
        const store = tx.objectStore(DOCS_DB_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('Błąd czyszczenia /docs'));
    });
}

async function tryBootstrapDocsFromStaticFolder() {
    const proto = String(window.location?.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return 0;

    try {
        const docsUrl = new URL('docs/', window.location.href);
        const files = [];

        try {
            const res = await fetch(docsUrl.toString(), { cache: 'no-store' });
            if (res.ok) {
                const contentType = String(res.headers?.get?.('content-type') || '');
                const text = await res.text();
                if (contentType.includes('text/html') || text.includes('<a')) {
                    const doc = new DOMParser().parseFromString(text, 'text/html');
                    const anchors = Array.from(doc.querySelectorAll('a'));
                    const candidates = [];
                    for (const a of anchors) {
                        const href = String(a.getAttribute('href') || '').trim();
                        if (!href || href === '../' || href.startsWith('?')) continue;
                        const cleanHref = href.split('#')[0].split('?')[0];
                        const lower = cleanHref.toLowerCase();
                        if (!(lower.endsWith('.xlsx') || lower.endsWith('.csv'))) continue;
                        candidates.push(cleanHref);
                    }

                    const seen = new Set();
                    for (const href of candidates) {
                        let url = null;
                        try { url = new URL(href, docsUrl.toString()); } catch { continue; }
                        const fileName = decodeURIComponent(url.pathname.split('/').pop() || '');
                        if (!fileName) continue;
                        if (seen.has(fileName)) continue;
                        seen.add(fileName);
                        files.push({ url: url.toString(), name: fileName });
                    }
                }
            }
        } catch {
        }

        if (files.length === 0) {
            for (const name of STATIC_DOCS_FALLBACK) {
                const encodedName = encodeURIComponent(String(name ?? ''));
                const url = new URL(`docs/${encodedName}`, window.location.href).toString();
                files.push({ url, name });
            }
        }

        if (files.length === 0) return 0;

        logAction('boot', { phase: 'bootstrap_docs', files: files.length }, 'INFO');

        let imported = 0;
        for (const f of files) {
            try {
                const fr = await fetch(f.url, { cache: 'no-store' });
                if (!fr.ok) continue;
                const blob = await fr.blob();
                if (blob.size > MAX_IMPORT_BYTES) continue;
                await docsPutBlob(f.name, blob);
                imported += 1;
            } catch {
            }
        }

        logAction('boot', { phase: 'bootstrap_docs_done', attempted: files.length, imported }, imported > 0 ? 'INFO' : 'WARN');
        if (imported > 0) logAction('import', { phase: 'bootstrap', files: imported }, 'INFO');
        return imported;
    } catch (err) {
        logAction('boot', { phase: 'bootstrap_docs_error', message: err?.message ? String(err.message) : 'error' }, 'WARN');
        return 0;
    }
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

    try {
        await openDocsDb();
        const existing = await docsListFiles();
        if (!Array.isArray(existing) || existing.length === 0) {
            await tryBootstrapDocsFromStaticFolder();
        }
        await loadAllFiles({ fullReload: true, showProgress: true });
        loadingDataReady = true;
        setSearchEnabled(allData.length > 0);
        if (allData.length === 0) {
            setLoadingStatusText('Brak danych. Kliknij „Dalej”, a potem zaimportuj pliki .xlsx/.csv.');
        }
    } catch (err) {
        loadingFailed = true;
        setSearchEnabled(false);
        showLoadingError('Błąd ładowania danych. Zaimportuj pliki .xlsx/.csv.');
        logAction('boot', { phase: 'error', message: err?.message ? String(err.message) : 'error' }, 'ERROR');
    } finally {
        loadingProgressDone = true;
        prepareManualContinue();
        const totalMs = Math.round(performance.now() - loadingStartedAt);
        logAction('boot', { phase: 'done', ms: totalMs });
    }
}

// Obsługa motywów
function setupTheme() {
    const savedTheme = storageGet('theme') || 'light';
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
    const debouncedSearch = debounce((query) => performSearch(query), 180);
    const debouncedLogSearch = debounce((query) => logClientEvent('search', { query }), 450);
    debouncedSearchRef = debouncedSearch;
    debouncedLogSearchRef = debouncedLogSearch;

    searchInput.addEventListener('input', (e) => {
        if (!isSearchEnabled) return;
        const query = e.target.value.trim();
        if (query.length >= 3) {
            debouncedSearch(query);
            debouncedLogSearch(query);
        } else {
            debouncedSearch.cancel();
            debouncedLogSearch.cancel();
            clearResults();
        }
    });

    searchInput.addEventListener('keydown', handleKeyNavigation);

    if (importButton) importButton.addEventListener('click', () => {
        logAction('import', { phase: 'open_dialog' }, 'INFO');
        fileInput?.click();
    });
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) await handleImportFiles(files);
            fileInput.value = '';
        });
    }

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
        debugCopyButton.addEventListener('click', async () => {
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
        });
    }
    if (debugClearButton) {
        debugClearButton.addEventListener('click', () => {
            debugEntries = [];
            scheduleDebugRender();
        });
    }

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

    window.addEventListener('error', (e) => {
        const msg = e?.message ? String(e.message) : 'window.error';
        logAction('error', { message: msg }, 'ERROR');
    });
    window.addEventListener('unhandledrejection', (e) => {
        const reason = e?.reason;
        const msg = reason?.message ? String(reason.message) : (reason ? String(reason) : 'unhandledrejection');
        logAction('error', { message: msg }, 'ERROR');
    });

    document.addEventListener('qe:preview-ready', () => highlightLabsInPreviewTable(), { passive: true });
}

// Ładowanie i procesowanie plików
async function loadAllFiles({ fullReload, showProgress } = { fullReload: false, showProgress: false }) {
    if (isLoading) return;
    isLoading = true;
    const loadStart = performance.now();
    let total = 0;
    let done = 0;

    try {
        statusIndicator.textContent = 'Sprawdzanie plików...';
        const files = await docsListFiles();
        const spreadsheetFiles = Array.isArray(files)
            ? files.map(f => String(f?.name ?? '')).filter(f => {
                const lower = f.toLowerCase();
                return lower.endsWith('.xlsx') || lower.endsWith('.csv');
            })
            : [];

        spreadsheetFiles.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        fileCountSpan.textContent = spreadsheetFiles.length;

        if (fullReload) {
            allData = [];
            currentResults = [];
            selectedResultIndex = -1;
            lastQuery = '';
            loadedFiles = new Set();
            fullFileData = {};
            loadErrors = [];
        }

        const filesToLoad = fullReload
            ? spreadsheetFiles
            : spreadsheetFiles.filter(f => !loadedFiles.has(f));

        total = filesToLoad.length;
        done = 0;

        if (showProgress) {
            setLoadingStatusText(total === 0 ? 'Brak plików .xlsx/.csv. Zaimportuj dane.' : 'Wczytywanie plików...');
            // Progress jest liczony na podstawie realnie przetworzonych plików (bez sztucznego opóźnienia).
            setLoadingProgressPercent(total === 0 ? 100 : 0, { force: true });
        }

        if (filesToLoad.length > 0) {
            const concurrency = Math.max(1, Math.min(6, (navigator?.hardwareConcurrency ? Math.floor(navigator.hardwareConcurrency / 2) : 4)));
            let cursor = 0;
            const workers = new Array(Math.min(concurrency, filesToLoad.length)).fill(0).map(async () => {
                while (true) {
                    const i = cursor++;
                    if (i >= filesToLoad.length) break;
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
        statusIndicator.textContent = 'Błąd ładowania.';
        if (showProgress) showLoadingError('Błąd ładowania danych.');
        logAction('load', { message: error?.message ? String(error.message) : 'Błąd ładowania' }, 'ERROR');
        if (showProgress) throw error;
    } finally {
        isLoading = false;
        if (showProgress) {
            const label = loadErrors.length > 0 ? `Gotowe (błędy: ${loadErrors.length}).` : 'Gotowe.';
            setLoadingStatusText(label);
            if (total > 0 && done >= total) setLoadingProgressPercent(100);
        }
        const loadTime = Math.round(performance.now() - loadStart);
        logAction('load', { fullReload: Boolean(fullReload), ms: loadTime, files: total, errors: loadErrors.length });
    }
}

async function processFile(fileName) {
    const blob = await docsGetBlob(fileName);
    if (!blob) throw new Error('Nie można odczytać pliku z /docs');
    await parseSpreadsheet(blob, fileName);
}

async function parseSpreadsheet(blob, fileName) {
    try {
        const lower = String(fileName || '').toLowerCase();
        const workbook = lower.endsWith('.csv')
            ? XLSX.read(await blob.text(), { type: 'string' })
            : XLSX.read(await blob.arrayBuffer());
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

function addTableRows(tableModel, fileName) {
    if (!tableModel || !Array.isArray(tableModel.rows)) return 0;
    const existingTexts = new Set(allData.map(d => `${d.fileName}:${d.rowIndex}`));

    const normalizedRows = [];
    for (const row of tableModel.rows) {
        const key = `${fileName}:${row.originalRowIndex}`;
        if (existingTexts.has(key)) continue;

        const displayText = buildDisplayTextFromRow(row.cells, tableModel?.headers, tableModel?.timeCol, tableModel?.notesCol);
        if (!displayText) continue;

        normalizedRows.push({
            fileName: fileName,
            rowIndex: row.originalRowIndex,
            displayText: displayText,
            searchable: normalizeText(`${displayText} ${fileName}`)
        });
    }

    allData = allData.concat(normalizedRows);
    return normalizedRows.length;
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

function lazyLoadBackgroundImage() {
    const backgroundUrl = 'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=2400&q=80';
    const startLazyLoad = () => {
        const image = new Image();
        image.loading = 'lazy';
        image.decoding = 'async';

        image.onload = () => {
            document.body.classList.add('has-lazy-bg');
            logAction('bg', { phase: 'lazy_loaded' }, 'INFO');
        };

        image.onerror = () => {
            logAction('bg', { phase: 'lazy_failed' }, 'WARN');
        };

        image.src = backgroundUrl;
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(startLazyLoad, { timeout: 1200 });
    } else {
        window.setTimeout(startLazyLoad, 600);
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
    if (!bounds) return { headers: [], rows: [], metaLines: [] };

    const cropped = rect
        .slice(bounds.minRow, bounds.maxRow + 1)
        .map(row => row.slice(bounds.minCol, bounds.maxCol + 1));

    const headerRowRel = findHeaderRowIndex(cropped);
    const rawHeaders = cropped[headerRowRel].map(cellToHeaderText);

    const metaLines = [];
    for (let r = 0; r < headerRowRel; r++) {
        const row = cropped[r];
        const parts = row
            .filter(v => !isEmptyCell(v))
            .map(v => formatCellValue(v))
            .map(v => String(v).trim())
            .filter(v => v.length > 0);

        if (parts.length > 0) metaLines.push(parts.join(' | '));
    }

    const dataRelRows = cropped.slice(headerRowRel + 1);
    const numCols = rawHeaders.length;

    const rawDataRows = [];
    for (let r = 0; r < dataRelRows.length; r++) {
        const row = dataRelRows[r];
        if (row.every(isEmptyCell)) continue;
        rawDataRows.push({ originalRowIndex: bounds.minRow + headerRowRel + 1 + r, cells: row });
    }

    const timeCol = detectTimeColumn(rawDataRows, numCols);
    const notesCol = detectNotesColumn(rawHeaders, rawDataRows, numCols, timeCol);

    const headers = rawHeaders.map((h, idx) => {
        if (idx === timeCol) return 'Godziny';
        if (idx === notesCol) return 'Uwagi';
        const clean = String(h || '').trim();
        return clean.length ? clean : `Kolumna ${idx + 1}`;
    });

    const rows = rawDataRows.map(r => ({
        originalRowIndex: r.originalRowIndex,
        cells: Array.from({ length: numCols }, (_, idx) => formatCellValue(r.cells[idx]))
    }));

    return { headers, rows, metaLines, timeCol, notesCol };
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

function detectTimeColumn(rawDataRows, numCols) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let c = 0; c < numCols; c++) {
        let nonEmpty = 0;
        let timeLike = 0;

        for (const row of rawDataRows) {
            const v = row.cells[c];
            if (isEmptyCell(v)) continue;
            nonEmpty += 1;
            if (isTimeValue(v)) timeLike += 1;
        }

        if (nonEmpty < 2) continue;
        const score = timeLike / nonEmpty;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = c;
        }
    }

    if (bestScore >= 0.55) return bestIdx;
    return -1;
}

function detectNotesColumn(rawHeaders, rawDataRows, numCols, timeCol) {
    const headerIdx = rawHeaders.findIndex(h => normalizeText(String(h)).includes('uwagi'));
    if (headerIdx >= 0) return headerIdx;

    let bestIdx = -1;
    let bestScore = 0;

    for (let c = 0; c < numCols; c++) {
        if (c === timeCol) continue;
        let nonEmpty = 0;
        let textLike = 0;
        let avgLenTotal = 0;

        for (const row of rawDataRows) {
            const v = row.cells[c];
            if (isEmptyCell(v)) continue;
            nonEmpty += 1;
            const s = String(v).trim();
            if (s.length > 0) {
                textLike += 1;
                avgLenTotal += s.length;
            }
        }

        if (nonEmpty < 2) continue;
        const avgLen = avgLenTotal / Math.max(1, textLike);
        const score = (textLike / nonEmpty) * Math.min(1, avgLen / 22);
        if (score > bestScore) {
            bestScore = score;
            bestIdx = c;
        }
    }

    if (bestScore >= 0.35) return bestIdx;
    return -1;
}

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
    lastQuery = query;
    activeSearchSeq = ++searchSeq;
    selectedResultIndex = -1;

    const lowerQuery = normalizeText(query);
    matchedResults = allData
        .filter(item => item.searchable.includes(lowerQuery))
        .filter(item => isValidDisplayText(item.displayText));

    currentResults = [];
    clearElement(resultsList);
    setShowMoreErrorMessage('');

    if (matchedResults.length === 0) {
        resultsInfo.textContent = 'Brak wyników.';
        updateResultsFooter();
        return;
    }

    await loadMoreResults({ reset: true, seq: activeSearchSeq });
}

function renderResults(query, { append = false, startIndex = 0 } = {}) {
    if (!append) clearElement(resultsList);

    if (currentResults.length === 0) {
        resultsInfo.textContent = 'Brak wyników.';
        updateResultsFooter();
        return;
    }

    resultsInfo.textContent = `Wyniki: ${currentResults.length} / ${matchedResults.length}`;

    const fragment = document.createDocumentFragment();
    for (let index = startIndex; index < currentResults.length; index++) {
        const result = currentResults[index];
        if (!isValidDisplayText(result.displayText)) continue;
        const parsed = parseDisplayText(result.displayText);
        const isLab = parsed ? rowMatchesKeyLab(parsed.facility) : false;

        const div = document.createElement('div');
        div.className = 'result-item';
        if (index === selectedResultIndex) div.classList.add('selected');
        if (isLab) div.classList.add('result-item--lab');

        const routeName = formatRouteNameForResults(result.fileName);
        const summaryHtml = buildResultSummaryHtml(result.displayText, query, { isLab });

        setElementHtml(div, `
            <span class="result-filename"><span class="result-route-name">${routeName}</span></span>
            <div class="result-content">${summaryHtml}</div>
        `);

        div.onclick = () => showFilePreview(result.fileName, result.rowIndex);
        fragment.appendChild(div);
    }
    resultsList.appendChild(fragment);

    updateResultsFooter();
}

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
function buildResultSummaryHtml(displayText, query, { isLab = false } = {}) {
    const parsed = parseDisplayText(displayText);
    if (!parsed) return '';

    const time = parsed.time && parsed.time.length > 0 ? parsed.time : '—';
    const { address, facility } = parsed;
    const facilityClass = isLab ? 'result-col result-facility result-facility--lab' : 'result-col result-facility';
    return [
        `<span class="result-col result-time">${highlightText(time, query)}</span>`,
        `<span class="result-col result-address">${highlightText(address, query)}</span>`,
        `<span class="${facilityClass}">${highlightText(facility, query)}</span>`
    ].map((html, idx) => (idx === 0 ? html : `<span class="result-sep">|</span>${html}`)).join('');
}

function parseDisplayText(displayText) {
    const raw = String(displayText || '');
    const parts = raw.split('|').map(s => s.trim());
    if (parts.length !== 3) return null;
    const timePart = parts[0].replace(/\s+/g, ' ').trim();
    const time = parseTimeString(timePart) || timePart;
    const address = parts[1].replace(/\s+/g, ' ').trim();
    const facility = parts[2].replace(/\s+/g, ' ').trim();
    return { time, address, facility };
}

function isValidDisplayText(displayText) {
    return Boolean(parseDisplayText(displayText));
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

function isShelfToken(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    return /^\d{1,4}[.)]?$/.test(s) || /^\d{1,4}\.$/.test(s);
}

function buildDisplayTextFromRow(cells, headers, timeCol, notesCol) {
    const safeCells = Array.isArray(cells) ? cells : [];
    const safeHeaders = Array.isArray(headers) ? headers : [];
    const headerNorms = safeHeaders.map(h => normalizeText(String(h ?? '')));

    const findHeaderIndex = (predicate) => headerNorms.findIndex(predicate);
    let detectedTimeCol = Number.isInteger(timeCol) ? timeCol : findHeaderIndex(h => h.includes('godzin'));
    let detectedNotesCol = Number.isInteger(notesCol) ? notesCol : findHeaderIndex(h => h.includes('uwag'));
    let shelfCol = findHeaderIndex(h => h.includes('pol'));
    const addressCol = findHeaderIndex(h => h.includes('adres'));
    const facilityCol = findHeaderIndex(h => h.includes('nazwa') || h.includes('placowk'));

    if (shelfCol < 0 && safeCells.length >= 1) {
        const first = String(safeCells[0] ?? '').trim();
        if (isShelfToken(first)) shelfCol = 0;
    }

    if (!Number.isInteger(detectedNotesCol) || detectedNotesCol < 0) detectedNotesCol = -1;
    if (!Number.isInteger(detectedTimeCol) || detectedTimeCol < 0) {
        detectedTimeCol = safeCells.length >= 2 ? 1 : -1;
    }

    let timePart = '';
    if (detectedTimeCol >= 0 && detectedTimeCol < safeCells.length) {
        const raw = String(safeCells[detectedTimeCol] ?? '').replace(/\s+/g, ' ').trim();
        timePart = parseTimeString(raw) || raw;
    }

    const addressFromColumns = addressCol >= 0 && addressCol < safeCells.length
        ? String(safeCells[addressCol] ?? '').replace(/\s+/g, ' ').trim()
        : '';
    const facilityFromColumns = facilityCol >= 0 && facilityCol < safeCells.length
        ? String(safeCells[facilityCol] ?? '').replace(/\s+/g, ' ').trim()
        : '';

    if (addressFromColumns.length > 0 || facilityFromColumns.length > 0) {
        return `${timePart} | ${addressFromColumns} | ${facilityFromColumns}`;
    }

    const after = [];
    const afterStart = detectedTimeCol >= 0 ? detectedTimeCol + 1 : 0;
    for (let i = afterStart; i < safeCells.length; i++) {
        if (i === detectedNotesCol) continue;
        if (i === shelfCol) continue;
        const s = String(safeCells[i] ?? '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        after.push(s);
    }

    if (after.length === 0) return null;
    if (after.length === 1) return `${timePart} | ${after[0]} | `;

    const facility = after[after.length - 1].replace(/\s*\|\s*/g, ' ').trim();
    const address = after.slice(0, -1).join(', ').replace(/\s*\|\s*/g, ' ').trim();
    return `${timePart} | ${address} | ${facility}`;
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
        tr.classList.toggle('highlight-lab', rowMatchesKeyLab(rowText));
    }
}

function handleKeyNavigation(e) {
    if (currentResults.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedResultIndex = Math.min(selectedResultIndex + 1, currentResults.length - 1);
        renderResults(lastQuery);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
        renderResults(lastQuery);
    } else if (e.key === 'Enter' && selectedResultIndex >= 0) {
        const result = currentResults[selectedResultIndex];
        showFilePreview(result.fileName, result.rowIndex);
    }
}

// Podgląd pliku
function showFilePreview(fileName, highlightRowIndex) {
    const tableModel = fullFileData[fileName];
    if (!tableModel || !Array.isArray(tableModel.headers) || !Array.isArray(tableModel.rows)) return;

    searchView.classList.add('hidden');
    filePreviewView.classList.remove('hidden');
    document.getElementById('preview-filename').textContent = formatFileName(fileName);

    if (previewMeta) {
        const lines = Array.isArray(tableModel.metaLines) ? tableModel.metaLines : [];
        if (lines.length > 0) {
            previewMeta.textContent = lines.join('\n');
            previewMeta.classList.remove('hidden');
        } else {
            previewMeta.textContent = '';
            previewMeta.classList.add('hidden');
        }
    }

    const thead = document.getElementById('table-header');
    const tbody = document.getElementById('table-body');
    clearElement(thead);
    clearElement(tbody);
    const idxTh = document.createElement('th');
    idxTh.textContent = '#';
    thead.appendChild(idxTh);

    tableModel.headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h || '';
        thead.appendChild(th);
    });

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

        rowObj.cells.forEach(cell => {
            const td = document.createElement('td');
            td.textContent = (cell === null || cell === undefined) ? '' : String(cell);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    if (highlightedRowEl) highlightedRowEl.scrollIntoView({ block: 'center' });
    queuePreviewReadyEvent(fileName);
    logClientEvent('preview', { fileName: String(fileName || ''), rowIndex: Number.isInteger(highlightRowIndex) ? highlightRowIndex : null });
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

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 0 && value < 1) {
            return formatTimeFromDayFraction(value);
        }

        if (value >= 1000 && value < 60000) {
            const frac = value % 1;
            if (frac > 0 && frac < 1) return formatTimeFromDayFraction(frac);
        }
    }

    const asString = String(value);
    const timeParsed = parseTimeString(asString);
    if (timeParsed) return timeParsed;

    return asString;
}

async function handleImportFiles(files) {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) return;

    const accepted = [];
    const rejected = [];
    for (const f of list) {
        const name = String(f?.name || '');
        const lower = name.toLowerCase();
        const okExt = lower.endsWith('.xlsx') || lower.endsWith('.csv');
        const okSize = Number(f?.size || 0) <= MAX_IMPORT_BYTES;
        if (!okExt) rejected.push({ name, reason: 'extension' });
        else if (!okSize) rejected.push({ name, reason: 'size' });
        else accepted.push(f);
    }

    for (const r of rejected) logAction('import', { fileName: r.name, reason: r.reason }, 'WARN');

    uploadProgressContainer.classList.remove('hidden');
    if (uploadProgress) uploadProgress.value = 0;
    uploadStatus.textContent = `Import: ${accepted.length} plik(ów)...`;

    const summary = { files: [], records: 0, errors: rejected.length };

    try {
        const before = allData.length;
        let processed = 0;

        for (const file of accepted) {
            const name = String(file.name || '').trim();
            if (!name) continue;

            uploadStatus.textContent = `Importuję: ${formatFileName(name)}`;
            const percent = Math.max(0, Math.min(95, (processed / Math.max(1, accepted.length)) * 100));
            if (uploadProgress) uploadProgress.value = percent;

            try {
                await docsPutBlob(name, file);
                removeFileData(name);
                loadedFiles.delete(name);
                await processFile(name);
                loadedFiles.add(name);
                summary.files.push(name);
            } catch (err) {
                summary.errors += 1;
                logAction('import', { fileName: name, message: err?.message ? String(err.message) : 'Błąd importu' }, 'ERROR');
            } finally {
                processed += 1;
            }
        }

        summary.records = Math.max(0, allData.length - before);
        if (uploadProgress) uploadProgress.value = 100;
        uploadStatus.textContent = 'Import zakończony.';

        logAction('import', { files: summary.files.length, records: summary.records, errors: summary.errors }, 'INFO');

        const safeFilesList = summary.files.map(f => escapeHtml(formatFileName(f))).join(', ');
        setElementHtml(resultsInfo, `Zaimportowano rekordów: <strong>${escapeHtml(summary.records)}</strong><br>Pliki: <strong>${safeFilesList || '-'}</strong><br>Błędy: <strong>${escapeHtml(summary.errors)}</strong>`);

        fileCountSpan.textContent = String((await docsListFiles()).length);
        setSearchEnabled(allData.length > 0);

        if (lastQuery && lastQuery.trim().length >= 3 && isSearchEnabled) {
            performSearch(lastQuery.trim());
        }
    } finally {
        window.setTimeout(() => uploadProgressContainer.classList.add('hidden'), 900);
    }
}

// Pomocnicze
function normalizeText(text) {
    return String(text ?? '')
        .toLowerCase()
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

function parseHexColor(hex) {
    const raw = String(hex || '').trim().replace(/^#/, '');
    if (raw.length === 3) {
        const r = parseInt(raw[0] + raw[0], 16);
        const g = parseInt(raw[1] + raw[1], 16);
        const b = parseInt(raw[2] + raw[2], 16);
        return { r, g, b };
    }
    if (raw.length === 6) {
        const r = parseInt(raw.slice(0, 2), 16);
        const g = parseInt(raw.slice(2, 4), 16);
        const b = parseInt(raw.slice(4, 6), 16);
        return { r, g, b };
    }
    return null;
}

function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function contrastRatio(rgb1, rgb2) {
    const l1 = 0.2126 * srgbToLinear(rgb1.r) + 0.7152 * srgbToLinear(rgb1.g) + 0.0722 * srgbToLinear(rgb1.b);
    const l2 = 0.2126 * srgbToLinear(rgb2.r) + 0.7152 * srgbToLinear(rgb2.g) + 0.0722 * srgbToLinear(rgb2.b);
    const light = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
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
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
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
