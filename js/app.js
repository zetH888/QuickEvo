/**
 * QuickEvo - Logika Frontendowa
 * 
 * Aplikacja do wyszukiwania tras i dokumentów w plikach Excel (.xlsx, .xls) oraz CSV.
 * Obsługuje import plików z dysku lokalnego oraz z Google Drive.
 * Wykorzystuje IndexedDB do przechowywania plików i Web Workers (opcjonalnie) do przetwarzania.
 */

//////////////////////////////////////////////////
// STAŁE GLOBALNE, KONFIGURACJA, IMPORTY
//////////////////////////////////////////////////

const ROUTE_CATEGORIES_ORDER = Object.freeze(['STANDARD', 'WIECZOREK', 'SOBOTA', 'NIEDZIELA']);
const ROUTE_CATEGORY_STORAGE_PREFIX = 'qe:routeCategoryCollapsed:';
const routeCategoryCache = new Map();

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
 * Nazwa i wersja bazy danych IndexedDB.
 */
const DOCS_DB_NAME = 'quickevo_docs_v2';
const DOCS_DB_VERSION = 2;
const DOCS_DB_STORE = 'files';

/**
 * Limit rozmiaru pliku podczas importu (5MB).
 */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Globalne instancje parserów DOM dla HTML i SVG.
 */
const htmlDomParser = new DOMParser();
const svgDomParser = new DOMParser();

/**
 * Rezerwowy magazyn danych w pamięci.
 * @type {Map<string, string>}
 */
const memoryStorage = new Map();

const DOM_READY_TS = performance.now();

const WELCOME_LOGO_ENTER_DELAY_MS = 420;
const WELCOME_SEQUENCE_UNLOCK_AFTER_MS = 1750;
const WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS = 650;
const BOOT_WATCHDOG_MS = 8000;
const DOCS_DB_OPEN_TIMEOUT_MS = 6000;

/**
 * Konfiguracja „premium” dla ekranu ładowania:
 * - rotacja losowych komunikatów w tytule (z płynnymi przejściami) zsynchronizowana z postępem,
 * - symulacja płynnego postępu (mikropauzy, skoki, soft-cap), aby pasek nie „migał”.
 */
const LOADING_TITLE_INTERVAL_MIN_MS = 500;
const LOADING_TITLE_INTERVAL_MAX_MS = 800;
const LOADING_TITLE_FADE_OUT_MS = 200;
const LOADING_TITLE_FADE_IN_MS = 300;

const LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH = 97;
const LOADING_PROGRESS_MICROSTOP_MIN_MS = 200;
const LOADING_PROGRESS_MICROSTOP_MAX_MS = 500;
const LOADING_PROGRESS_JUMP_MIN = 1;
const LOADING_PROGRESS_JUMP_MAX = 5;

/**
 * Komunikaty wyświetlane w tytule podczas ładowania (zsynchronizowane z zakresem postępu).
 * @type {{startowe: string[], techniczne: string[], absurdalne: string[], finalizujace: string[], powitalne: string[]}}
 */
const LOADING_TITLE_MESSAGES = {
    startowe: [
        'Budzenie serwera...',
        'Odpinanie respiratora...',
        'Szturchanie backendu...',
        'Włączanie internetu...',
        'Rozruch atomów...',
        'Szukanie przycisku...',
        'Start silnika...',
        'Odpalanie chaosu...',
        'Rozgrzewka bitów...',
        'Kopnięcie infrastruktury...'
    ],
    techniczne: [
        'Kalibracja ogarniania...',
        'Stabilizacja chaosu...',
        'Analiza logów...',
        'Negocjacje z bazą...',
        'Parsowanie rzeczy...',
        'Tłumaczenie kodu...',
        'Czyszczenie traum...',
        'Korekta pakietów...',
        'Rekompilacja sensu...',
        'Liczenie wyjątków...'
    ],
    absurdalne: [
        'Tresura pikseli...',
        'Duch dokumentacji...',
        'Prostowanie zer...',
        'Koszenie cache...',
        'Chłodzenie lodem...',
        'Odbiór z kosmosu...',
        'Przesłuchanie bitów...',
        'Regulacja chmury...',
        'Reset fizyki...',
        'JavaScript protestuje...'
    ],
    finalizujace: [
        'Zacieranie prowizorki...',
        'Dokręcanie iluzji...',
        'Lakierowanie kodu...',
        'Maskowanie katastrof...',
        'Domykanie chaosu...',
        'Polerka backendu...',
        'Udawanie kontroli...',
        'Spinanie trytytką...',
        'Wygładzanie kantów...',
        'Zaklinanie stabilności...'
    ],
    powitalne: [
        'Backend skapitulował. Można wchodzić ✓',
        'Działa dobrze. Podejrzane... ✓',
        'Nic nie wybuchło. Sukces ✓',
        'Serwer przeżył tę próbę ✓',
        'System ocalał. Zapraszamy ✓',
        'Ruszyło bez większych strat ✓',
        'Fizyka chwilowo działa ✓',
        'Kod się nie zbuntował ✓',
        'Jakoś działa, trytytki trzymają ✓',
        'Cud techniki zakończony sukcesem ✓'
    ]
};

/**
 * Implementacja prostego cache'u LRU (Least Recently Used).
 */
class LRUCache {
    constructor(limit = 100) {
        this.limit = limit;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return undefined;
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.limit) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, value);
    }
    has(key) { return this.cache.has(key); }
    clear() { this.cache.clear(); }
}

/**
 * Cache dla wyników wyszukiwania (LRU).
 */
let searchCache = new LRUCache(100);

/**
 * Stan indeksu podpowiedzi dla predykcji wpisywanej frazy.
 * Priorytety: adresy, nazwy placówek, nazwy tras.
 */
let predictiveIndex = null;
let predictiveIndexBuildTimer = null;
let predictiveSuggestionsCache = new LRUCache(150);
let predictiveUiState = { raw: '', norm: '', options: [], index: 0, hidden: false };
let predictiveIsComposing = false;

/**
 * Kontrolery animacji orbit logo.
 * @type {WeakMap<SVGElement, Object>}
 */
const logoOrbitControllers = new WeakMap();

/**
 * Oblicza dystans Levenshteina między dwoma ciągami znaków (fuzzy matching).
 */
function getLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Oblicza podobieństwo (0.0 - 1.0) na podstawie dystansu Levenshteina.
 */
function getFuzzyScore(query, text) {
    const distance = getLevenshteinDistance(query, text);
    const maxLength = Math.max(query.length, text.length);
    return maxLength === 0 ? 1.0 : 1.0 - (distance / maxLength);
}

//////////////////////////////////////////////////
// CACHE ELEMENTÓW DOM
//////////////////////////////////////////////////

const searchInput = document.getElementById('search-input');
const resultsList = document.getElementById('results-list');
const resultsInfo = document.getElementById('results-info');
const statusIndicator = document.getElementById('status-indicator');
const fileCountSpan = document.getElementById('file-count');
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const importButton = document.getElementById('import-button');
const googleDriveButton = document.getElementById('import-google-drive-button');
const fileInput = document.getElementById('file-input');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgress = document.getElementById('upload-progress');
const uploadStatus = document.getElementById('upload-status');
const searchView = document.getElementById('search-view');
const filePreviewView = document.getElementById('file-preview-view');
const backToSearchBtn = document.getElementById('back-to-search');
const previewMeta = document.getElementById('preview-meta');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingTitleText = document.getElementById('welcome-text');
const loadingStatusText = document.getElementById('loading-status-text');
const loadingProgressBar = document.getElementById('loading-progress-bar');
const loadingProgressMeta = document.getElementById('loading-progress-meta');
const loadingError = document.getElementById('loading-error');
const loadingContinueButton = document.getElementById('loading-continue-button');
const appShell = document.getElementById('app-shell');
const appHeaderLogo = document.getElementById('app-header-logo');
const homeLink = document.getElementById('home-link');
const dropZone = document.getElementById('drop-zone');
const syncGDriveButton = document.getElementById('sync-gdrive-button');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalContent = document.getElementById('modal-content');
const modalActions = document.getElementById('modal-actions');
const welcomeImportProgress = document.getElementById('welcome-import-progress');
const welcomeProgressList = document.getElementById('welcome-progress-list');
const scrollIndicator = document.getElementById('scroll-indicator');
const ghostOverlay = document.getElementById('qe-ghost');
const ghostPrefix = document.getElementById('qe-ghost-prefix');
const ghostSuffix = document.getElementById('qe-ghost-suffix');

//////////////////////////////////////////////////
// KLUCZOWY STAN APLIKACJI
//////////////////////////////////////////////////

/** @type {Array<Object>} Znormalizowane wiersze ze wszystkich załadowanych plików. */
let allData = []; 

/** @type {Array<Object>} Aktualnie wyświetlana strona wyników wyszukiwania. */
let currentResults = []; 

/** @type {Array<Object>} Wszystkie dopasowania dla bieżącego zapytania. */
let matchedResults = []; 

/** @type {string} Ostatnie zapytanie użyte do wyszukiwania. */
let lastQuery = ''; 

/** @type {Set<string>} Zbiór nazw plików, które zostały już przetworzone. */
let loadedFiles = new Set(); 

/** @type {Object<string, Object>} Mapowanie nazwy pliku na pełny model danych tabeli. */
let fullFileData = {}; 

/**
 * Cache grafiku: mapowanie (YYYY-MM) -> dane grafiku oraz przypisania (data -> trasa -> kierowca).
 * Uwaga: trzymamy to celowo poza indeksami wyszukiwania, aby pliki grafiku nie wpływały na wyniki.
 * @type {Map<string, { key: string, year: number, month: number, fileName: string, byIsoDate: Map<string, Map<string, string>> }>}
 */
let scheduleCacheByMonth = new Map();

/** @type {Set<string>} Pliki grafiku, które zostały już przetworzone i mają wpis w cache. */
let loadedScheduleFiles = new Set();

/** @type {boolean} Flaga określająca, czy wyszukiwarka jest aktywna. */
let isSearchEnabled = false; 

/** @type {boolean} Flaga wskazująca, czy trwa obecnie proces ładowania plików. */
let isLoading = false; 

/** @type {Array<Object>} Lista błędów napotkanych podczas wczytywania plików. */
let loadErrors = []; 

/** @type {Array<Array<string>>} Skompilowane zestawy tokenów do szybkich dopasowań. */
let compiledKeyLabTokenSets = []; 

/** @type {number} Timestamp ostatniego kliknięcia przycisku Home. */
let lastHomeResetTs = 0; 

/** @type {Function|null} Referencja do debounce dla wyszukiwania. */
let debouncedSearchRef = null; 

/** @type {Function|null} Referencja do debounce dla logowania wyszukiwań. */
let debouncedLogSearchRef = null; 

/** @type {number} Aktualna wartość paska postępu w ekranie ładowania. */
let loadingProgressValue = 0;

/** @type {number} Wartość wyświetlana (wygładzona) paska postępu w ekranie ładowania. */
let loadingProgressDisplayValue = 0;

/** @type {number} ID animacji requestAnimationFrame dla paska postępu. */
let loadingProgressRaf = 0;

/** @type {number} Timestamp ostatniej klatki animacji paska postępu. */
let loadingProgressLastFrameTs = 0;

/**
 * Stan „systemowej” symulacji progresu (celowo nieregularny, aby wyglądał naturalnie).
 * @type {{
 *   runId: number,
 *   pauseUntilTs: number,
 *   pauseTimerId: number | null,
 *   nextMicroStopAtTs: number,
 *   nextJumpAtTs: number,
 *   speedDriftUntilTs: number,
 *   speedMultiplier: number,
 *   boostUntilTs: number,
 *   lastTargetValue: number,
 *   profile: {
 *     fastPps: number,
 *     midPps: number,
 *     cruisePps: number,
 *     tailPps: number,
 *     finalPps: number
 *   } | null
 * } }
 */
let loadingProgressSim = {
    runId: 0,
    pauseUntilTs: 0,
    pauseTimerId: null,
    nextMicroStopAtTs: 0,
    nextJumpAtTs: 0,
    speedDriftUntilTs: 0,
    speedMultiplier: 1,
    boostUntilTs: 0,
    lastTargetValue: 0,
    profile: null
};

/** @type {boolean} Flaga zakończenia animacji ładowania. */
let loadingProgressDone = false;

/** @type {boolean} Flaga gotowości danych aplikacji. */
let loadingDataReady = false;

/** @type {boolean} Flaga błędu ładowania. */
let loadingFailed = false;

/** @type {number} Czas rozpoczęcia procesu ładowania. */
let loadingStartedAt = 0;

/** @type {number} Licznik instancji loga dla unikalnych ID SVG. */
let logoInstanceCounter = 0;

/** @type {Promise|null} Obietnica otwarcia bazy danych. */
let docsDbPromise = null;

/** @type {Object} Ostatni stan podglądu pliku. */
let lastPreviewState = { fileName: null, rowIndex: null };

/**
 * Obserwatory odpowiedzialne za automatyczne aktualizowanie stanu scroll-indicator
 * na podstawie faktycznego overflow listy wyników.
 * @type {{
 *   resize: ResizeObserver | null,
 *   mutation: MutationObserver | null,
 *   attached: boolean,
 *   onWindowScroll: ((e?: Event) => void) | null,
 *   onWindowResize: ((e?: UIEvent) => void) | null,
 *   onListScroll: ((e?: Event) => void) | null
 * }}
 */
let resultsListOverflowObservers = { resize: null, mutation: null, attached: false, onWindowScroll: null, onWindowResize: null, onListScroll: null };

let resultsEndIntersection = { observer: null, target: null, lastFullyVisible: false };

let welcomeLogoDomContentLoadedTs = null;
let welcomeLogoEnterTimer = null;
let welcomeSeqUnlockTimer = null;
let welcomeSeqFailSafeTimer = null;

let welcomeTextUpdatesLocked = true;
let pendingLoadingStatusText = null;
let pendingLoadingProgressValue = null;
let pendingLoadingErrorMessage = null;
let pendingLoadingErrorVisible = false;

let welcomeParallaxRaf = 0;
let welcomeParallaxTargetX = 0;
let welcomeParallaxTargetY = 0;
let welcomeParallaxCurrentX = 0;
let welcomeParallaxCurrentY = 0;
let welcomeOverlayStartedAt = 0;
let bootWatchdogTimer = null;

/** @type {LoadingTitleRotator|null} Kontroler rotacji komunikatów w tytule ekranu ładowania. */
let loadingTitleRotator = null;

/** @type {{ finalText: string, interimText: string, applied: boolean } | null} */
let pendingLoadingStatusFinalization = null;

function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function clampNumber(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function getLoadingTitleCategoryForProgress(progressPercent) {
    const p = clampNumber(progressPercent, 0, 100);
    if (p >= 100) return 'powitalne';
    if (p <= 20) return 'startowe';
    if (p <= 50) return 'techniczne';
    if (p <= 80) return 'absurdalne';
    return 'finalizujace';
}

function pickRandomNonRepeating(items, lastValue) {
    if (!Array.isArray(items) || items.length === 0) return '';
    if (items.length === 1) return items[0];
    let next = items[Math.floor(Math.random() * items.length)];
    if (typeof lastValue === 'string' && lastValue.length > 0) {
        let guard = 0;
        while (next === lastValue && guard < 12) {
            next = items[Math.floor(Math.random() * items.length)];
            guard += 1;
        }
    }
    return next;
}

function randomIntInclusive(min, max) {
    const a = Math.ceil(Number(min));
    const b = Math.floor(Number(max));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    if (a > b) return a;
    return Math.floor(a + Math.random() * (b - a + 1));
}

function randomFloat(min, max) {
    const a = Number(min), b = Number(max);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    if (a > b) return a;
    return a + Math.random() * (b - a);
}

function isLoadingVisualFinishAllowed() {
    return Boolean(loadingProgressDone && (loadingDataReady || loadingFailed));
}

function getSoftCapLeadAllowance(displayPercent) {
    const p = clampNumber(displayPercent, 0, 100);
    if (p < 25) return 10;
    if (p < 60) return 7;
    if (p < 85) return 5;
    if (p < 95) return 3;
    return 1.5;
}

function setPendingFinalLoadingStatusText(finalText, interimText) {
    const finalT = String(finalText || '').trim();
    const interimT = String(interimText || '').trim();
    if (!finalT) { pendingLoadingStatusFinalization = null; return; }
    pendingLoadingStatusFinalization = { finalText: finalT, interimText: interimT || 'Finalizowanie...', applied: false };
}

function syncPendingFinalLoadingStatusText() {
    if (!pendingLoadingStatusFinalization) return;
    if (!loadingProgressDone) return;
    const canFinalizeVisual = prefersReducedMotion() ? (loadingProgressValue >= 100) : (loadingProgressDisplayValue >= 100);
    if (canFinalizeVisual) {
        if (!pendingLoadingStatusFinalization.applied) {
            pendingLoadingStatusFinalization.applied = true;
            setLoadingStatusText(pendingLoadingStatusFinalization.finalText);
        }
        return;
    }
    if (!pendingLoadingStatusFinalization.applied) setLoadingStatusText(pendingLoadingStatusFinalization.interimText);
}

function setLoadingTitleContent(el, nextText) {
    if (!el) return;
    const raw = String(nextText || '').trim();
    if (raw.length === 0) return;
    const normalized = raw.replace(/[✅✔🗸]/g, '✓');
    let hasCheck = false;
    const frag = document.createDocumentFragment();
    for (const ch of Array.from(normalized)) {
        if (ch === '✓') {
            hasCheck = true;
            const s = document.createElement('span');
            s.className = 'qe-check';
            s.textContent = ch;
            frag.appendChild(s);
            continue;
        }
        frag.appendChild(document.createTextNode(ch));
    }
    el.replaceChildren(frag);
    el.classList.toggle('qe-title-has-check', hasCheck);
}

async function animateLoadingTitleSwap(el, nextText, { reducedMotion } = {}) {
    if (!el) return;
    const text = String(nextText || '').trim();
    if (text.length === 0) return;
    if (reducedMotion) { setLoadingTitleContent(el, text); el.style.opacity = '1'; return; }

    const fade = (from, to, durationMs) => new Promise((resolve) => {
        try {
            if (typeof el.animate === 'function') {
                const anim = el.animate(
                    [{ opacity: from }, { opacity: to }],
                    { duration: durationMs, easing: 'ease', fill: 'forwards' }
                );
                anim.addEventListener('finish', () => resolve(), { once: true });
                anim.addEventListener('cancel', () => resolve(), { once: true });
            } else {
                el.style.transition = `opacity ${durationMs}ms ease`;
                el.style.opacity = String(to);
                window.setTimeout(() => resolve(), durationMs);
            }
        } catch {
            el.style.opacity = String(to);
            window.setTimeout(() => resolve(), durationMs);
        }
    });

    await fade(1, 0, LOADING_TITLE_FADE_OUT_MS);
    setLoadingTitleContent(el, text);
    await fade(0, 1, LOADING_TITLE_FADE_IN_MS);
    el.style.opacity = '1';
}

/**
 * Rotuje losowe komunikaty w tytule ekranu ładowania, synchronizując pulę komunikatów z postępem.
 */
class LoadingTitleRotator {
    /**
     * @param {{ el: HTMLElement|null, getProgress: () => number }} cfg
     */
    constructor(cfg) {
        this._el = cfg?.el || null;
        this._getProgress = typeof cfg?.getProgress === 'function' ? cfg.getProgress : (() => 0);
        this._reducedMotion = prefersReducedMotion();
        this._timer = null;
        this._running = false;
        this._lastMessage = '';
        this._animSeq = 0;
    }

    start() {
        if (this._running) return;
        if (!this._el) return;
        this._running = true;
        this._reducedMotion = prefersReducedMotion();
        this._scheduleNext({ immediate: true });
    }

    stop() {
        this._running = false;
        this._animSeq += 1;
        if (this._timer !== null) {
            window.clearTimeout(this._timer);
            this._timer = null;
        }
        if (this._el) {
            this._el.style.opacity = '1';
        }
    }

    _scheduleNext({ immediate } = {}) {
        if (!this._running) return;
        if (!this._el) return;

        const delay = immediate
            ? 0
            : Math.floor(LOADING_TITLE_INTERVAL_MIN_MS + Math.random() * (LOADING_TITLE_INTERVAL_MAX_MS - LOADING_TITLE_INTERVAL_MIN_MS));

        if (this._timer !== null) window.clearTimeout(this._timer);
        this._timer = window.setTimeout(() => {
            this._timer = null;
            void this._tick();
        }, delay);
    }

    async _tick() {
        if (!this._running) return;
        if (!this._el) return;

        const progress = clampNumber(this._getProgress(), 0, 100);
        const category = getLoadingTitleCategoryForProgress(progress);
        const pool = LOADING_TITLE_MESSAGES[category] || [];
        const next = pickRandomNonRepeating(pool, this._lastMessage);
        if (!next) {
            if (progress >= 100) { this.stop(); return; }
            this._scheduleNext();
            return;
        }

        const seq = (this._animSeq += 1);
        await animateLoadingTitleSwap(this._el, next, { reducedMotion: this._reducedMotion });
        if (!this._running) return;
        if (seq !== this._animSeq) return;
        this._lastMessage = next;
        if (progress >= 100) { this.stop(); return; }
        this._scheduleNext();
    }
}

function setLoadingProgressDisplayPercent(percent) {
    const next = clampNumber(percent, 0, 100);
    loadingProgressDisplayValue = next;
    if (loadingProgressMeta) loadingProgressMeta.textContent = `${Math.round(next)}%`;
    if (loadingProgressBar) loadingProgressBar.value = next;
    updateLoadingContinueAvailability();
    syncPendingFinalLoadingStatusText();
}

function stopLoadingProgressAnimation() {
    if (!loadingProgressRaf) return;
    window.cancelAnimationFrame(loadingProgressRaf);
    loadingProgressRaf = 0;
    loadingProgressLastFrameTs = 0;
    if (loadingProgressSim.pauseTimerId !== null) {
        window.clearTimeout(loadingProgressSim.pauseTimerId);
        loadingProgressSim.pauseTimerId = null;
    }
}

function kickLoadingProgressAnimation() {
    if (loadingProgressRaf) return;
    loadingProgressLastFrameTs = performance.now();
    loadingProgressRaf = window.requestAnimationFrame(stepLoadingProgressAnimation);
}

function stepLoadingProgressAnimation(ts) {
    loadingProgressRaf = 0;
    if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;

    const display = clampNumber(loadingProgressDisplayValue, 0, 100);
    if (prefersReducedMotion()) {
        const target = clampNumber(loadingProgressValue, 0, 100);
        setLoadingProgressDisplayPercent(target);
        return;
    }

    const dt = Math.max(0, ts - (loadingProgressLastFrameTs || ts));
    loadingProgressLastFrameTs = ts;

    const rawTarget = clampNumber(loadingProgressValue, 0, 100);
    const finishAllowed = isLoadingVisualFinishAllowed();
    const hardCap = finishAllowed ? 100 : LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH;
    const lead = getSoftCapLeadAllowance(display);
    const cap = clampNumber(Math.min(hardCap, Math.max(display, rawTarget + lead)), 0, 100);

    const sim = loadingProgressSim;
    const now = ts;

    if (sim.profile === null) {
        sim.profile = {
            fastPps: randomFloat(22, 34),
            midPps: randomFloat(10, 18),
            cruisePps: randomFloat(6, 12),
            tailPps: randomFloat(1.2, 3.6),
            finalPps: randomFloat(18, 34)
        };
    }

    if (rawTarget > sim.lastTargetValue) {
        const delta = rawTarget - sim.lastTargetValue;
        if (delta >= 6) {
            sim.boostUntilTs = Math.max(sim.boostUntilTs, now + randomIntInclusive(450, 1100));
        }
        sim.lastTargetValue = rawTarget;
    }

    if (sim.pauseUntilTs > 0 && now < sim.pauseUntilTs) {
        if (sim.pauseTimerId === null) {
            const remaining = Math.max(0, sim.pauseUntilTs - now);
            sim.pauseTimerId = window.setTimeout(() => {
                sim.pauseTimerId = null;
                kickLoadingProgressAnimation();
            }, Math.min(remaining + 12, 220));
        }
        return;
    }

    if (sim.pauseTimerId !== null) {
        window.clearTimeout(sim.pauseTimerId);
        sim.pauseTimerId = null;
    }

    if (now >= sim.speedDriftUntilTs) {
        sim.speedMultiplier = randomFloat(0.82, 1.22);
        sim.speedDriftUntilTs = now + randomIntInclusive(260, 720);
        if (display < 85 && Math.random() < 0.22) {
            sim.boostUntilTs = Math.max(sim.boostUntilTs, now + randomIntInclusive(280, 720));
        }
    }

    if (now >= sim.nextMicroStopAtTs) {
        sim.nextMicroStopAtTs = now + randomIntInclusive(420, 1350);
        const p = display;
        const stopChance = p < 20 ? 0.12 : (p < 60 ? 0.22 : (p < 85 ? 0.18 : 0.10));
        const nearCap = (cap - display) < 1.2;
        if (!nearCap && Math.random() < stopChance) {
            sim.pauseUntilTs = now + randomIntInclusive(LOADING_PROGRESS_MICROSTOP_MIN_MS, LOADING_PROGRESS_MICROSTOP_MAX_MS);
            kickLoadingProgressAnimation();
            return;
        }
    }

    let basePps;
    if (display < 25) basePps = sim.profile.fastPps;
    else if (display < 60) basePps = sim.profile.midPps;
    else if (display < 85) basePps = sim.profile.cruisePps;
    else if (display < 97) basePps = sim.profile.tailPps;
    else basePps = sim.profile.tailPps * 0.75;

    const boost = (now < sim.boostUntilTs) ? randomFloat(1.35, 1.95) : 1;
    const requestedSpeedPps = basePps * sim.speedMultiplier * boost;

    let next = display;

    if (finishAllowed && rawTarget >= 100 && display >= 97) {
        next = Math.min(100, display + (dt / 1000) * sim.profile.finalPps);
    } else {
        next = Math.min(cap, display + (dt / 1000) * requestedSpeedPps);
    }

    if (now >= sim.nextJumpAtTs) {
        const minGap = display < 25 ? 260 : (display < 85 ? 340 : 520);
        const maxGap = display < 25 ? 720 : (display < 85 ? 980 : 1320);
        sim.nextJumpAtTs = now + randomIntInclusive(minGap, maxGap);

        const room = cap - next;
        if (room > 0.8 && Math.random() < 0.78) {
            const maxJump = display >= 85 ? 2 : LOADING_PROGRESS_JUMP_MAX;
            const jump = Math.min(room, randomIntInclusive(LOADING_PROGRESS_JUMP_MIN, maxJump));
            if (jump >= 0.9) {
                next = Math.min(cap, next + jump);
            }
        }
    }

    if (next !== display) setLoadingProgressDisplayPercent(next);
    if (next < cap) kickLoadingProgressAnimation();
}

function applyLoadingProgressTargetPercent(percent) {
    const target = clampNumber(percent, 0, 100);
    loadingProgressValue = target;
    if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;
    if (prefersReducedMotion()) {
        setLoadingProgressDisplayPercent(target);
        return;
    }
    kickLoadingProgressAnimation();
}

function updateLoadingContinueAvailability() {
    if (!loadingContinueButton || !loadingOverlay) return;
    const canContinue = Boolean(loadingProgressDone && (loadingDataReady || loadingFailed) && (loadingFailed || loadingProgressDisplayValue >= 100));
    loadingContinueButton.disabled = !canContinue;
    if (canContinue) loadingOverlay.setAttribute('aria-busy', 'false');
}

function ensureLoadingTitleRotator() {
    if (loadingTitleRotator) return loadingTitleRotator;
    loadingTitleRotator = new LoadingTitleRotator({
        el: loadingTitleText,
        getProgress: () => loadingProgressDisplayValue
    });
    return loadingTitleRotator;
}

function startLoadingOverlayDynamicEffects() {
    if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;
    ensureLoadingTitleRotator().start();
    applyLoadingProgressTargetPercent(loadingProgressValue);
}

function applyWelcomeElementsInitState() {
    if (!loadingOverlay) return;
    const welcomeText = document.getElementById('welcome-text');
    const loadingActions = loadingOverlay.querySelector('.loading-actions');
    const nodes = [welcomeText, loadingStatusText, loadingOverlay.querySelector('.loading-progress'), loadingActions, loadingError].filter(Boolean);
    for (const el of nodes) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(12px) scale(0.992)';
        el.style.filter = 'blur(12px)';
    }
    if (loadingActions) loadingActions.style.pointerEvents = 'none';
}

function clearWelcomeElementsInitState() {
    if (!loadingOverlay) return;
    const welcomeText = document.getElementById('welcome-text');
    const loadingActions = loadingOverlay.querySelector('.loading-actions');
    const nodes = [welcomeText, loadingStatusText, loadingOverlay.querySelector('.loading-progress'), loadingActions, loadingError].filter(Boolean);
    for (const el of nodes) {
        el.style.opacity = '';
        el.style.transform = '';
        el.style.filter = '';
    }
    if (loadingActions) loadingActions.style.pointerEvents = '';
}

function forceWelcomeSequenceDone() {
    if (!loadingOverlay) return;
    clearWelcomeElementsInitState();
    loadingOverlay.dataset.welcomeSeq = 'done';
    if (welcomeTextUpdatesLocked) {
        welcomeTextUpdatesLocked = false;
        flushPendingWelcomeTextUpdates();
    }
    startLoadingOverlayDynamicEffects();
}

//////////////////////////////////////////////////
// FUNKCJE INICJALIZACYJNE
//////////////////////////////////////////////////

document.addEventListener('DOMContentLoaded', () => {
    welcomeLogoDomContentLoadedTs = performance.now();
    scheduleWelcomeLogoEntrance();
}, { once: true });

/**
 * Główna funkcja startowa aplikacji.
 */
async function init() {
    ensureFetchPolyfill();
    setupTheme();
    setupEventListeners();
    setupLoadingContinueHandlers();
    setupMutationObserver();
    compileKeyLabTokenSets();
    setupWelcomeOverlayParallax();

    lazyLoadWelcomeGraphic();
    renderHeaderLogo();

    setSearchEnabled(false);
    startLoadingScreen();
    loadingStartedAt = performance.now();
    logAction('boot', { phase: 'start' });

    if (bootWatchdogTimer !== null) {
        window.clearTimeout(bootWatchdogTimer);
        bootWatchdogTimer = null;
    }
    bootWatchdogTimer = window.setTimeout(() => {
        bootWatchdogTimer = null;
        if (loadingProgressDone) return;
        forceWelcomeSequenceDone();
        loadingFailed = true;
        setLoadingProgressPercent(100, { force: true });
        showLoadingError('Ładowanie trwa zbyt długo. Możesz przejść dalej do aplikacji i zaimportować dane ręcznie.');
        finalizeBoot();
    }, BOOT_WATCHDOG_MS);

    await performInitialDataLoad();
}

/**
 * Wykonuje wstępne ładowanie danych z bazy.
 */
async function performInitialDataLoad() {
    try {
        await openDocsDb();
        await loadAllFiles({ fullReload: true, showProgress: true });
        loadingDataReady = true;
        loadingFailed = false;
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

/**
 * Obsługuje błąd wstępnego ładowania danych.
 */
function handleInitialLoadError(err) {
    loadingFailed = true;
    setSearchEnabled(false);
    showLoadingError('Błąd ładowania danych. Zaimportuj pliki .xlsx/.xls/.csv.');
    logAction('boot', { phase: 'error', message: err?.message ? String(err.message) : 'error' }, 'ERROR');
}

/**
 * Kończy proces startu aplikacji.
 */
function finalizeBoot() {
    if (bootWatchdogTimer !== null) {
        window.clearTimeout(bootWatchdogTimer);
        bootWatchdogTimer = null;
    }
    loadingProgressDone = true;
    prepareManualContinue();
    const totalMs = Math.round(performance.now() - loadingStartedAt);
    logAction('boot', { phase: 'done', ms: totalMs });
}

/**
 * Aktualizuje stan paska postępu na początku ładowania.
 */
function updateLoadingProgressStart(total) {
    setLoadingStatusText(total === 0 ? 'Brak plików .xlsx/.csv. Zaimportuj dane.' : 'Wczytywanie plików...');
    setLoadingProgressPercent(total === 0 ? 100 : 0, { force: true });
}

/**
 * Konfiguruje motyw graficzny aplikacji.
 */
function setupTheme() {
    let isMatrixThemeActive = (storageGet('matrixThemeActive') === 'true') || Boolean(window.isMatrixThemeActive);

    window.addEventListener('qe:matrix-theme-changed', (ev) => {
        isMatrixThemeActive = Boolean(ev && ev.detail && ev.detail.active);
        try { window.isMatrixThemeActive = isMatrixThemeActive; } catch { }
        // Przy aktywnym MATRIX® blokujemy przełącznik dark/light, aby nie mieszać dwóch systemów styli.
        updateThemeToggleLock();
        // Prze-renderowanie logo zapewnia spójne kolory w headerze i na ekranie powitalnym.
        renderHeaderLogo();
        refreshWelcomeGraphicIfPresent();
    }, { passive: true });

    function updateThemeToggleLock() {
        if (!themeToggle) return;
        const container = themeToggle.closest('.theme-switch-container');
        themeToggle.disabled = isMatrixThemeActive;
        if (container) container.classList.toggle('matrix-theme-locked', isMatrixThemeActive);
    }

    const savedTheme = storageGet('theme') || 'dark';
    applyTheme(savedTheme);
    themeToggle.checked = savedTheme === 'dark';
    updateThemeToggleLock();

    themeToggle.addEventListener('click', (e) => {
        if (!isMatrixThemeActive) return;
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }, true);

    themeToggle.addEventListener('change', (e) => {
        if (isMatrixThemeActive) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            themeToggle.checked = document.body.classList.contains('dark-theme');
            return;
        }
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        applyTheme(newTheme);
        storageSet('theme', newTheme);
        logClientEvent('theme', { theme: newTheme });
    });
}

/**
 * Aplikuje wybrany motyw graficzny.
 */
function applyTheme(theme) {
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(theme + '-theme');
    themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
    renderHeaderLogo();
    refreshWelcomeGraphicIfPresent();
}

/**
 * Rejestruje globalne event listenery.
 */
function setupEventListeners() {
    setupSearchListeners();
    setupImportListeners();
    setupDragAndDropListeners();
    setupNavigationListeners();
    setupGlobalErrorListeners();
    setupDeveloperFakeLoadingBypass();

    document.addEventListener('qe:preview-ready', () => highlightLabsInPreviewTable(), { passive: true });
}

/**
 * Konfiguruje listenery wyszukiwarki.
 */
function setupSearchListeners() {
    const debouncedSearch = debounce((query) => performSearch(query), 180);
    const debouncedLogSearch = debounce((query) => logClientEvent('search', { query }), 450);
    const debouncedPredictive = debounce((query, source) => updatePredictiveSuggestions(query, { source }), 150);
    debouncedSearchRef = debouncedSearch;
    debouncedLogSearchRef = debouncedLogSearch;

    searchInput.addEventListener('input', (e) => {
        if (!isSearchEnabled) return;
        const query = e.target.value.trim();
        debouncedPredictive(query, 'input');
        handleSearchInput(query, debouncedSearch, debouncedLogSearch);
    });

    searchInput.addEventListener('keydown', handlePredictiveKeydown);
    searchInput.addEventListener('scroll', () => syncGhostOverlayScroll(), { passive: true });
    searchInput.addEventListener('blur', () => hideGhostOverlay(), { passive: true });
    searchInput.addEventListener('compositionstart', () => { predictiveIsComposing = true; hideGhostOverlay(); }, { passive: true });
    searchInput.addEventListener('compositionend', () => { predictiveIsComposing = false; updatePredictiveSuggestions(searchInput.value, { source: 'compositionend' }); }, { passive: true });
}

/**
 * Konfiguruje listenery importu plików.
 */
function setupImportListeners() {
    if (importButton) importButton.addEventListener('click', () => {
        logAction('import', { phase: 'open_dialog' }, 'INFO');
        fileInput?.click();
    });
    if (googleDriveButton) googleDriveButton.addEventListener('click', async () => {
        logAction('sync', { phase: 'start', source: 'toolbar' }, 'INFO');
        await handleGoogleDriveSync({ source: 'toolbar' });
    });
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) await handleImportFiles(files);
            fileInput.value = '';
        });
    }
}

/**
 * Konfiguruje obsługę przeciągania plików.
 */
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

/**
 * Konfiguruje obsługę nawigacji w aplikacji.
 */
function setupNavigationListeners() {
    backToSearchBtn.addEventListener('click', () => {
        if (history.state && history.state.view === 'preview') {
            history.back();
        } else {
            filePreviewView.classList.add('view-hidden');
            searchView.classList.remove('view-hidden');
            logClientEvent('navigate', { to: 'search', fallback: true });
        }
    });

    if (homeLink) {
        homeLink.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            if (history.state && history.state.view === 'home' && !history.state.search && !searchInput.value) {
                return;
            }
            resetToInitialState({ source: 'home' });
            logClientEvent('navigate', { to: 'home' });
            try { 
                history.pushState({ view: 'home', search: false }, '', '#home'); 
            } catch { }
        });
    }

    window.addEventListener('popstate', (event) => {
        const state = event.state;
        logAction('navigation', { phase: 'popstate', state }, 'INFO');
        if (!state) {
            resetToInitialState({ source: 'popstate_empty' });
            return;
        }
        if (state.view === 'preview') {
            if (state.fileName && fullFileData[state.fileName]) {
                showFilePreview(state.fileName, state.rowIndex, { skipPush: true });
            } else if (state.fileName) {
                resetToInitialState({ source: 'popstate_preview_missing_data' });
            }
        } else if (state.view === 'home') {
            if (!filePreviewView.classList.contains('view-hidden')) {
                togglePreviewView(false);
            }
            if (!state.search) {
                if (searchInput.value) {
                    searchInput.value = '';
                    clearResults();
                    statusIndicator.textContent = 'Dane gotowe.';
                    statusIndicator.classList.remove('status--hint');
                }
            } else if (state.query && searchInput.value !== state.query) {
                searchInput.value = state.query;
                if (isSearchEnabled) performSearch(state.query);
            }
        }
    });

    window.addEventListener('pageshow', (event) => {
        const persisted = Boolean(event && event.persisted);
        let navType = '';
        try {
            const navEntries = (performance.getEntriesByType && performance.getEntriesByType('navigation')) || [];
            navType = navEntries[0] && navEntries[0].type ? String(navEntries[0].type) : '';
        } catch { }

        if (!persisted && navType !== 'back_forward') return;

        logAction('navigation', { phase: 'pageshow', persisted, navType }, 'INFO');

        window.requestAnimationFrame(() => {
            try { void document.documentElement.offsetWidth; } catch { }
            try { void document.body.offsetHeight; } catch { }

            if (history.state && history.state.view === 'home') {
                try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { window.scrollTo(0, 0); }
            }

            try { syncResultsEndIntersectionObserver(); } catch { }
            try { updateScrollIndicator(); } catch { }
        });
    }, { passive: true });
}

/**
 * Rejestruje globalne listenery błędów.
 */
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

/**
 * Konfiguruje obserwatory i listenery odpowiedzialne za scroll-indicator.
 * Wskaźnik jest kontrolowany wyłącznie przez to, czy lista wyników wykracza poza viewport
 * kontenera przewijania (scrollHeight listy vs clientHeight kontenera).
 */
function setupMutationObserver() {
    if (!resultsList) return;

    const debouncedUpdate = debounce(() => {
        syncRouteCategorySectionHeights();
        syncResultsEndIntersectionObserver();
        updateScrollIndicator();
    }, 120);
    const scrollContainer = getResultsScrollContainer();

    if (resultsListOverflowObservers.mutation) {
        try { resultsListOverflowObservers.mutation.disconnect(); } catch { }
        resultsListOverflowObservers.mutation = null;
    }
    if (resultsListOverflowObservers.resize) {
        try { resultsListOverflowObservers.resize.disconnect(); } catch { }
        resultsListOverflowObservers.resize = null;
    }

    resultsListOverflowObservers.mutation = new MutationObserver(() => debouncedUpdate());
    resultsListOverflowObservers.mutation.observe(resultsList, { childList: true, subtree: true, attributes: true });

    if (typeof ResizeObserver === 'function') {
        resultsListOverflowObservers.resize = new ResizeObserver(() => debouncedUpdate());
        resultsListOverflowObservers.resize.observe(scrollContainer);
    }

    ensureResultsEndIntersectionObserver();

    if (!resultsListOverflowObservers.attached) {
        resultsListOverflowObservers.attached = true;
        resultsListOverflowObservers.onWindowScroll = () => updateScrollIndicator();
        resultsListOverflowObservers.onWindowResize = () => debouncedUpdate();
        resultsListOverflowObservers.onListScroll = () => updateScrollIndicator();

        window.addEventListener('scroll', resultsListOverflowObservers.onWindowScroll, { passive: true });
        window.addEventListener('resize', resultsListOverflowObservers.onWindowResize, { passive: true });
        resultsList.addEventListener('scroll', resultsListOverflowObservers.onListScroll, { passive: true });
    }

    debouncedUpdate();
}

/**
 * Konfiguruje obsługę przycisków kontynuacji na ekranie ładowania.
 */
function setupLoadingContinueHandlers() {
    if (loadingContinueButton) {
        loadingContinueButton.addEventListener('click', continueToApp);
    }
    if (syncGDriveButton) {
        syncGDriveButton.addEventListener('click', () => handleGoogleDriveSync({ source: 'welcome' }));
    }
}

/**
 * Backdoor deweloperski: umożliwia pominięcie „fake loading” poprzez kliknięcie w centralną część loga na ekranie ładowania.
 * Mechanizm działa wyłącznie wtedy, gdy faktyczne ładowanie danych jest zakończone, ale UI nadal symuluje domykanie progresu.
 */
function setupDeveloperFakeLoadingBypass() {
    const container = document.getElementById('welcome-graphic');
    if (!container || !loadingOverlay) return;

    const HIT_RADIUS_SCALE = 0.72;
    const MIN_HIT_RADIUS_PX = 10;

    const isFakeLoadingActive = () => {
        if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return false;
        if (!loadingContinueButton || !loadingContinueButton.disabled) return false;
        return isLoadingVisualFinishAllowed();
    };

    const getPulseCircleRect = () => {
        const svg = container.querySelector('svg');
        if (!svg) return null;
        const circle = svg.querySelector('circle.qe-pulse');
        if (!circle) return null;
        const rect = circle.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return rect;
    };

    container.addEventListener('pointerdown', (e) => {
        if (!isFakeLoadingActive()) return;
        if (!e.isTrusted) return;
        if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;

        const rect = getPulseCircleRect();
        if (!rect) return;

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const baseRadius = Math.min(rect.width, rect.height) / 2;
        const hitRadius = Math.max(MIN_HIT_RADIUS_PX, baseRadius * HIT_RADIUS_SCALE);

        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        if ((dx * dx + dy * dy) > (hitRadius * hitRadius)) return;

        e.preventDefault();
        e.stopPropagation();
        continueToApp();
    }, { passive: false });
}

//////////////////////////////////////////////////
// OBSŁUGA ŁADOWANIA I PARSOWANIA ARKUSZY (SheetJS)
//////////////////////////////////////////////////

/**
 * Ładuje wszystkie pliki z bazy danych.
 */
async function loadAllFiles({ fullReload, showProgress } = { fullReload: false, showProgress: false }) {
    if (isLoading) return;
    isLoading = true;
    const loadStart = performance.now();

    try {
        await loadScheduleFiles({ fullReload, showProgress });
        const spreadsheetFiles = await getRouteSpreadsheetFiles();
        fileCountSpan.textContent = spreadsheetFiles.length;
        if (fullReload) resetAppData();
        const filesToLoad = fullReload ? spreadsheetFiles : spreadsheetFiles.filter(f => !loadedFiles.has(f));
        if (showProgress) updateLoadingProgressStart(filesToLoad.length);

        if (filesToLoad.length > 0) {
            await processFilesWithConcurrency(filesToLoad, showProgress);
            statusIndicator.textContent = loadErrors.length > 0 ? `Dane gotowe (błędy: ${loadErrors.length}).` : 'Dane gotowe.';
        } else {
            statusIndicator.textContent = 'Dane aktualne.';
        }

        schedulePredictiveIndexRebuild({ reason: 'load_all_files_done' });
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

/**
 * Pobiera listę plików tras (arkuszy) z bazy danych.
 * Pliki grafiku są celowo pomijane, aby nie zanieczyszczały indeksu wyszukiwania.
 */
async function getRouteSpreadsheetFiles() {
    statusIndicator.textContent = 'Sprawdzanie plików...';
    const files = await docsListFiles();
    const spreadsheetFiles = Array.isArray(files)
        ? files.map(f => String(f?.name ?? '')).filter(f => {
            const lower = f.toLowerCase();
            const isSpreadsheet = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
            return isSpreadsheet && !isScheduleFileName(f);
        })
        : [];
    spreadsheetFiles.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
    return spreadsheetFiles;
}

/**
 * Przetwarza pliki z wykorzystaniem współbieżności.
 */
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
                if (showProgress) setLoadingProgressPercent((done / total) * 100);
            }
        }
    });
    await Promise.all(workers);
}

/**
 * Przetwarza pojedynczy plik.
 */
async function processFile(fileName) {
    const blob = await docsGetBlob(fileName);
    if (!blob) throw new Error('Nie można odczytać pliku z /docs');
    await parseSpreadsheet(blob, fileName);
}

/**
 * Parsuje arkusz kalkulacyjny przy użyciu SheetJS.
 */
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

//////////////////////////////////////////////////
// OBSŁUGA GRAFIKU KIEROWCÓW (TRASA -> KIEROWCA)
//////////////////////////////////////////////////

/**
 * Zwraca konfigurację grafiku (kody tras/oznaczenia), jeśli jest dostępna.
 */
function getRouteScheduleConfig() {
    const cfg = window.QE_RouteScheduleConfig;
    if (cfg && typeof cfg === 'object') return cfg;
    return {
        monthsPl: {},
        standard: [],
        wieczorek: [],
        sobota: [],
        niedziela: [],
        dayMarkers: [],
        normalizeScheduleToken: (t) => String(t ?? '').trim().toUpperCase()
    };
}

function scheduleMonthKey(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';
    return `${y}-${String(m).padStart(2, '0')}`;
}

function isoDateFromParts(year, month, day) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Rozpoznaje plik grafiku po formacie: "MIASTO MIESIĄC ROK.xlsx|xls|csv".
 * Miasto jest ignorowane.
 */
function parseScheduleFileNameYearMonth(fileName) {
    const name = String(fileName || '').trim();
    if (!name) return null;
    const extMatch = name.toLowerCase().match(/\.(xlsx|xls|csv)$/);
    if (!extMatch) return null;

    const base = name.replace(/\.(xlsx|xls|csv)$/i, '').trim();
    const parts = base.split(/\s+/g).filter(Boolean);
    if (parts.length < 3) return null;

    const yearRaw = parts[parts.length - 1];
    const monthRaw = parts[parts.length - 2];
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;

    const cfg = getRouteScheduleConfig();
    const monthKey = String(fuzzyNormalizeText(monthRaw) || '').toUpperCase();
    const month = Number(cfg.monthsPl?.[monthKey]);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;

    return { year, month, key: scheduleMonthKey(year, month) };
}

function isScheduleFileName(fileName) {
    return Boolean(parseScheduleFileNameYearMonth(fileName));
}

function normalizeDriverDisplayName(value) {
    const raw = value === null || value === undefined ? '' : String(value);
    return raw.replace(/\s+/g, ' ').trim();
}

function normalizeScheduleRouteCode(value) {
    const cfg = getRouteScheduleConfig();
    const token = cfg.normalizeScheduleToken ? cfg.normalizeScheduleToken(value) : String(value ?? '').trim().toUpperCase();
    return String(token || '').trim().toUpperCase();
}

/**
 * Parsuje zawartość komórki grafiku i zwraca kody tras, które należy przypisać do kierowcy.
 * Obsługuje formaty typu:
 * - "2"
 * - "J"
 * - "16/F"
 * - "O/23"
 * - "S - 5"
 * - "N - 2"
 */
function buildScheduleTokenSets() {
    const cfg = getRouteScheduleConfig();
    return {
        standardSet: new Set((cfg.standard || []).map(s => normalizeScheduleRouteCode(s))),
        wieczorekSet: new Set((cfg.wieczorek || []).map(s => normalizeScheduleRouteCode(s))),
        sobotaSet: new Set((cfg.sobota || []).map(s => normalizeScheduleRouteCode(s))),
        niedzielaSet: new Set((cfg.niedziela || []).map(s => normalizeScheduleRouteCode(s))),
        markersSet: new Set((cfg.dayMarkers || []).map(s => normalizeScheduleRouteCode(s)))
    };
}

function parseScheduleCellToRoutes(cellValue, tokenSets) {
    const cfg = getRouteScheduleConfig();
    const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
    const cleaned = raw.trim();
    if (!cleaned) return [];

    const sets = tokenSets && typeof tokenSets === 'object' ? tokenSets : buildScheduleTokenSets();
    const standardSet = sets.standardSet;
    const wieczorekSet = sets.wieczorekSet;
    const sobotaSet = sets.sobotaSet;
    const niedzielaSet = sets.niedzielaSet;
    const markersSet = sets.markersSet;

    const tokens = cleaned
        .split('/')
        .map(t => normalizeScheduleRouteCode(t))
        .map(t => t.replace(/\s+/g, ''))
        .map(t => t.replace(/[–—]/g, '-'))
        .map(t => t.replace(/S-?(\d+)/i, 'S-$1'))
        .map(t => t.replace(/N-?(\d+)/i, 'N-$1'))
        .filter(Boolean);

    const routes = [];
    for (const tok of tokens) {
        if (standardSet.has(tok) || wieczorekSet.has(tok) || sobotaSet.has(tok) || niedzielaSet.has(tok)) {
            routes.push(tok);
            continue;
        }
        if (/^S-\d+$/i.test(tok) && sobotaSet.has(tok.toUpperCase())) { routes.push(tok.toUpperCase()); continue; }
        if (/^N-\d+$/i.test(tok) && niedzielaSet.has(tok.toUpperCase())) { routes.push(tok.toUpperCase()); continue; }
        if (markersSet.has(tok)) continue;
    }

    return Array.from(new Set(routes));
}

function findScheduleHeaderRowIndex(matrix) {
    const rows = Array.isArray(matrix) ? matrix : [];
    for (let i = 0; i < rows.length; i++) {
        const row = Array.isArray(rows[i]) ? rows[i] : [];
        const first = row[0] === null || row[0] === undefined ? '' : String(row[0]);
        const norm = fuzzyNormalizeText(first);
        if (norm.includes('imie') && (norm.includes('nazw') || norm.includes('nazwisko'))) return i;
    }
    return -1;
}

function buildScheduleDayColumnMap(headerRow) {
    const row = Array.isArray(headerRow) ? headerRow : [];
    const map = new Map();
    for (let col = 1; col < row.length; col++) {
        const cell = row[col];
        const n = Number(String(cell ?? '').trim());
        if (Number.isInteger(n) && n >= 1 && n <= 31 && !map.has(n)) map.set(n, col);
    }
    return map;
}

function daysInMonth(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m)) return 31;
    return new Date(y, m, 0).getDate();
}

function cacheScheduleAssignments({ year, month, key, fileName, byIsoDate }) {
    if (!key) return;
    scheduleCacheByMonth.set(key, { key, year, month, fileName, byIsoDate });
}

async function parseScheduleSpreadsheet(source, fileName) {
    const meta = parseScheduleFileNameYearMonth(fileName);
    if (!meta) throw new Error('Nieprawidłowa nazwa pliku grafiku');
    const { year, month, key } = meta;

    const workbook = await readWorkbook(source, fileName);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true, defval: '' });

    const headerIdx = findScheduleHeaderRowIndex(matrix);
    if (headerIdx < 0) throw new Error('Nie znaleziono wiersza nagłówka grafiku ("IMIE I NAZWISKO")');

    const headerRow = matrix[headerIdx];
    const dayToCol = buildScheduleDayColumnMap(headerRow);
    const maxDays = daysInMonth(year, month);
    const byIsoDate = new Map();
    const tokenSets = buildScheduleTokenSets();

    for (let rowIdx = headerIdx + 1; rowIdx < matrix.length; rowIdx++) {
        const row = Array.isArray(matrix[rowIdx]) ? matrix[rowIdx] : [];
        const driverName = normalizeDriverDisplayName(row[0]);
        if (!driverName) continue;

        for (let day = 1; day <= maxDays; day++) {
            const col = dayToCol.get(day);
            if (!Number.isInteger(col)) continue;
            const routes = parseScheduleCellToRoutes(row[col], tokenSets);
            if (routes.length === 0) continue;

            const iso = isoDateFromParts(year, month, day);
            if (!iso) continue;
            if (!byIsoDate.has(iso)) byIsoDate.set(iso, new Map());
            const byRoute = byIsoDate.get(iso);
            for (const routeCode of routes) {
                if (!routeCode) continue;
                if (!byRoute.has(routeCode)) byRoute.set(routeCode, driverName);
            }
        }
    }

    cacheScheduleAssignments({ year, month, key, fileName: String(fileName || ''), byIsoDate });
    loadedScheduleFiles.add(String(fileName || '').trim());
}

async function processScheduleFile(fileName) {
    const name = String(fileName || '').trim();
    if (!name) return;
    const blob = await docsGetBlob(name);
    if (!blob) throw new Error('Nie można odczytać pliku grafiku z bazy');
    await parseScheduleSpreadsheet(blob, name);
}

function getDriverForRouteOnDate(routeCode, date) {
    const d = date instanceof Date ? date : new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const key = scheduleMonthKey(year, month);
    if (!key) return null;
    const cache = scheduleCacheByMonth.get(key);
    if (!cache || !cache.byIsoDate) return null;
    const iso = isoDateFromParts(year, month, day);
    const byRoute = cache.byIsoDate.get(iso);
    if (!byRoute) return null;
    const normalized = normalizeScheduleRouteCode(routeCode).replace(/\s+/g, '');
    return byRoute.get(normalized) || null;
}

/**
 * Wyciąga kod trasy z nazwy pliku (np. "TRASA 12 ...xlsx" -> "12", "Trasa N - 1 ..." -> "N-1").
 */
function extractRouteCodeFromFileName(fileName) {
    const raw = String(fileName || '');
    const match = raw.match(/\btrasa\b\s*([A-Za-zĄĆĘŁŃÓŚŹŻ0-9]+(?:\s*[-–]\s*\d+)?)\b/i);
    if (!match) return '';
    const codeRaw = match[1] || '';
    const normalized = String(codeRaw)
        .replace(/[–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻ0-9-]/g, '')
        .toUpperCase();
    return normalized;
}

async function loadScheduleFiles({ fullReload, showProgress } = { fullReload: false, showProgress: false }) {
    try {
        const all = await docsListFiles();
        const scheduleFiles = Array.isArray(all)
            ? all.map(f => String(f?.name ?? '')).filter(n => isScheduleFileName(n))
            : [];
        if (scheduleFiles.length === 0) return;

        if (fullReload) {
            scheduleCacheByMonth = new Map();
            loadedScheduleFiles = new Set();
        }

        for (const name of scheduleFiles) {
            if (!fullReload && loadedScheduleFiles.has(name)) continue;
            try {
                if (showProgress) setLoadingStatusText(`Wczytuję grafik: ${formatFileName(name)}`);
                await processScheduleFile(name);
            } catch (err) {
                logAction('schedule', { fileName: name, message: err?.message ? String(err.message) : 'Błąd grafiku' }, 'WARN');
            }
        }
    } catch (err) {
        logAction('schedule', { phase: 'load_failed', message: err?.message ? String(err.message) : 'Błąd' }, 'WARN');
    }
}

/**
 * Odczytuje skoroszyt z różnych źródeł danych.
 */
async function readWorkbook(source, fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.csv')) {
        const csvContent = typeof source === 'string' ? source : (source && typeof source.text === 'function' ? await source.text() : '');
        return XLSX.read(csvContent, { type: 'string' });
    }
    const buffer = await getArrayBufferFromSource(source);
    return XLSX.read(buffer);
}

/**
 * Konwertuje źródło danych na ArrayBuffer.
 */
async function getArrayBufferFromSource(source) {
    if (source instanceof ArrayBuffer) return source;
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    if (source && typeof source.arrayBuffer === 'function') return await source.arrayBuffer();
    throw new Error('Nieprawidłowe dane wejściowe do parsowania');
}

/**
 * Importuje arkusz z ArrayBuffer.
 */
async function importSpreadsheetArrayBuffer(fileName, arrayBuffer, mimeType) {
    const safeName = String(fileName || '').trim();
    if (!safeName) throw new Error('Brak nazwy pliku');
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error('Brak danych pliku (ArrayBuffer)');
    const blob = new Blob([arrayBuffer], { type: String(mimeType || '') || 'application/octet-stream' });
    await docsPutBlob(safeName, blob);
    removeFileData(safeName);
    loadedFiles.delete(safeName);
    if (isScheduleFileName(safeName)) {
        loadedScheduleFiles.delete(safeName);
        await parseScheduleSpreadsheet(arrayBuffer, safeName);
    } else {
        await parseSpreadsheet(arrayBuffer, safeName);
        loadedFiles.add(safeName);
    }
}

/**
 * Obsługuje import plików z dysku lokalnego.
 */
async function handleImportFiles(files) {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) return;
    const { accepted, rejected } = filterImportFiles(list);
    rejected.forEach(r => logAction('import', { fileName: r.name, reason: r.reason }, 'WARN'));
    if (accepted.length === 0) return;
    const toImport = await resolveImportConflicts(accepted);
    if (toImport.length === 0) return;
    setImportLoadingState(true, toImport.length);
    const summary = { files: [], records: 0, errors: rejected.length };
    try {
        const before = allData.length;
        await processImportFiles(toImport, summary);
        finalizeFileImport(summary, before);
    } finally {
        setImportLoadingState(false);
    }
}

/**
 * Przetwarza importowane pliki.
 */
async function processImportFiles(accepted, summary) {
    let processed = 0;
    for (const file of accepted) {
        const name = String(file.name || '').trim();
        if (!name) continue;
        setUploadStatusText(`Importuję: ${formatFileName(name)}`);
        if (uploadProgress) uploadProgress.value = Math.max(0, Math.min(95, (processed / accepted.length) * 100));
        try {
            await docsPutBlob(name, file);
            removeFileData(name);
            if (isScheduleFileName(name)) {
                loadedScheduleFiles.delete(name);
                await processScheduleFile(name);
            } else {
                loadedFiles.delete(name);
                await processFile(name);
                loadedFiles.add(name);
            }
            summary.files.push(name);
        } catch (err) {
            summary.errors += 1;
            logAction('import', { fileName: name, message: err.message }, 'ERROR');
        } finally {
            processed += 1;
        }
    }
}

/**
 * Przełącza stan „zajętości” przycisków Google Drive, aby uniknąć uruchamiania wielu synchronizacji równocześnie.
 */
function setGoogleDriveSyncButtonsBusy(loading) {
    const busy = String(Boolean(loading));
    if (googleDriveButton) { googleDriveButton.setAttribute('aria-busy', busy); googleDriveButton.disabled = Boolean(loading); }
    if (syncGDriveButton) { syncGDriveButton.setAttribute('aria-busy', busy); syncGDriveButton.disabled = Boolean(loading); }
}

let googleDriveSyncIsImporting = false;
let googleDriveConnectSession = null;
let googleDriveConnectSeq = 0;

/**
 * Formatuje timestamp (ms) do czytelnej postaci dla modala synchronizacji.
 */
function formatDriveTimestamp(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '-';
    try { return new Date(n).toLocaleString('pl-PL'); } catch { return String(n); }
}

/**
 * Buduje treść modala z listą plików wykrytych jako zmienione.
 */
function buildDriveChangesModalHtml(changed) {
    const safeList = Array.isArray(changed) ? changed : [];
    const items = safeList.map((f) => {
        const rawName = String(f?.name || '').trim();
        const rawNameEsc = escapeHtml(rawName);
        const name = escapeHtml(formatFileName(rawName));
        const fileId = escapeHtml(String(f?.id || '').trim());
        const isNewInDb = Boolean(f?.isNewInDb);
        const reasonRaw = String(f?.changeReason || '').trim() || 'Zmieniono';
        const reason = escapeHtml(reasonRaw);
        const prevTs = Number(f?.previousDriveModifiedAt);
        const nextTs = Number(f?.driveModifiedAt);
        const prev = Number.isFinite(prevTs) && prevTs > 0 ? escapeHtml(formatDriveTimestamp(prevTs)) : '';
        const next = Number.isFinite(nextTs) && nextTs > 0 ? escapeHtml(formatDriveTimestamp(nextTs)) : '';
        const prevRow = prev ? `<div class="qe-drive-kv"><span class="qe-drive-k">Poprzednio</span><span class="qe-drive-v qe-drive-v--prev">${prev}</span></div>` : `<div class="qe-drive-kv is-muted"><span class="qe-drive-k">Poprzednio</span><span class="qe-drive-v qe-drive-v--prev">Brak danych</span></div>`;
        const nextRow = next ? `<div class="qe-drive-kv"><span class="qe-drive-k">Na Dysku</span><span class="qe-drive-v qe-drive-v--next">${next}</span></div>` : `<div class="qe-drive-kv is-muted"><span class="qe-drive-k">Na Dysku</span><span class="qe-drive-v qe-drive-v--next">Brak danych</span></div>`;
        const chevron = `<svg class="qe-drive-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const diffDisabled = isNewInDb ? ' disabled' : '';
        const diffBtnLabel = isNewInDb ? 'Nowy plik — brak różnic' : 'Pokaż różnice';
        const diffBtn = `<button class="qe-drive-diff-btn" type="button"${diffDisabled}>${diffBtnLabel}</button>`;
        const diffStatus = `<div class="qe-drive-diff-status" aria-hidden="true">
            <div class="qe-drive-diff-status-spinner" hidden><div class="qe-spinner" aria-hidden="true"></div></div>
            <div class="qe-drive-diff-status-check" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7L10.2 17 4 10.8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="qe-drive-diff-status-x" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg></div>
        </div>`;
        const diffState = isNewInDb ? 'blocked' : 'idle';
        const diffShell = `<div class="qe-drive-diff" data-qe-diff-state="${diffState}" data-qe-diff-visible="0">
            <div class="qe-drive-diff-actions">${diffBtn}${diffStatus}</div>
            <div class="qe-drive-diff-body" hidden>
                <div class="qe-drive-diff-error" hidden></div>
                <div class="qe-drive-diff-view" data-qe-diff-view="unified" hidden></div>
            </div>
        </div>`;
        return `<li class="qe-drive-change" data-qe-drive-name="${rawNameEsc}" data-qe-drive-id="${fileId}" data-qe-drive-is-new="${isNewInDb ? '1' : '0'}">
            <button class="qe-drive-change-toggle" type="button" aria-expanded="false">
                <div class="qe-drive-change-head">
                    <div class="qe-drive-change-name">${name}</div>
                    <div class="qe-drive-change-right">
                        <div class="qe-drive-chip">${reason}</div>
                        ${chevron}
                    </div>
                </div>
            </button>
            <div class="qe-drive-change-panel" hidden>
                <div class="qe-drive-change-meta">${prevRow}${nextRow}</div>
                ${diffShell}
            </div>
        </li>`;
    }).join('');

    const expandAllIcon = `<svg class="qe-drive-expandall-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.60"/><path d="M7 16l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `<div class="qe-drive-modal" data-qe-drive-changes="1">
        <div class="qe-drive-summary-row">
            <div class="qe-drive-summary">Wykryto <strong>${escapeHtml(safeList.length)}</strong> plik(ów) zmienionych od ostatniej synchronizacji.</div>
            <button class="qe-drive-expandall" type="button" aria-pressed="false" aria-label="Rozwiń wszystkie kafelki">${expandAllIcon}</button>
        </div>
        <div class="qe-drive-scroll-wrap">
            <div class="qe-drive-scroll" tabindex="0">
                <ul class="qe-drive-changes">${items}</ul>
            </div>
            <div class="qe-drive-scrollbar" aria-hidden="true">
                <div class="qe-drive-scrollbar-thumb"></div>
            </div>
        </div>
        <div class="qe-drive-question">Nadpisać zmienione pliki?</div>
    </div>`;
}

let qeDriveChangesModalState = null;

function qeBuildModalTitleHtml(title) {
    const safe = escapeHtml(String(title ?? ''));
    const hasDrive = safe.includes('Google Drive');
    const html = hasDrive ? safe.replaceAll('Google Drive', '<span class="qe-modal-gdrive">Google Drive</span>') : safe;
    return { html, hasDrive };
}

function qeTeardownDriveChangesModal() {
    if (!qeDriveChangesModalState) return;
    try { qeDriveChangesModalState.abortAll?.(); } catch { }
    qeDriveChangesModalState = null;
    try { modalOverlay?.classList.remove('modal-overlay--drive'); } catch { }
}

function qeInitDriveChangesModal({ files, token } = {}) {
    const api = window.GoogleDriveImport;
    const list = Array.isArray(files) ? files : [];
    const accessToken = String(token || '').trim();
    if (!modalOverlay || !api || !accessToken) return;
    const root = modalContent?.querySelector?.('.qe-drive-modal[data-qe-drive-changes="1"]');
    if (!root) return;

    qeTeardownDriveChangesModal();
    modalOverlay.classList.add('modal-overlay--drive');

    const fileByDomId = new Map();
    for (const f of list) {
        const id = String(f?.id || '').trim();
        const name = String(f?.name || '').trim();
        if (!id || !name) continue;
        fileByDomId.set(id, f);
    }

    const abortControllers = new Set();
    const diffCache = new Map();
    const inFlight = new WeakMap();
    let detachScrollbar = null;

    const abortAll = () => {
        try { detachScrollbar?.(); } catch { }
        for (const c of abortControllers) { try { c.abort(); } catch { } }
        abortControllers.clear();
    };

    qeDriveChangesModalState = { abortAll };

    const scrollEl = root.querySelector('.qe-drive-scroll');
    const scrollbarEl = root.querySelector('.qe-drive-scrollbar');
    const scrollbarThumb = root.querySelector('.qe-drive-scrollbar-thumb');
    detachScrollbar = (scrollEl && scrollbarEl && scrollbarThumb) ? qeAttachOverlayScrollbar(scrollEl, scrollbarEl, scrollbarThumb) : null;

    const expandAllBtn = root.querySelector('.qe-drive-expandall');
    const items = Array.from(root.querySelectorAll('.qe-drive-change'));
    for (const el of items) {
        const isNew = String(el?.dataset?.qeDriveIsNew || '') === '1';
        const diff = el.querySelector('.qe-drive-diff');
        if (!diff) continue;
        qeDriveDiffSetStatus(diff, isNew ? 'blocked' : 'idle');
        diff.dataset.qeDiffVisible = '0';
        const btn = diff.querySelector('.qe-drive-diff-btn');
        if (btn && !btn.disabled && btn.textContent !== 'Pokaż różnice') btn.textContent = 'Pokaż różnice';
    }

    const setPanelInteractivity = (panelEl, enabled) => {
        if (!panelEl) return;
        try {
            if ('inert' in panelEl) panelEl.inert = !enabled;
        } catch { }
        const focusables = panelEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
        for (const el of focusables) {
            if (!(el instanceof HTMLElement)) continue;
            const tag = String(el.tagName || '').toLowerCase();
            const isButton = tag === 'button';
            if (!enabled) {
                if (!el.dataset.qePrevTabindex) el.dataset.qePrevTabindex = String(el.getAttribute('tabindex') ?? '');
                el.setAttribute('tabindex', '-1');
                if (isButton) {
                    const btn = el;
                    if (!btn.dataset.qePrevDisabled) btn.dataset.qePrevDisabled = btn.disabled ? '1' : '0';
                    btn.disabled = true;
                }
            } else {
                const prev = el.dataset.qePrevTabindex;
                if (prev === '') el.removeAttribute('tabindex');
                else if (prev) el.setAttribute('tabindex', prev);
                else el.removeAttribute('tabindex');
                delete el.dataset.qePrevTabindex;
                if (isButton) {
                    const btn = el;
                    const wasDisabled = btn.dataset.qePrevDisabled === '1';
                    btn.disabled = wasDisabled;
                    delete btn.dataset.qePrevDisabled;
                }
            }
        }
    };

    const syncPanelHeight = (itemEl, expanded) => {
        const panel = itemEl?.querySelector?.('.qe-drive-change-panel');
        if (!panel) return;
        if (!expanded) {
            panel.style.setProperty('--qe-drive-panel-max', '0px');
            return;
        }
        const height = panel.scrollHeight;
        panel.style.setProperty('--qe-drive-panel-max', `${height}px`);
    };

    const setExpanded = (itemEl, expanded, { animate = true } = {}) => {
        const btn = itemEl?.querySelector?.('.qe-drive-change-toggle');
        const panel = itemEl?.querySelector?.('.qe-drive-change-panel');
        if (!btn || !panel) return;
        const wasExpanded = itemEl.classList.contains('is-expanded');
        const heightBefore = (!expanded && wasExpanded) ? panel.scrollHeight : 0;
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        itemEl.classList.toggle('is-expanded', expanded);
        if (!animate || prefersReducedMotion()) {
            panel.hidden = !expanded;
            panel.style.removeProperty('--qe-drive-panel-max');
            setPanelInteractivity(panel, expanded);
            if (expanded) syncPanelHeight(itemEl, true);
            return;
        }
        panel.hidden = false;
        if (expanded) {
            setPanelInteractivity(panel, true);
            panel.style.setProperty('--qe-drive-panel-max', '0px');
            window.requestAnimationFrame(() => {
                syncPanelHeight(itemEl, true);
                scrollEl?.dispatchEvent?.(new Event('scroll'));
            });
            return;
        }
        panel.style.setProperty('--qe-drive-panel-max', `${heightBefore}px`);
        void panel.offsetHeight;
        const onEnd = (e) => {
            if (e && e.propertyName !== 'max-height') return;
            panel.removeEventListener('transitionend', onEnd);
            if (!itemEl.classList.contains('is-expanded')) panel.hidden = true;
            setPanelInteractivity(panel, false);
            scrollEl?.dispatchEvent?.(new Event('scroll'));
        };
        panel.addEventListener('transitionend', onEnd);
        panel.style.setProperty('--qe-drive-panel-max', '0px');
    };

    const computeExpandedState = () => items.every((el) => el.classList.contains('is-expanded'));

    const updateExpandAllUi = () => {
        if (!expandAllBtn) return;
        const allExpanded = computeExpandedState();
        expandAllBtn.setAttribute('aria-pressed', allExpanded ? 'true' : 'false');
        expandAllBtn.setAttribute('aria-label', allExpanded ? 'Zwiń wszystkie kafelki' : 'Rozwiń wszystkie kafelki');
        expandAllBtn.classList.toggle('is-expanded', allExpanded);
    };

    updateExpandAllUi();

    expandAllBtn?.addEventListener?.('click', () => {
        const next = !computeExpandedState();
        for (const el of items) setExpanded(el, next, { animate: true });
        updateExpandAllUi();
        scrollEl?.dispatchEvent?.(new Event('scroll'));
    });

    root.addEventListener('click', async (ev) => {
        const toggle = ev.target?.closest?.('.qe-drive-change-toggle');
        if (toggle) {
            const item = toggle.closest('.qe-drive-change');
            const isExpanded = item?.classList?.contains('is-expanded');
            setExpanded(item, !isExpanded, { animate: true });
            updateExpandAllUi();
            scrollEl?.dispatchEvent?.(new Event('scroll'));
            return;
        }

        const diffBtn = ev.target?.closest?.('.qe-drive-diff-btn');
        if (!diffBtn) return;
        const itemEl = diffBtn.closest('.qe-drive-change');
        const isNewInDb = String(itemEl?.dataset?.qeDriveIsNew || '') === '1';
        const fileId = String(itemEl?.dataset?.qeDriveId || '').trim();
        const fileName = String(itemEl?.dataset?.qeDriveName || '').trim();
        const file = fileByDomId.get(fileId);
        if (!fileId || !fileName || !file) return;

        const diffContainer = itemEl.querySelector('.qe-drive-diff');
        if (!diffContainer) return;
        if (isNewInDb) {
            qeDriveDiffSetStatus(diffContainer, 'blocked');
            return;
        }

        const body = diffContainer.querySelector('.qe-drive-diff-body');
        const visible = String(diffContainer.dataset.qeDiffVisible || '0') === '1';
        if (visible) {
            const inflight = inFlight.get(diffContainer);
            if (diffContainer.dataset.qeDiffState === 'loading' && inflight) {
                try { inflight.abort(); } catch { }
            }
            if (body) body.hidden = true;
            diffContainer.dataset.qeDiffVisible = '0';
            if (!diffBtn.disabled) diffBtn.textContent = 'Pokaż różnice';
            if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
            scrollEl?.dispatchEvent?.(new Event('scroll'));
            return;
        }

        if (body) body.hidden = false;
        diffContainer.dataset.qeDiffVisible = '1';
        if (!diffBtn.disabled) diffBtn.textContent = 'Ukryj różnice';

        const cacheKey = `${fileId}:${String(file?.driveModifiedAt ?? '')}:${String(file?.previousDriveModifiedAt ?? '')}`;
        if (diffCache.has(cacheKey)) {
            qeDriveDiffApplyResult(diffContainer, diffCache.get(cacheKey));
            qeDriveDiffSetStatus(diffContainer, 'ready');
            if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
            return;
        }

        const abortController = new AbortController();
        abortControllers.add(abortController);
        inFlight.set(diffContainer, abortController);
        try {
            qeDriveDiffSetLoading(diffContainer, true);
            qeDriveDiffSetStatus(diffContainer, 'loading');
            const result = await qeComputeDriveFileDiff({
                api,
                token: accessToken,
                fileId,
                fileName,
                signal: abortController.signal
            });
            diffCache.set(cacheKey, result);
            qeDriveDiffApplyResult(diffContainer, result);
            qeDriveDiffSetStatus(diffContainer, 'ready');
            if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
        } catch (err) {
            if (err?.name === 'AbortError') return;
            qeDriveDiffSetError(diffContainer, err?.message ? String(err.message) : 'Błąd generowania różnic');
            qeDriveDiffSetStatus(diffContainer, 'error');
            if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
        } finally {
            abortControllers.delete(abortController);
            inFlight.delete(diffContainer);
            qeDriveDiffSetLoading(diffContainer, false);
            scrollEl?.dispatchEvent?.(new Event('scroll'));
        }
    }, { passive: true });
}

function qeDriveDiffSetLoading(container, loading) {
    const body = container.querySelector('.qe-drive-diff-body');
    const err = container.querySelector('.qe-drive-diff-error');
    if (body) body.hidden = false;
    if (err) err.hidden = true;
    if (loading) container.dataset.qeDiffState = 'loading';
    else if (container.dataset.qeDiffState === 'loading') container.dataset.qeDiffState = 'idle';
}

function qeDriveDiffSetStatus(container, status) {
    const s = String(status || '').trim();
    const spinnerWrap = container.querySelector('.qe-drive-diff-status-spinner');
    const checkWrap = container.querySelector('.qe-drive-diff-status-check');
    const xWrap = container.querySelector('.qe-drive-diff-status-x');
    if (spinnerWrap) spinnerWrap.hidden = !(s === 'loading' || s === 'idle');
    if (checkWrap) checkWrap.hidden = s !== 'ready';
    if (xWrap) xWrap.hidden = !(s === 'blocked' || s === 'error');
}

function qeDriveDiffSetError(container, message) {
    const body = container.querySelector('.qe-drive-diff-body');
    const err = container.querySelector('.qe-drive-diff-error');
    if (body) body.hidden = false;
    if (err) { err.hidden = false; err.textContent = String(message || 'Błąd'); }
    container.dataset.qeDiffState = 'error';
}

function qeDriveDiffApplyResult(container, result) {
    const body = container.querySelector('.qe-drive-diff-body');
    const err = container.querySelector('.qe-drive-diff-error');
    if (body) body.hidden = false;
    if (err) err.hidden = true;
    container.dataset.qeDiffState = 'ready';
    const unified = container.querySelector('.qe-drive-diff-view[data-qe-diff-view="unified"]');
    if (unified) setElementHtml(unified, qeRenderUnifiedRecordDiffHtml(result, { contextLines: 3 }));
    if (unified) unified.hidden = false;
}

async function qeComputeDriveFileDiff({ api, token, fileId, fileName, signal } = {}) {
    if (!api || !token || !fileId || !fileName) throw new Error('Brak danych do porównania');
    if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError');

    const oldBlob = await docsGetBlob(fileName);
    if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError');
    const newBuffer = await api.downloadFileArrayBuffer(fileId, token);
    if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError');

    const MAX_DIFF_BYTES = 1_800_000;
    const oldBytes = Number(oldBlob?.size || 0);
    const newBytes = Number(newBuffer?.byteLength || 0);
    if (!oldBlob) {
        return { truncated: false, oldCount: 0, newCount: 0, ops: [], note: 'Brak poprzedniej wersji pliku w bazie. Widok różnic jest niedostępny.' };
    }
    if (oldBytes > MAX_DIFF_BYTES || newBytes > MAX_DIFF_BYTES) {
        return { truncated: false, oldCount: 0, newCount: 0, ops: [], note: 'Plik jest zbyt duży, aby bezpiecznie wygenerować różnice w interfejsie (limit wydajności).' };
    }

    const [oldModel, newModel] = await Promise.all([
        qeParseTableModelFromSource(oldBlob, fileName),
        qeParseTableModelFromSource(newBuffer, fileName)
    ]);

    const old = qeTableModelToRecordList(oldModel);
    const next = qeTableModelToRecordList(newModel);
    const diff = qeComputeRecordDiff(old.records, next.records);
    const truncated = false;
    const noteParts = [];
    if (old.warnings.length > 0 || next.warnings.length > 0) {
        noteParts.push('Uwaga: wykryto nieprawidłowe lub zduplikowane ID w pierwszej kolumnie; diff może być mniej precyzyjny.');
    }
    return {
        truncated,
        oldCount: old.records.length,
        newCount: next.records.length,
        ops: diff.ops,
        note: noteParts.join(' ')
    };
}

function qeHashStringDjb2(input) {
    const s = String(input ?? '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return (h >>> 0).toString(36);
}

function qeTryNormalizeRecordId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();
    if (/^R\d{1,6}$/i.test(upper)) return upper;
    return null;
}

function qeExtractRecordIdFromRowCells(cells) {
    const row = Array.isArray(cells) ? cells : [];
    const first = qeTryNormalizeRecordId(row[0]);
    if (first) return { id: first, idIndex: 0, warning: null };
    for (let i = 0; i < row.length; i++) {
        const v = qeTryNormalizeRecordId(row[i]);
        if (v) return { id: v, idIndex: i, warning: 'ID nie znajduje się w pierwszej kolumnie.' };
    }
    return { id: null, idIndex: -1, warning: 'Brak ID w formacie Rxx.' };
}

function qeSelectRecordDataCells(model, rowCells, idIndex) {
    const cells = Array.isArray(rowCells) ? rowCells : [];
    const m = model && typeof model === 'object' ? model : null;
    if (m?.isCompleteStructure && m?.headerMap) {
        const h = m.headerMap;
        const indices = [h.NR_POL, h.GODZ, h.ADRES, h.NAZWA_PLACOWKI, h.UWAGI]
            .filter((v) => Number.isInteger(v) && v >= 0 && v !== idIndex);
        return indices.map((i) => String(cells[i] ?? '').trim());
    }
    const out = [];
    for (let i = 0; i < cells.length; i++) {
        if (i === idIndex) continue;
        out.push(String(cells[i] ?? '').trim());
    }
    return out;
}

function qeTableModelToRecordList(model) {
    const rows = Array.isArray(model?.rows) ? model.rows : [];
    const warnings = [];
    const records = [];
    for (const row of rows) {
        const cells = Array.isArray(row?.cells) ? row.cells : [];
        const { id, idIndex, warning } = qeExtractRecordIdFromRowCells(cells);
        if (warning) warnings.push(warning);
        const dataCells = qeSelectRecordDataCells(model, cells, idIndex);
        const stableId = id ?? `?${qeHashStringDjb2(`${dataCells.join('\u241F')}`)}`;
        records.push({
            id: stableId,
            dataCells,
            originalRowIndex: Number(row?.originalRowIndex ?? 0) || 0
        });
    }

    const seen = new Map();
    for (const r of records) {
        const base = String(r.id || '').trim();
        const next = (seen.get(base) ?? 0) + 1;
        seen.set(base, next);
        if (next > 1) {
            r.id = `${base}#${next}`;
            warnings.push('Zduplikowane ID w pliku.');
        }
    }
    return { records, warnings };
}

function qeComputeLcsIds(a, b) {
    const A = Array.isArray(a) ? a : [];
    const B = Array.isArray(b) ? b : [];
    const n = A.length;
    const m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = A[i] === B[j] ? (dp[i + 1][j + 1] + 1) : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const lcs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (A[i] === B[j]) {
            lcs.push(A[i]);
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    return lcs;
}

function qeDiffIdsUsingLcs(oldIds, newIds) {
    const A = Array.isArray(oldIds) ? oldIds : [];
    const B = Array.isArray(newIds) ? newIds : [];
    const lcs = qeComputeLcsIds(A, B);
    const ops = [];
    let i = 0, j = 0, k = 0;
    while (i < A.length || j < B.length) {
        const target = k < lcs.length ? lcs[k] : null;
        if (target !== null && i < A.length && j < B.length && A[i] === target && B[j] === target) {
            ops.push({ t: 'eq', id: target });
            i++; j++; k++;
            continue;
        }
        if (i < A.length && (target === null || A[i] !== target)) {
            ops.push({ t: 'del', id: A[i] });
            i++;
            continue;
        }
        if (j < B.length && (target === null || B[j] !== target)) {
            ops.push({ t: 'ins', id: B[j] });
            j++;
            continue;
        }
        if (i < A.length) { ops.push({ t: 'del', id: A[i] }); i++; continue; }
        if (j < B.length) { ops.push({ t: 'ins', id: B[j] }); j++; continue; }
    }
    return ops;
}

function qeComputeChangedCellIndices(oldCells, newCells) {
    const A = Array.isArray(oldCells) ? oldCells : [];
    const B = Array.isArray(newCells) ? newCells : [];
    const max = Math.max(A.length, B.length);
    const changed = [];
    for (let i = 0; i < max; i++) {
        const a = String(A[i] ?? '').trim();
        const b = String(B[i] ?? '').trim();
        if (a !== b) changed.push(i);
    }
    return changed;
}

function qeComputeRecordDiff(oldRecords, newRecords) {
    const oldList = Array.isArray(oldRecords) ? oldRecords : [];
    const newList = Array.isArray(newRecords) ? newRecords : [];
    const oldById = new Map(oldList.map((r) => [String(r?.id ?? ''), r]));
    const newById = new Map(newList.map((r) => [String(r?.id ?? ''), r]));
    const oldIds = oldList.map((r) => String(r?.id ?? ''));
    const newIds = newList.map((r) => String(r?.id ?? ''));

    const baseOps = qeDiffIdsUsingLcs(oldIds, newIds);
    const ops = [];
    for (const op of baseOps) {
        if (!op) continue;
        if (op.t === 'eq') {
            const id = String(op.id ?? '');
            const a = oldById.get(id);
            const b = newById.get(id);
            const oldCells = a?.dataCells ?? [];
            const newCells = b?.dataCells ?? [];
            const changedIdxs = qeComputeChangedCellIndices(oldCells, newCells);
            if (changedIdxs.length > 0) {
                ops.push({ t: 'del', id, rec: a, peerRec: b, changedIdxs });
                ops.push({ t: 'ins', id, rec: b, peerRec: a, changedIdxs });
            } else {
                ops.push({ t: 'eq', id, rec: a });
            }
        } else if (op.t === 'del') {
            const id = String(op.id ?? '');
            const oldRec = oldById.get(id) ?? null;
            const newRec = newById.get(id) ?? null;
            if (oldRec && newRec) {
                const changedIdxs = qeComputeChangedCellIndices(oldRec?.dataCells ?? [], newRec?.dataCells ?? []);
                ops.push({ t: 'del', id, rec: oldRec, peerRec: newRec, changedIdxs });
            } else {
                ops.push({ t: 'del', id, rec: oldRec });
            }
        } else if (op.t === 'ins') {
            const id = String(op.id ?? '');
            const newRec = newById.get(id) ?? null;
            const oldRec = oldById.get(id) ?? null;
            if (oldRec && newRec) {
                const changedIdxs = qeComputeChangedCellIndices(oldRec?.dataCells ?? [], newRec?.dataCells ?? []);
                ops.push({ t: 'ins', id, rec: newRec, peerRec: oldRec, changedIdxs });
            } else {
                ops.push({ t: 'ins', id, rec: newRec });
            }
        }
    }
    return { ops };
}

function qeComputeUnifiedColumnWidths(ops, segments) {
    const list = Array.isArray(ops) ? ops : [];
    const segs = Array.isArray(segments) ? segments : [];
    const widths = [];

    for (const seg of segs) {
        const start = Math.max(0, Number(seg?.start ?? 0) || 0);
        const end = Math.min(list.length - 1, Number(seg?.end ?? -1) || -1);
        for (let i = start; i <= end; i++) {
            const op = list[i];
            const rec = op?.rec && typeof op.rec === 'object' ? op.rec : null;
            const dataCells = Array.isArray(rec?.dataCells) ? rec.dataCells : [];
            if (dataCells.length > widths.length) widths.length = dataCells.length;
            for (let c = 0; c < dataCells.length; c++) {
                const len = String(dataCells[c] ?? '').trim().length;
                widths[c] = Math.max(Number(widths[c] ?? 0), len);
            }
        }
    }

    for (let i = 0; i < widths.length; i++) widths[i] = Math.max(1, Number(widths[i] ?? 1) || 1);
    return widths;
}

function qeRenderRecordLineHtml(op, colWidths) {
    const t = String(op?.t || '');
    const rec = op?.rec && typeof op.rec === 'object' ? op.rec : null;
    const peerRec = op?.peerRec && typeof op.peerRec === 'object' ? op.peerRec : null;
    const dataCells = Array.isArray(rec?.dataCells) ? rec.dataCells : [];
    const peerCells = Array.isArray(peerRec?.dataCells) ? peerRec.dataCells : [];
    const changedIdxs = Array.isArray(op?.changedIdxs) ? op.changedIdxs : [];
    const changedSet = new Set(changedIdxs.map((n) => Number(n)));

    const cellsHtml = [];
    const widths = Array.isArray(colWidths) ? colWidths : [];
    const colCount = Math.max(widths.length, dataCells.length, peerCells.length);
    for (let i = 0; i < colCount; i++) {
        const raw = String(dataCells[i] ?? '').trim();
        const peer = String(peerCells[i] ?? '').trim();
        const v = escapeHtml(raw);
        const w = Math.max(1, Number(widths[i] ?? 1) || 1);
        let cellCls = 'qe-drive-diff-cell';
        if ((t === 'del' || t === 'ins') && changedSet.has(i)) {
            const isEmpty = raw.length === 0;
            const isPeerEmpty = peer.length === 0;
            if (t === 'ins') {
                if (!isEmpty && isPeerEmpty) cellCls += ' is-changed is-cell-add';
                else if (!isEmpty && !isPeerEmpty) cellCls += ' is-changed is-cell-add';
            } else if (t === 'del') {
                if (!isEmpty && isPeerEmpty) cellCls += ' is-changed is-cell-del';
                else if (!isEmpty && !isPeerEmpty) cellCls += ' is-changed is-cell-del';
            }
        }
        cellsHtml.push(`<span class="${cellCls}" style="min-width:${w}ch;display:inline-block;">${v || '&nbsp;'}</span>`);
        if (i < colCount - 1) cellsHtml.push(`<span class="qe-drive-diff-u-sep"> | </span>`);
    }
    const isCellLevel = (t === 'ins' || t === 'del') && changedIdxs.length > 0;
    const prefix = isCellLevel ? '&nbsp;' : (t === 'ins' ? '+' : (t === 'del' ? '-' : '&nbsp;'));
    const cls = isCellLevel ? 'is-eq' : (t === 'ins' ? 'is-ins' : (t === 'del' ? 'is-del' : 'is-eq'));
    return `<div class="qe-drive-diff-u-row ${cls}"><div class="qe-drive-diff-u-prefix" aria-hidden="true">${prefix}</div><div class="qe-drive-diff-u-cells">${cellsHtml.join('')}</div></div>`;
}

function qeRenderRecordModificationLineHtml(delOp, insOp, colWidths) {
    const oldRec = delOp?.rec && typeof delOp.rec === 'object' ? delOp.rec : null;
    const newRec = insOp?.rec && typeof insOp.rec === 'object' ? insOp.rec : null;
    const oldCells = Array.isArray(oldRec?.dataCells) ? oldRec.dataCells : [];
    const newCells = Array.isArray(newRec?.dataCells) ? newRec.dataCells : [];
    const widths = Array.isArray(colWidths) ? colWidths : [];
    const colCount = Math.max(widths.length, oldCells.length, newCells.length);
    const cellsHtml = [];

    for (let i = 0; i < colCount; i++) {
        const rawOld = String(oldCells[i] ?? '').trim();
        const rawNew = String(newCells[i] ?? '').trim();
        const w = Math.max(1, Number(widths[i] ?? 1) || 1);

        if (rawOld === rawNew) {
            const v = escapeHtml(rawNew);
            cellsHtml.push(`<span class="qe-drive-diff-cell" style="min-width:${w}ch;display:inline-block;">${v || '&nbsp;'}</span>`);
        } else {
            const oldEmpty = rawOld.length === 0;
            const newEmpty = rawNew.length === 0;
            if (oldEmpty && !newEmpty) {
                const vNew = escapeHtml(rawNew);
                cellsHtml.push(`<span class="qe-drive-diff-cell is-changed is-cell-add" style="min-width:${w}ch;display:inline-block;">${vNew || '&nbsp;'}</span>`);
            } else if (!oldEmpty && newEmpty) {
                const vOld = escapeHtml(rawOld);
                cellsHtml.push(`<span class="qe-drive-diff-cell is-changed is-cell-del" style="min-width:${w}ch;display:inline-block;">${vOld || '&nbsp;'}</span>`);
            } else {
                const vOld = escapeHtml(rawOld);
                const vNew = escapeHtml(rawNew);
                cellsHtml.push(
                    `<span class="qe-drive-diff-cell is-cell-mod" style="min-width:${w}ch;display:inline-block;">` +
                    `<span class="qe-drive-diff-cell-delta is-old is-changed">${vOld || '&nbsp;'}</span>` +
                    `<span class="qe-drive-diff-cell-arrow" aria-hidden="true">→</span>` +
                    `<span class="qe-drive-diff-cell-delta is-new is-changed">${vNew || '&nbsp;'}</span>` +
                    `</span>`
                );
            }
        }

        if (i < colCount - 1) cellsHtml.push(`<span class="qe-drive-diff-u-sep"> | </span>`);
    }

    return `<div class="qe-drive-diff-u-row is-eq"><div class="qe-drive-diff-u-prefix" aria-hidden="true">&nbsp;</div><div class="qe-drive-diff-u-cells">${cellsHtml.join('')}</div></div>`;
}

function qeRenderUnifiedRecordDiffHtml(result, { contextLines } = {}) {
    const ops = Array.isArray(result?.ops) ? result.ops : [];
    const note = String(result?.note || '').trim();
    const ctx = Math.max(0, Math.min(999, Number(contextLines) || 0));
    const segments = ctx >= 999 ? (ops.length > 0 ? [{ start: 0, end: ops.length - 1 }] : []) : qeComputeDiffContextSegments(ops, { contextLines: ctx });
    const widths = qeComputeUnifiedColumnWidths(ops, segments);
    const rows = [];
    if (note) rows.push(`<div class="qe-drive-diff-note">${escapeHtml(note)}</div>`);
    rows.push('<div class="qe-drive-diff-unified"><div class="qe-drive-diff-unified-scroll"><div class="qe-drive-diff-unified-body">');
    if (segments.length === 0) {
        rows.push('<div class="qe-drive-diff-u-empty">Brak różnic</div>');
    } else {
        let lastEnd = -1;
        for (const seg of segments) {
            if (lastEnd >= 0 && seg.start > lastEnd + 1) rows.push('<div class="qe-drive-diff-u-gap">…</div>');
            for (let i = seg.start; i <= seg.end; i++) {
                const op = ops[i];
                const next = i + 1 <= seg.end ? ops[i + 1] : null;
                const isDelMod = op?.t === 'del' && Array.isArray(op?.changedIdxs) && op.changedIdxs.length > 0;
                const isInsMod = next?.t === 'ins' && Array.isArray(next?.changedIdxs) && next.changedIdxs.length > 0;
                const sameId = String(op?.id ?? '') && String(op?.id ?? '') === String(next?.id ?? '');
                if (isDelMod && isInsMod && sameId) {
                    rows.push(qeRenderRecordModificationLineHtml(op, next, widths));
                    i += 1;
                    continue;
                }
                rows.push(qeRenderRecordLineHtml(op, widths));
            }
            lastEnd = seg.end;
        }
    }
    rows.push('</div></div></div>');
    return rows.join('\n');
}

async function qeParseTableModelFromSource(source, fileName) {
    const workbook = await readWorkbook(source, fileName);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true, defval: '' });
    return buildTableModel(matrix);
}

function qeTableModelToDiffLines(model, { maxLines } = {}) {
    if (!model || !Array.isArray(model.rows)) return { lines: [], clipped: false, totalLines: 0 };
    const limit = Number.isFinite(Number(maxLines)) && Number(maxLines) > 0 ? Number(maxLines) : Infinity;
    const lines = [];
    let clipped = false;
    const metaCount = Array.isArray(model.metaLines) ? model.metaLines.length : 0;
    if (Array.isArray(model.metaLines) && model.metaLines.length > 0) {
        for (const m of model.metaLines) {
            if (lines.length >= limit) { clipped = true; break; }
            lines.push(`META | ${String(m ?? '').trim()}`);
        }
    }
    if (model.isCompleteStructure && model.headerMap) {
        const totalLines = metaCount + 1 + model.rows.length;
        if (lines.length < limit) lines.push('DANE | NR_PÓŁ | GODZ | ADRES | NAZWA PLACÓWKI | UWAGI');
        else clipped = true;
        const h = model.headerMap;
        for (const row of model.rows) {
            if (lines.length >= limit) { clipped = true; break; }
            const cells = Array.isArray(row?.cells) ? row.cells : [];
            const nr = String(cells[h.NR_POL] ?? '').trim();
            const godz = String(cells[h.GODZ] ?? '').trim();
            const adres = String(cells[h.ADRES] ?? '').trim();
            const nazwa = String(cells[h.NAZWA_PLACOWKI] ?? '').trim();
            const uwagi = String(cells[h.UWAGI] ?? '').trim();
            const key = `R${Number(row?.originalRowIndex ?? 0) || 0}`.padEnd(6, ' ');
            lines.push(`${key} | ${nr} | ${godz} | ${adres} | ${nazwa} | ${uwagi}`);
        }
        return { lines, clipped, totalLines };
    }
    const totalLines = metaCount + 1 + model.rows.length;
    if (lines.length < limit) lines.push('DANE | (struktura niepełna)'); 
    else clipped = true;
    for (const row of model.rows) {
        if (lines.length >= limit) { clipped = true; break; }
        const cells = Array.isArray(row?.cells) ? row.cells : [];
        const content = cells.filter(c => !isEmptyCell(c)).map(c => String(c ?? '').trim()).filter(Boolean).join(' | ');
        const key = `R${Number(row?.originalRowIndex ?? 0) || 0}`.padEnd(6, ' ');
        lines.push(`${key} | ${content}`);
    }
    return { lines, clipped, totalLines };
}

function qeComputeLineDiff(a, b) {
    const A = Array.isArray(a) ? a : [];
    const B = Array.isArray(b) ? b : [];
    const N = A.length;
    const M = B.length;
    const max = N + M;
    const v = new Map();
    v.set(1, 0);
    const trace = [];

    for (let d = 0; d <= max; d++) {
        const snapshot = new Map();
        for (const [k, x] of v.entries()) snapshot.set(k, x);
        trace.push(snapshot);

        for (let k = -d; k <= d; k += 2) {
            const kPlus = k + 1;
            const kMinus = k - 1;
            let x;
            if (k === -d || (k !== d && (v.get(kMinus) ?? -Infinity) < (v.get(kPlus) ?? -Infinity))) {
                x = v.get(kPlus) ?? 0;
            } else {
                x = (v.get(kMinus) ?? 0) + 1;
            }
            let y = x - k;
            while (x < N && y < M && A[x] === B[y]) { x++; y++; }
            v.set(k, x);
            if (x >= N && y >= M) return qeBacktrackMyers(A, B, trace);
        }
    }
    return qeBacktrackMyers(A, B, trace);
}

function qeBacktrackMyers(A, B, trace) {
    let x = A.length;
    let y = B.length;
    const ops = [];

    for (let d = trace.length - 1; d >= 0; d--) {
        const v = trace[d];
        const k = x - y;
        const kPlus = k + 1;
        const kMinus = k - 1;
        let prevK;
        if (k === -d || (k !== d && (v.get(kMinus) ?? -Infinity) < (v.get(kPlus) ?? -Infinity))) {
            prevK = kPlus;
        } else {
            prevK = kMinus;
        }
        const prevX = v.get(prevK) ?? 0;
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
            ops.push({ t: 'eq', a: A[x - 1], b: B[y - 1] });
            x--; y--;
        }
        if (d === 0) break;
        if (x === prevX) {
            ops.push({ t: 'ins', b: B[y - 1] });
            y--;
        } else {
            ops.push({ t: 'del', a: A[x - 1] });
            x--;
        }
    }

    ops.reverse();
    return ops;
}

function qeComputeDiffContextSegments(ops, { contextLines } = {}) {
    const list = Array.isArray(ops) ? ops : [];
    const ctx = Math.max(0, Math.min(10, Number(contextLines) || 0));
    if (list.length === 0) return [];
    const segments = [];
    for (let i = 0; i < list.length; i++) {
        if (list[i]?.t === 'eq') continue;
        let start = Math.max(0, i - ctx);
        let end = Math.min(list.length - 1, i + ctx);
        let j = i;
        while (j <= end && j < list.length) {
            if (list[j]?.t !== 'eq') end = Math.min(list.length - 1, j + ctx);
            j += 1;
        }
        if (segments.length > 0) {
            const last = segments[segments.length - 1];
            if (start <= last.end + 1) {
                last.end = Math.max(last.end, end);
            } else {
                segments.push({ start, end });
            }
        } else {
            segments.push({ start, end });
        }
        i = end;
    }
    return segments;
}

function qeRenderSideBySideDiffHtml(result, { contextLines } = {}) {
    const ops = Array.isArray(result?.ops) ? result.ops : [];
    const note = String(result?.note || '').trim();
    const segments = qeComputeDiffContextSegments(ops, { contextLines: Number(contextLines) || 2 });
    const rows = [];
    if (note) rows.push(`<div class="qe-drive-diff-note">${escapeHtml(note)}</div>`);
    rows.push('<div class="qe-drive-diff-sbs"><div class="qe-drive-diff-sbs-head"><div class="qe-drive-diff-sbs-col">Poprzednio</div><div class="qe-drive-diff-sbs-col">Na Dysku</div></div><div class="qe-drive-diff-sbs-body">');
    if (segments.length === 0) {
        rows.push(`<div class="qe-drive-diff-sbs-row is-eq"><div class="qe-drive-diff-sbs-cell is-empty">Brak różnic</div><div class="qe-drive-diff-sbs-cell is-empty">Brak różnic</div></div>`);
    } else {
        let lastEnd = -1;
        for (const seg of segments) {
            if (lastEnd >= 0 && seg.start > lastEnd + 1) {
                rows.push(`<div class="qe-drive-diff-sbs-row is-gap"><div class="qe-drive-diff-sbs-cell is-empty">…</div><div class="qe-drive-diff-sbs-cell is-empty">…</div></div>`);
            }
            for (let i = seg.start; i <= seg.end; i++) {
                const op = ops[i];
                if (!op) continue;
                if (op.t === 'eq') {
                    const line = escapeHtml(op.a);
                    rows.push(`<div class="qe-drive-diff-sbs-row is-eq"><div class="qe-drive-diff-sbs-cell">${line}</div><div class="qe-drive-diff-sbs-cell">${line}</div></div>`);
                } else if (op.t === 'del') {
                    rows.push(`<div class="qe-drive-diff-sbs-row is-del"><div class="qe-drive-diff-sbs-cell">${escapeHtml(op.a)}</div><div class="qe-drive-diff-sbs-cell is-empty"></div></div>`);
                } else if (op.t === 'ins') {
                    rows.push(`<div class="qe-drive-diff-sbs-row is-ins"><div class="qe-drive-diff-sbs-cell is-empty"></div><div class="qe-drive-diff-sbs-cell">${escapeHtml(op.b)}</div></div>`);
                }
            }
            lastEnd = seg.end;
        }
    }
    rows.push('</div></div>');
    return rows.join('\n');
}

function qeAttachOverlayScrollbar(scrollEl, trackEl, thumbEl) {
    let raf = 0;
    let hideTimer = 0;
    let dragging = false;
    let dragStartY = 0;
    let dragStartScrollTop = 0;

    const show = () => {
        trackEl.classList.add('is-visible');
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => trackEl.classList.remove('is-visible'), 1100);
    };

    const update = () => {
        raf = 0;
        const height = scrollEl.clientHeight;
        const total = scrollEl.scrollHeight;
        const canScroll = total > height + 1;
        trackEl.hidden = !canScroll;
        if (!canScroll) return;

        const ratio = height / total;
        const thumbMin = 36;
        const thumbH = Math.max(thumbMin, Math.round(height * ratio));
        const maxThumbTop = Math.max(1, height - thumbH);
        const maxScrollTop = Math.max(1, total - height);
        const thumbTop = Math.round((scrollEl.scrollTop / maxScrollTop) * maxThumbTop);

        thumbEl.style.height = `${thumbH}px`;
        thumbEl.style.transform = `translateY(${thumbTop}px)`;
    };

    const schedule = () => {
        if (raf) return;
        raf = window.requestAnimationFrame(update);
    };

    const onScroll = () => { show(); schedule(); };

    const onPointerDownThumb = (e) => {
        dragging = true;
        dragStartY = e.clientY;
        dragStartScrollTop = scrollEl.scrollTop;
        thumbEl.setPointerCapture?.(e.pointerId);
        show();
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const height = scrollEl.clientHeight;
        const total = scrollEl.scrollHeight;
        const ratio = height / total;
        const thumbMin = 36;
        const thumbH = Math.max(thumbMin, Math.round(height * ratio));
        const maxThumbTop = Math.max(1, height - thumbH);
        const maxScrollTop = Math.max(1, total - height);
        const deltaY = e.clientY - dragStartY;
        const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop;
        scrollEl.scrollTop = dragStartScrollTop + scrollDelta;
        show();
        schedule();
    };

    const onPointerUp = (e) => {
        if (!dragging) return;
        dragging = false;
        try { thumbEl.releasePointerCapture?.(e.pointerId); } catch { }
        show();
    };

    const onTrackPointerDown = (e) => {
        if (e.target === thumbEl) return;
        const rect = trackEl.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = scrollEl.clientHeight;
        const total = scrollEl.scrollHeight;
        const ratio = height / total;
        const thumbMin = 36;
        const thumbH = Math.max(thumbMin, Math.round(height * ratio));
        const maxThumbTop = Math.max(1, height - thumbH);
        const maxScrollTop = Math.max(1, total - height);
        const targetThumbTop = Math.max(0, Math.min(maxThumbTop, y - (thumbH / 2)));
        scrollEl.scrollTop = (targetThumbTop / maxThumbTop) * maxScrollTop;
        show();
        schedule();
    };

    const ro = new ResizeObserver(() => schedule());
    ro.observe(scrollEl);

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    scrollEl.addEventListener('pointerenter', show, { passive: true });
    scrollEl.addEventListener('pointermove', show, { passive: true });
    trackEl.addEventListener('pointerenter', show, { passive: true });
    trackEl.addEventListener('pointermove', show, { passive: true });
    thumbEl.addEventListener('pointerdown', onPointerDownThumb);
    trackEl.addEventListener('pointerdown', onTrackPointerDown);
    const onTrackWheel = (e) => {
        scrollEl.scrollTop += e.deltaY;
        show();
        schedule();
        e.preventDefault();
    };
    trackEl.addEventListener('wheel', onTrackWheel, { passive: false });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    schedule();
    return () => {
        try { if (raf) window.cancelAnimationFrame(raf); } catch { }
        try { if (hideTimer) window.clearTimeout(hideTimer); } catch { }
        try { ro.disconnect(); } catch { }
        try { scrollEl.removeEventListener('scroll', onScroll); } catch { }
        try { scrollEl.removeEventListener('pointerenter', show); } catch { }
        try { scrollEl.removeEventListener('pointermove', show); } catch { }
        try { thumbEl.removeEventListener('pointerdown', onPointerDownThumb); } catch { }
        try { trackEl.removeEventListener('pointerdown', onTrackPointerDown); } catch { }
        try { trackEl.removeEventListener('wheel', onTrackWheel); } catch { }
        try { trackEl.removeEventListener('pointerenter', show); } catch { }
        try { trackEl.removeEventListener('pointermove', show); } catch { }
        try { window.removeEventListener('pointermove', onPointerMove); } catch { }
        try { window.removeEventListener('pointerup', onPointerUp); } catch { }
    };
}

function buildDriveConnectingModalHtml(stageText) {
    const stage = escapeHtml(String(stageText || '').trim() || 'Łączenie z Google Drive...');
    return `<div class="qe-drive-connecting"><div class="qe-spinner" aria-hidden="true"></div><div class="qe-drive-connecting-title">${stage}</div><div class="qe-drive-connecting-sub">To może potrwać kilka sekund. Nie zamykaj aplikacji.</div><div class="qe-indeterminate" aria-hidden="true"><div class="qe-indeterminate-bar"></div></div></div>`;
}

function buildDriveNoChangesModalHtml() {
    return `<div class="qe-drive-modal qe-drive-modal--ok"><div class="qe-drive-summary"><strong>Dane aktualne.</strong> Nie wykryto zmian w folderze Google Drive od ostatniej synchronizacji.</div></div>`;
}

/**
 * Rozpoczyna synchronizację z Google Drive dla wskazanego folderu.
 */
async function startGoogleDriveSync(files, token, { source } = {}) {
    const api = window.GoogleDriveImport;
    const list = Array.isArray(files) ? files : [];
    if (!api) throw new Error('Moduł Google Drive jest niedostępny');
    if (list.length === 0) return;

    googleDriveSyncIsImporting = true;
    setGoogleDriveSyncButtonsBusy(true);
    logAction('sync', { phase: 'process', count: list.length, source: source || 'unknown' });

    const isWelcomeVisible = Boolean(loadingOverlay && !loadingOverlay.classList.contains('hidden'));
    if (isWelcomeVisible && welcomeImportProgress) {
        welcomeImportProgress.classList.remove('hidden');
        clearElement(welcomeProgressList);
    }

    uploadProgressContainer?.classList.remove('hidden');
    if (uploadProgress) uploadProgress.value = 0;
    setUploadStatusText(`Google Drive: synchronizacja ${list.length} plik(ów)...`, { animate: false });

    const summary = { files: [], records: 0, errors: 0 };
    const before = allData.length;

    try {
        let processed = 0;
        for (const file of list) {
            const name = String(file?.name || '').trim();
            const id = String(file?.id || '').trim();
            if (!name || !id) continue;

            const progressItem = isWelcomeVisible ? createWelcomeProgressItem(name) : null;
            if (progressItem && welcomeProgressList) {
                welcomeProgressList.appendChild(progressItem);
                progressItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            const displayName = formatFileName(name);
            setLoadingStatusText(`Pobieranie: ${displayName}...`);
            setUploadStatusText(`Google Drive: pobieram ${displayName}...`);

            const percent = list.length > 0 ? (processed / list.length) * 100 : 0;
            if (loadingProgressBar) {
                loadingProgressBar.value = percent;
                if (loadingProgressMeta) loadingProgressMeta.textContent = `${Math.round(percent)}%`;
            }
            if (uploadProgress) uploadProgress.value = Math.max(0, Math.min(95, percent));

            try {
                const buffer = await api.downloadFileArrayBuffer(id, token);
                if (Number(buffer?.byteLength || 0) > MAX_IMPORT_BYTES) throw new Error('Plik przekracza limit 5MB');
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                await docsPutBlob(name, blob, { driveModifiedAt: file?.driveModifiedAt ?? null });
                removeFileData(name);
                if (isScheduleFileName(name)) {
                    loadedScheduleFiles.delete(name);
                    await processScheduleFile(name);
                } else {
                    loadedFiles.delete(name);
                    await processFile(name);
                    loadedFiles.add(name);
                }
                summary.files.push(name);
                if (progressItem) updateWelcomeProgressItem(progressItem, 100, 'Gotowe');
            } catch (err) {
                summary.errors += 1;
                logAction('sync', { fileName: name, message: err?.message ? String(err.message) : 'Błąd' }, 'ERROR');
                if (progressItem) updateWelcomeProgressItem(progressItem, 0, 'Błąd', true);
            } finally {
                processed += 1;
                const nextPercent = list.length > 0 ? (processed / list.length) * 100 : 100;
                if (loadingProgressBar) {
                    loadingProgressBar.value = nextPercent;
                    if (loadingProgressMeta) loadingProgressMeta.textContent = `${Math.round(nextPercent)}%`;
                }
                if (uploadProgress) uploadProgress.value = Math.round(nextPercent);
            }
        }

        finalizeFileImport(summary, before);
        setLoadingStatusText('Synchronizacja zakończona');
        setUploadStatusText('Google Drive: synchronizacja zakończona.');
        if (loadingProgressBar) {
            loadingProgressBar.value = 100;
            if (loadingProgressMeta) loadingProgressMeta.textContent = '100%';
        }
    } catch (err) {
        const msg = err?.message ? String(err.message) : 'Błąd synchronizacji';
        logAction('sync', { phase: 'fatal_error', message: msg }, 'ERROR');
        setLoadingStatusText('Błąd synchronizacji');
        setUploadStatusText(`Google Drive: ${msg}`);
        showModal('Błąd synchronizacji', `Wystąpił błąd podczas synchronizacji z Google Drive: ${escapeHtml(msg)}`, [
            { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
        ]);
    } finally {
        window.setTimeout(() => uploadProgressContainer?.classList.add('hidden'), 900);
        setGoogleDriveSyncButtonsBusy(false);
        googleDriveSyncIsImporting = false;
    }
}

/**
 * Obsługuje synchronizację z Google Drive (folder stały).
 */
async function handleGoogleDriveSync({ source } = {}) {
    const FOLDER_ID = '1tyClIJEDwntOrYCMVYmyR5nR6LNHmN-x';
    const api = window.GoogleDriveImport;
    if (!api) {
        showModal('Google Drive', 'Synchronizacja jest niedostępna (brak modułu Google Drive).');
        return;
    }

    if (googleDriveSyncIsImporting) {
        showModal('Google Drive', 'Trwa synchronizacja plików. Poczekaj na zakończenie bieżącej operacji.');
        return;
    }

    if (googleDriveConnectSession && !googleDriveConnectSession.cancelled) {
        showModal('Google Drive', buildDriveConnectingModalHtml('Łączenie z Google Drive...'), [
            { label: 'Anuluj', onClick: () => { try { googleDriveConnectSession.cancel(); } catch { } } }
        ]);
        return;
    }

    const sessionId = ++googleDriveConnectSeq;
    const abortController = new AbortController();
    const session = {
        id: sessionId,
        cancelled: false,
        abortController,
        cancel: () => {
            if (session.cancelled) return;
            session.cancelled = true;
            try { abortController.abort(); } catch { }
            if (googleDriveConnectSession && googleDriveConnectSession.id === sessionId) googleDriveConnectSession = null;
            logAction('sync', { phase: 'cancelled', source: source || 'unknown' }, 'INFO');
        }
    };
    googleDriveConnectSession = session;

    logAction('sync', { phase: 'start', folderId: FOLDER_ID, source: source || 'unknown' });
    try {
        showModal('Google Drive', buildDriveConnectingModalHtml('Łączenie z Google Drive...'), [
            { label: 'Anuluj', onClick: () => session.cancel() }
        ]);
        setLoadingStatusText('Łączenie z Google Drive...');
        const token = await api.getAccessToken();
        if (session.cancelled) return;

        showModal('Google Drive', buildDriveConnectingModalHtml('Przeszukiwanie folderu na Google Drive...'), [
            { label: 'Anuluj', onClick: () => session.cancel() }
        ]);
        setLoadingStatusText('Przeszukiwanie folderów...');
        const files = await api.crawlFolder(FOLDER_ID, token, { signal: abortController.signal });
        if (session.cancelled) return;

        if (files.length === 0) {
            showModal('Google Drive', 'Nie znaleziono żadnych plików .xlsx/.xls w wskazanym folderze Google Drive.', [
                { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
            ]);
            return;
        }

        const existing = await docsListFiles();
        if (existing.length === 0) {
            hideModal();
            await startGoogleDriveSync(files, token, { source: source || 'unknown' });
            return;
        }

        showModal('Google Drive', buildDriveConnectingModalHtml('Analiza zmian...'), [
            { label: 'Anuluj', onClick: () => session.cancel() }
        ]);

        const changed = [];
        await runWithConcurrency(files, 8, async (file) => {
            const name = String(file?.name || '').trim();
            if (!name) return;

            const record = await docsGetFileRecord(name);
            if (!record) {
                changed.push({ ...file, changeReason: 'Nowy plik', previousDriveModifiedAt: null, isNewInDb: true });
                return;
            }

            const prev = Number(record?.driveModifiedAt);
            const next = Number(file?.driveModifiedAt);

            if (!Number.isFinite(prev) || prev <= 0) {
                changed.push({ ...file, changeReason: 'Brak zapisanej daty poprzedniej synchronizacji', previousDriveModifiedAt: null, isNewInDb: false });
                return;
            }
            if (!Number.isFinite(next) || next <= 0) {
                changed.push({ ...file, changeReason: 'Brak daty modyfikacji z Google Drive', previousDriveModifiedAt: prev, isNewInDb: false });
                return;
            }
            if (next > prev) {
                changed.push({ ...file, changeReason: 'Nowsza wersja na Google Drive', previousDriveModifiedAt: prev, isNewInDb: false });
            }
        });

        changed.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'pl', { sensitivity: 'base' }));

        if (changed.length === 0) {
            setLoadingStatusText('Dane aktualne.');
            statusIndicator.textContent = 'Dane aktualne.';
            showModal('Google Drive', buildDriveNoChangesModalHtml(), [
                { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
            ]);
            return;
        }

        showModal('Synchronizacja Google Drive', buildDriveChangesModalHtml(changed), [
            { label: 'Nadpisz zmienione', class: 'modal-btn--primary', onClick: () => startGoogleDriveSync(changed, token, { source: source || 'unknown' }) },
            { label: 'Anuluj', onClick: () => { logAction('sync', { phase: 'cancelled', source: source || 'unknown' }); } }
        ]);
        qeInitDriveChangesModal({ files: changed, token });
    } catch (err) {
        if (session.cancelled || err?.name === 'AbortError') return;
        const msg = err?.message ? String(err.message) : 'Błąd synchronizacji';
        logAction('sync', { phase: 'error', message: msg }, 'ERROR');
        showModal('Błąd synchronizacji', `Wystąpił błąd podczas łączenia z Google Drive: ${escapeHtml(msg)}`, [
            { label: 'OK', class: 'modal-btn--primary', onClick: () => { } }
        ]);
    } finally {
        if (googleDriveConnectSession && googleDriveConnectSession.id === sessionId) googleDriveConnectSession = null;
    }
}

//////////////////////////////////////////////////
// GŁÓWNA LOGIKA PRZETWARZANIA DANYCH
//////////////////////////////////////////////////

/**
 * Buduje model tabeli z surowej macierzy danych.
 */
function buildTableModel(matrix) {
    const rect = normalizeMatrix(matrix);
    const bounds = computeNonEmptyBounds(rect);
    if (!bounds) return { headers: [], rows: [], metaLines: [], isCompleteStructure: false };
    const cropped = rect.slice(bounds.minRow, bounds.maxRow + 1).map(row => row.slice(bounds.minCol, bounds.maxCol + 1));
    const headerRowRel = findHeaderRowIndex(cropped);
    const rawHeaders = cropped[headerRowRel].map(cellToHeaderText);
    const headerMap = mapRequiredHeaders(rawHeaders);
    const isCompleteStructure = Object.keys(headerMap).length === 5;
    const metaLines = extractMetaLines(cropped, headerRowRel);
    const dataRelRows = cropped.slice(headerRowRel + 1);
    const rawDataRows = processDataRows(dataRelRows, headerMap, bounds.minRow + headerRowRel + 1);
    return { headers: rawHeaders, rows: rawDataRows, metaLines, isCompleteStructure, headerMap };
}

/**
 * Mapuje wymagane nagłówki na ich indeksy w tabeli.
 */
function mapRequiredHeaders(rawHeaders) {
    const requiredHeaders = {
        'NR_POL': ['NR. PÓŁ', 'NR PÓŁ', 'NR. POL', 'NR POL', 'PÓŁKA', 'POLKA', 'NR'],
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

/**
 * Wyodrębnia linie metadanych znajdujące się nad nagłówkiem.
 */
function extractMetaLines(cropped, headerRowRel) {
    const metaLines = [];
    for (let r = 0; r < headerRowRel; r++) {
        const parts = cropped[r].filter(v => !isEmptyCell(v)).map(v => String(formatCellValue(v)).trim()).filter(v => v.length > 0);
        if (parts.length > 0) metaLines.push(parts.join(' | '));
    }
    return metaLines;
}

/**
 * Przetwarza wiersze danych.
 */
function processDataRows(dataRelRows, headerMap, startRowIndex) {
    const rawDataRows = [];
    for (let r = 0; r < dataRelRows.length; r++) {
        const row = dataRelRows[r];
        if (row.every(isEmptyCell)) continue;
        const cleanedCells = row.map((cell, idx) => formatCellContent(cell, idx, headerMap));
        rawDataRows.push({ originalRowIndex: startRowIndex + r, cells: cleanedCells });
    }
    return rawDataRows;
}

/**
 * Normalizuje macierz danych do prostokąta.
 */
function normalizeMatrix(matrix) {
    const safe = Array.isArray(matrix) ? matrix : [];
    const maxCols = safe.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
    return safe.map((row) => {
        const r = Array.isArray(row) ? row.slice() : [];
        while (r.length < maxCols) r.push('');
        return r;
    });
}

/**
 * Oblicza granice niepustych komórek w macierzy.
 */
function computeNonEmptyBounds(matrix) {
    let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
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
    return maxRow === -1 ? null : { minRow, maxRow, minCol, maxCol };
}

/**
 * Znajduje indeks wiersza nagłówkowego.
 */
function findHeaderRowIndex(cropped) {
    const counts = cropped.map(countNonEmpty);
    for (let i = 0; i < cropped.length; i++) {
        if (counts[i] < 2) continue;
        if (counts.slice(i + 1).some(c => c >= 2)) return i;
    }
    return 0;
}

/**
 * Dodaje wiersze tabeli do globalnego zbioru allData.
 */
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

/**
 * Tworzy znormalizowany obiekt wiersza do wyszukiwania.
 */
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

/**
 * Pobiera tekst reprezentujący wiersz do wyświetlenia.
 */
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

/**
 * Wykonuje proces wyszukiwania.
 */
async function performSearch(query) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
        handleSearchShortQuery();
        return;
    }
    statusIndicator.textContent = 'Szukanie...';
    statusIndicator.classList.remove('status--hint');
    lastQuery = trimmedQuery;
    try {
        matchedResults = await executeSearch(trimmedQuery);
        if (matchedResults.length === 0) {
            handleNoSearchResults();
            return;
        }
        statusIndicator.textContent = 'Dane gotowe.';
        currentResults = matchedResults;
        await renderResults(trimmedQuery, { append: false, startIndex: 0 });
    } catch (err) {
        handleSearchError(err);
    }
}

/**
 * Realizuje niskopoziomowe wyszukiwanie w danych.
 */
async function executeSearch(query) {
    if (searchCache.has(query)) return searchCache.get(query);
    const lowerQuery = normalizeText(query);
    const fuzzyQuery = fuzzyNormalizeText(query);
    const filtered = allData.filter(item => matchItem(item, lowerQuery, fuzzyQuery));
    const grouped = groupSearchResults(filtered);
    updateSearchCache(query, grouped);
    return grouped;
}

/**
 * Sprawdza, czy element danych pasuje do zapytania.
 */
function matchItem(item, lowerQuery, fuzzyQuery) {
    const matches = item.searchable.includes(lowerQuery) || item.searchableFuzzy.includes(fuzzyQuery);
    if (!matches) return false;

    const fileName = String(item?.fileName ?? '');
    if (normalizeText(fileName).includes(lowerQuery) || fuzzyNormalizeText(fileName).includes(fuzzyQuery)) return true;

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

/**
 * Grupuje wyniki wyszukiwania według nazw plików.
 */
function groupSearchResults(filtered) {
    const groups = new Map();
    for (const item of filtered) {
        if (!groups.has(item.fileName)) {
            groups.set(item.fileName, { fileName: item.fileName, isComplete: item.isComplete, items: [], categories: getRouteCategoriesFromFileName(item.fileName) });
        }
        groups.get(item.fileName).items.push(item);
    }
    return Array.from(groups.values());
}

/**
 * Aktualizuje cache wyników wyszukiwania.
 */
function updateSearchCache(query, results) {
    searchCache.set(query, results);
}

//////////////////////////////////////////////////
// FUNKCJE POMOCNICZE BIZNESOWE
//////////////////////////////////////////////////

/**
 * Sprawdza, czy wiersz pasuje do reguł "laboratorium".
 */
function rowMatchesKeyLab(text) {
    const normalized = fuzzyNormalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized) return false;
    const tokens = normalized.split(/\s+/g).filter(Boolean);
    if (tokens.length === 0) return false;
    const tokenSet = new Set(tokens);
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i].length === 1 && tokens[i + 1].length === 1) tokenSet.add(tokens[i] + tokens[i + 1]);
    }
    if (!Array.isArray(compiledKeyLabTokenSets) || compiledKeyLabTokenSets.length === 0) compileKeyLabTokenSets();
    for (const requiredTokens of compiledKeyLabTokenSets) {
        let ok = true;
        for (const token of requiredTokens) {
            if (!tokenSet.has(token)) { ok = false; break; }
        }
        if (ok) return true;
    }
    return false;
}

/**
 * Kompiluje zestawy tokenów dla laboratoriów.
 */
function compileKeyLabTokenSets() {
    const compiled = [];
    for (const entry of KEY_LAB_TOKEN_SETS) {
        const phrase = Array.isArray(entry) ? entry.join(' ') : String(entry ?? '');
        const normalized = fuzzyNormalizeText(phrase).replace(/[^a-z0-9]+/g, ' ').trim();
        if (!normalized) continue;
        const tokens = normalized.split(/\s+/g).filter(Boolean);
        const collapsed = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] && tokens[i + 1] && tokens[i].length === 1 && tokens[i + 1].length === 1) {
                collapsed.push(tokens[i] + tokens[i + 1]); i += 1; continue;
            }
            collapsed.push(tokens[i]);
        }
        const unique = Array.from(new Set(collapsed.filter(Boolean)));
        if (unique.length > 0) compiled.push(unique);
    }
    compiledKeyLabTokenSets = compiled;
}

/**
 * Rozwiązuje konflikty nazw plików przed importem.
 */
async function resolveImportConflicts(files) {
    const conflicts = [];
    for (const f of files) { if (await docsFileExists(f.name)) conflicts.push(f); }
    if (conflicts.length === 0) return files;
    return new Promise((resolve) => {
        if (files.length === 1) {
            showModal('Konflikt nazw', `Plik o nazwie <strong>${escapeHtml(files[0].name)}</strong> już istnieje. Czy chcesz go nadpisać?`, [
                { label: `Nadpisz tylko ${files[0].name}`, class: 'modal-btn--primary', onClick: () => resolve(files) },
                { label: 'Anuluj', onClick: () => resolve([]) }
            ]);
        } else {
            showModal('Konflikty nazw', `Wykryto ${conflicts.length} plików, które już istnieją w bazie. Wybierz akcję dla importu zbiorczego.`, [
                { label: 'Nadpisz wszystkie', class: 'modal-btn--danger', onClick: () => resolve(files) },
                { label: 'Pomiń istniejące', class: 'modal-btn--primary', onClick: () => {
                    const conflictNames = new Set(conflicts.map(c => c.name));
                    resolve(files.filter(f => !conflictNames.has(f.name)));
                }},
                { label: 'Anuluj', onClick: () => resolve([]) }
            ]);
        }
    });
}

/**
 * Filtruje pliki przeznaczone do importu.
 */
function filterImportFiles(files) {
    const accepted = [], rejected = [];
    for (const f of files) {
        const name = String(f?.name || ''), lower = name.toLowerCase();
        const okExt = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
        const okSize = Number(f?.size || 0) <= MAX_IMPORT_BYTES;
        if (!okExt) rejected.push({ name, reason: 'extension' });
        else if (!okSize) rejected.push({ name, reason: 'size' });
        else accepted.push(f);
    }
    return { accepted, rejected };
}

/**
 * Usuwa dane powiązane z konkretnym plikiem.
 */
function removeFileData(fileName) {
    const safe = String(fileName || '');
    if (!safe) return;
    allData = allData.filter(d => d?.fileName !== safe);
    delete fullFileData[safe];
    loadErrors = loadErrors.filter(e => e?.fileName !== safe);
}

/**
 * Resetuje kluczowe dane aplikacji.
 */
function resetAppData() {
    allData = []; currentResults = []; lastQuery = '';
    loadedFiles = new Set(); fullFileData = {}; loadErrors = [];
}

//////////////////////////////////////////////////
// FUNKCJE RENDERUJĄCE UI
//////////////////////////////////////////////////

/**
 * Renderuje listę wyników wyszukiwania.
 */
async function renderResults(query, { append = false, startIndex = 0 } = {}) {
    const reduceMotion = prefersReducedMotion();

    if (!append && resultsList.children.length > 0 && !reduceMotion) {
        // Jeśli nie dopisujemy wyników i mamy już coś na liście, robimy płynne wyjście
        resultsList.classList.add('qe-results-exiting');
        
        // Czekamy na koniec animacji (180ms w CSS + margines bezpieczeństwa)
        await new Promise(resolve => setTimeout(resolve, 160));
        
        resultsList.classList.remove('qe-results-exiting');
        clearElement(resultsList);
    } else if (!append) {
        // Standardowe czyszczenie dla reduced motion lub pustej listy
        clearElement(resultsList);
    }

    if (currentResults.length === 0) {
        handleNoResultsToRender(); window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); }); return;
    }
    updateResultsCountInfo();

    const shouldAnimateEnter = !reduceMotion;
    const sections = ensureRouteCategorySections({ animate: shouldAnimateEnter && !append });
    let enterOrdinal = 0;
    const maxEnterAnimations = append ? 18 : 42;
    const fragmentByCategory = new Map();
    for (const category of ROUTE_CATEGORIES_ORDER) fragmentByCategory.set(category, document.createDocumentFragment());

    for (let index = startIndex; index < currentResults.length; index++) {
        const group = currentResults[index];
        const cats = Array.isArray(group?.categories) && group.categories.length > 0 ? group.categories : ['STANDARD'];
        const uniqueCats = Array.from(new Set(cats.map(c => String(c || '').trim()).filter(Boolean)));
        const targetCats = uniqueCats.length > 0 ? uniqueCats : ['STANDARD'];
        for (const category of targetCats) {
            if (!fragmentByCategory.has(category)) continue;
            const animateIn = shouldAnimateEnter && enterOrdinal < maxEnterAnimations;
            const enterDelayMs = animateIn ? Math.min(enterOrdinal, 12) * 24 : 0;
            const el = createResultGroupElement(group, index, query, animateIn ? { animateIn: true, enterDelayMs } : undefined);
            if (animateIn) enterOrdinal += 1;
            fragmentByCategory.get(category).appendChild(el);
        }
    }

    for (const category of ROUTE_CATEGORIES_ORDER) {
        const section = sections.get(category);
        if (!section) continue;
        (section.inner || section.body).appendChild(fragmentByCategory.get(category));
    }

    updateRouteCategorySectionCounts(sections);
    syncRouteCategorySectionHeights(sections);
    window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); });
}

function ensureResultsCategoryBodyInner(body) {
    if (!body || !(body instanceof HTMLElement)) return null;
    const existing = body.querySelector('.results-category-body-inner');
    if (existing && existing.parentElement === body) return existing;

    const inner = document.createElement('div');
    inner.className = 'results-category-body-inner';
    while (body.firstChild) inner.appendChild(body.firstChild);
    body.appendChild(inner);
    return inner;
}

function syncRouteCategorySectionHeights(sections) {
    if (!resultsList) return;

    const entries = [];
    if (sections instanceof Map) {
        for (const entry of sections.values()) {
            if (!entry || !entry.section || !entry.body) continue;
            const body = entry.body;
            const inner = entry.inner || ensureResultsCategoryBodyInner(body);
            if (!inner) continue;
            entries.push({ section: entry.section, body, inner });
        }
    } else {
        const sectionEls = resultsList.querySelectorAll('.results-category');
        for (const section of sectionEls) {
            if (!(section instanceof HTMLElement)) continue;
            const body = section.querySelector('.results-category-body');
            if (!body || !(body instanceof HTMLElement)) continue;
            const inner = ensureResultsCategoryBodyInner(body);
            if (!inner) continue;
            entries.push({ section, body, inner });
        }
    }

    for (const entry of entries) {
        if (entry.section.classList.contains('hidden')) continue;
        const style = window.getComputedStyle(entry.section);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        if (entry.section.classList.contains('is-collapsed')) {
            entry.body.style.setProperty('--qe-results-category-max', '0px');
            continue;
        }

        const height = entry.inner.scrollHeight;
        entry.body.style.setProperty('--qe-results-category-max', `${height}px`);
    }
}

function ensureRouteCategorySections({ animate = false } = {}) {
    const map = new Map();
    const shouldRebuild = ROUTE_CATEGORIES_ORDER.some((c) => !resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(c)}"]`));
    if (shouldRebuild) clearElement(resultsList);

    let sectionOrdinal = 0;
    for (const category of ROUTE_CATEGORIES_ORDER) {
        let section = resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(category)}"]`);
        
        if (!section) {
            section = document.createElement('section');
            section.className = 'results-category';
            section.dataset.category = category;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'results-category-toggle';
            button.dataset.category = category;

            const title = document.createElement('span');
            title.className = 'results-category-title';
            title.textContent = category;

            const count = document.createElement('span');
            count.className = 'results-category-count';
            count.textContent = '0';

            button.appendChild(title);
            button.appendChild(count);

            const body = document.createElement('div');
            body.className = 'results-category-body';
            const inner = document.createElement('div');
            inner.className = 'results-category-body-inner';
            body.appendChild(inner);

            const collapsed = isRouteCategoryCollapsed(category);
            section.classList.toggle('is-collapsed', collapsed);
            button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

            section.appendChild(button);
            section.appendChild(body);
            resultsList.appendChild(section);
        }

        // Dodajemy klasy animacji jeśli wymagane
        if (animate) {
            const collapsed = isRouteCategoryCollapsed(category);
            section.classList.remove('qe-section-enter', 'qe-enter-left', 'qe-enter-right', 'qe-enter-center');
            
            // Wymuszamy reflow aby zresetować animację jeśli sekcja już istniała
            void section.offsetWidth; 
            
            section.classList.add('qe-section-enter');
            if (collapsed) {
                // Naprzemienny wjazd dla zwiniętych
                const directionClass = (sectionOrdinal % 2 === 0) ? 'qe-enter-left' : 'qe-enter-right';
                section.classList.add(directionClass);
            } else {
                // Subtelne pojawienie się w centrum dla rozwiniętych
                section.classList.add('qe-enter-center');
            }
            section.style.setProperty('--qe-section-delay', `${sectionOrdinal * 60}ms`);
            sectionOrdinal++;
        }

        const btn = section.querySelector('.results-category-toggle');
        const count = section.querySelector('.results-category-count');
        const body = section.querySelector('.results-category-body');
        const inner = ensureResultsCategoryBodyInner(body);
        map.set(category, { section, button: btn, count, body, inner });
    }

    return map;
}

function updateRouteCategorySectionCounts(sections) {
    const counts = new Map();
    for (const category of ROUTE_CATEGORIES_ORDER) counts.set(category, 0);

    for (const group of currentResults) {
        const cats = Array.isArray(group?.categories) && group.categories.length > 0 ? group.categories : ['STANDARD'];
        const uniqueCats = Array.from(new Set(cats.map(c => String(c || '').trim()).filter(Boolean)));
        const targetCats = uniqueCats.length > 0 ? uniqueCats : ['STANDARD'];
        for (const category of targetCats) {
            if (!counts.has(category)) continue;
            counts.set(category, counts.get(category) + 1);
        }
    }

    for (const category of ROUTE_CATEGORIES_ORDER) {
        const section = sections.get(category);
        if (!section) continue;
        const value = counts.get(category) || 0;
        section.count.textContent = String(value);
        section.section.classList.toggle('hidden', value === 0);
    }
}

function toggleRouteCategorySection(category) {
    const cat = String(category || '').trim();
    if (!cat) return;
    const section = resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(cat)}"]`);
    if (!section) return;
    const button = section.querySelector('.results-category-toggle');
    const body = section.querySelector('.results-category-body');
    const inner = body ? ensureResultsCategoryBodyInner(body) : null;
    const wasCollapsed = section.classList.contains('is-collapsed');
    const reduceMotion = prefersReducedMotion();

    if (!body || !inner || reduceMotion) {
        const isCollapsed = section.classList.toggle('is-collapsed');
        if (button) button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        storageSet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${cat}`, isCollapsed ? '1' : '0');
        syncRouteCategorySectionHeights();
        window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); });
        return;
    }

    if (wasCollapsed) {
        body.style.setProperty('--qe-results-category-max', '0px');
        section.classList.remove('is-collapsed');
        if (button) button.setAttribute('aria-expanded', 'true');
        storageSet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${cat}`, '0');
        window.requestAnimationFrame(() => {
            const height = inner.scrollHeight;
            body.style.setProperty('--qe-results-category-max', `${height}px`);
            window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); });
        });
        return;
    }

    const height = inner.scrollHeight;
    body.style.setProperty('--qe-results-category-max', `${height}px`);
    if (button) button.setAttribute('aria-expanded', 'false');
    storageSet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${cat}`, '1');
    window.requestAnimationFrame(() => {
        section.classList.add('is-collapsed');
        window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); });
    });
}

function isRouteCategoryCollapsed(category) {
    const cat = String(category || '').trim();
    if (!cat) return false;
    return storageGet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${cat}`) === '1';
}

function cssEscapeAttrValue(value) {
    const v = String(value ?? '');
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(v);
    return v.replace(/["\\\]]/g, '\\$&');
}

/**
 * Tworzy element grupy wyników (plik/trasa).
 */
function createResultGroupElement(group, index, query, { animateIn = false, enterDelayMs = 0 } = {}) {
    const routeName = formatRouteNameForResults(group.fileName);
    const routeCode = extractRouteCodeFromFileName(group.fileName);
    const driverName = routeCode ? getDriverForRouteOnDate(routeCode, new Date()) : null;
    const driverHtml = driverName ? `<span class="result-driver" aria-label="Kierowca z grafiku">— ${escapeHtml(driverName)}</span>` : '';
    const groupDiv = document.createElement('div');
    
    // Określamy kierunek animacji na podstawie indeksu (parzyste z lewej, nieparzyste z prawej)
    const directionClass = (index % 2 === 0) ? 'qe-enter-left' : 'qe-enter-right';
    groupDiv.className = animateIn ? `result-group qe-result-enter ${directionClass}` : 'result-group';
    
    groupDiv.dataset.index = index;
    if (animateIn && Number.isFinite(enterDelayMs) && enterDelayMs > 0) groupDiv.style.setProperty('--qe-enter-delay', `${enterDelayMs}ms`);
    const rowsHtml = group.items.map(item => {
        const isLab = item.isComplete ? rowMatchesKeyLab(item.cells.join(' ')) : false;
        const rowClass = isLab ? 'result-row result-row--lab' : 'result-row';
        return `<div class="${rowClass}" data-row-index="${item.rowIndex}" data-file-name="${escapeHtml(item.fileName)}">
            <div class="result-content">${buildResultSummaryHtml(item, query, { isLab })}</div>
        </div>`;
    }).join('');
    setElementHtml(groupDiv, `<div class="result-group-header"><span class="result-filename"><span class="result-route-name">${routeName}</span>${driverHtml}</span></div><div class="result-group-body">${rowsHtml}</div>`);
    return groupDiv;
}

/**
 * Buduje kod HTML dla podglądu wiersza w wynikach.
 */
function buildResultSummaryHtml(result, query, { isLab = false } = {}) {
    if (result.isComplete) {
        const parts = result.displayText.split('|').map(s => s.trim());
        const time = parts[0] || '—', address = parts[1] || '';
        let facility = parts[2] || '';
        if (isLab) facility = toTitleCase(facility);
        const facilityClass = isLab ? 'result-col result-facility result-facility--lab' : 'result-col result-facility';
        return [
            `<span class="result-col result-time">${highlightText(time, query)}</span>`,
            `<span class="result-col result-address">${highlightText(address, query)}</span>`,
            `<span class="${facilityClass}">${highlightText(facility, query)}</span>`
        ].join('');
    }
    return result.cells.filter(c => !isEmptyCell(c)).map(c => {
        let text = String(c); if (isLab) text = toTitleCase(text);
        return `<span class="result-cell-fragment">${highlightText(text, query)}</span>`;
    }).join('');
}

/**
 * Wyświetla widok podglądu pełnej tabeli pliku.
 */
function showFilePreview(fileName, highlightRowIndex, options = { skipPush: false }) {
    const tableModel = fullFileData[fileName];
    if (!tableModel || !Array.isArray(tableModel.headers) || !Array.isArray(tableModel.rows)) return;
    if (!options.skipPush) {
        try { history.pushState({ view: 'preview', fileName, rowIndex: highlightRowIndex }, '', `#preview/${encodeURIComponent(fileName)}`); }
        catch (e) { logAction('navigation', { error: 'pushState preview failed', msg: e.message }, 'WARN'); }
    }
    lastPreviewState = { fileName, rowIndex: highlightRowIndex };
    togglePreviewView(true, fileName, tableModel.metaLines);
    const thead = document.getElementById('table-header'), tbody = document.getElementById('table-body');
    clearElement(thead); clearElement(tbody);
    renderPreviewHeader(thead, tableModel.headers);
    const highlightedRowEl = renderPreviewBody(tbody, tableModel, highlightRowIndex);
    if (highlightedRowEl) highlightedRowEl.scrollIntoView({ block: 'center' });
    queuePreviewReadyEvent(fileName);
    logClientEvent('preview', { fileName: String(fileName || ''), rowIndex: Number.isInteger(highlightRowIndex) ? highlightRowIndex : null });
    window.requestAnimationFrame(() => updateScrollIndicator());
}

/**
 * Renderuje nagłówek podglądu tabeli.
 */
function renderPreviewHeader(thead, headers) {
    headers.forEach(h => { const th = document.createElement('th'); th.textContent = h || ''; thead.appendChild(th); });
}

/**
 * Renderuje treść podglądu tabeli.
 */
function renderPreviewBody(tbody, tableModel, highlightRowIndex) {
    let highlightedRowEl = null;
    tableModel.rows.forEach((rowObj) => {
        const tr = document.createElement('tr');
        if (rowObj.originalRowIndex === highlightRowIndex) { tr.classList.add('highlighted-row'); highlightedRowEl = tr; }
        rowObj.cells.forEach((cell, cellIdx) => {
            const td = document.createElement('td'); td.textContent = (cell === null || cell === undefined) ? '' : String(cell);
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

/**
 * Aktualizuje informację o liczbie znalezionych wyników.
 */
function updateResultsCountInfo() {
    resultsInfo.innerHTML = `Trasy: ${matchedResults.length} / ${loadedFiles.size}`;
}

/**
 * Aktualizuje metadane w widoku podglądu.
 */
function updatePreviewMeta(metaLines) {
    if (!previewMeta) return;
    const lines = Array.isArray(metaLines) ? metaLines : [];
    if (lines.length > 0) { previewMeta.textContent = lines.join('\n'); previewMeta.classList.remove('hidden'); }
    else { previewMeta.textContent = ''; previewMeta.classList.add('hidden'); }
}

function renderPreviewFileNameWithCategory(fileName) {
    const el = document.getElementById('preview-filename');
    if (!el) return;
    el.replaceChildren();
    const title = document.createElement('span');
    title.className = 'preview-filename-title';
    title.textContent = formatFileName(fileName);
    el.appendChild(title);

    const categories = getRouteCategoriesFromFileName(fileName);
    const uniqueCats = Array.from(new Set((Array.isArray(categories) ? categories : []).map(c => String(c || '').trim()).filter(Boolean)));
    for (const cat of uniqueCats) {
        const badge = document.createElement('span');
        badge.className = 'route-category-badge';
        badge.dataset.routeCategory = cat;
        badge.textContent = cat;
        el.appendChild(badge);
    }
}

/**
 * Przełącza między widokiem wyszukiwania a podglądem.
 */
function togglePreviewView(show, fileName, metaLines) {
    if (show) {
        searchView.classList.add('view-hidden'); filePreviewView.classList.remove('view-hidden');
        renderPreviewFileNameWithCategory(fileName); updatePreviewMeta(metaLines);
    } else {
        filePreviewView.classList.add('view-hidden'); searchView.classList.remove('view-hidden');
    }
}

/**
 * Wyświetla systemowy modal z opcjami.
 */
function showModal(title, content, actions = []) {
    if (!modalOverlay || !modalTitle || !modalContent || !modalActions) return;
    const { html, hasDrive } = qeBuildModalTitleHtml(title);
    modalTitle.innerHTML = html;
    modalTitle.classList.toggle('qe-modal-title--gdrive', Boolean(hasDrive));
    setElementHtml(modalContent, content);
    clearElement(modalActions);
    actions.forEach(action => {
        const btn = document.createElement('button'); btn.className = `modal-btn ${action.class || ''}`; btn.textContent = action.label;
        btn.onclick = () => { hideModal(); if (typeof action.onClick === 'function') action.onClick(); };
        modalActions.appendChild(btn);
    });
    modalOverlay.classList.remove('hidden'); modalOverlay.setAttribute('aria-hidden', 'false');
}

/**
 * Ukrywa aktualnie wyświetlany modal.
 */
function hideModal() {
    qeTeardownDriveChangesModal();
    if (!modalOverlay) return; modalOverlay.classList.add('hidden'); modalOverlay.setAttribute('aria-hidden', 'true');
}

/**
 * Wyświetla podsumowanie po zakończeniu importu.
 */
function displayImportSummary(summary) {
    const safeFilesList = summary.files.map(f => escapeHtml(formatFileName(f))).join(', ');
    setElementHtml(resultsInfo, `Zaimportowano rekordów: <strong>${escapeHtml(summary.records)}</strong><br>Pliki: <strong>${safeFilesList || '-'}</strong><br>Błędy: <strong>${escapeHtml(summary.errors)}</strong>`);
}

/**
 * Podświetla laboratoria w tabeli podglądu.
 */
function highlightLabsInPreviewTable() {
    const tbody = document.getElementById('table-body'); if (!tbody || !tbody.rows) return;
    for (let r = 0; r < tbody.rows.length; r++) {
        const tr = tbody.rows[r]; let rowText = '';
        for (let c = 0; c < tr.cells.length; c++) rowText += ` ${tr.cells[c]?.textContent || ''}`;
        const isLab = rowMatchesKeyLab(rowText); tr.classList.toggle('highlight-lab', isLab);
        if (isLab) {
            const facilityCell = tr.querySelector('.facility-column');
            if (facilityCell && !facilityCell.querySelector('.lab-badge')) {
                facilityCell.innerHTML = `<span class="lab-badge">${escapeHtml(toTitleCase(facilityCell.textContent))}</span>`;
            }
        }
    }
}

/**
 * Tworzy element postępu dla ekranu powitalnego.
 */
function createWelcomeProgressItem(fileName) {
    const item = document.createElement('div'); item.className = 'welcome-progress-item';
    setElementHtml(item, `<div class="welcome-progress-name">${escapeHtml(formatFileName(fileName))}</div><div class="welcome-progress-bar-wrap"><div class="welcome-progress-bar-fill" style="width: 0%"></div></div><div class="welcome-progress-status">0%</div>`);
    return item;
}

/**
 * Aktualizuje element postępu na ekranie powitalnym.
 */
function updateWelcomeProgressItem(item, percent, statusText, isError = false) {
    const fill = item.querySelector('.welcome-progress-bar-fill'), status = item.querySelector('.welcome-progress-status');
    if (fill) fill.style.width = `${percent}%`;
    const nextStatus = statusText || `${Math.round(percent)}%`;
    if (welcomeTextUpdatesLocked && loadingOverlay && loadingOverlay.dataset.welcomeSeq !== 'done') {
        item.setAttribute('data-pending-status', '1');
        item.setAttribute('data-pending-status-text', nextStatus);
        if (isError) item.setAttribute('data-pending-error', '1');
        return;
    }
    if (status) status.textContent = nextStatus;
    if (isError) item.classList.add('error');
}

/**
 * Renderuje logo w nagłówku aplikacji.
 */
function renderHeaderLogo() {
    if (!appHeaderLogo) return; setElementSvg(appHeaderLogo, buildQuickEvoLogoSvg({ size: 'header' }));
    startLogoOrbitInContainer(appHeaderLogo, 'header');
}

/**
 * Odświeża grafikę powitalną (reakcja na zmianę motywu).
 */
function refreshWelcomeGraphicIfPresent() {
    const container = document.getElementById('welcome-graphic');
    if (container && container.dataset.loaded === '1') {
        setElementSvg(container, buildQuickEvoLogoSvg({ size: 'welcome' }));
        startLogoOrbitInContainer(container, 'welcome');
    }
}

/**
 * Leniwie ładuje grafikę na ekranie powitalnym.
 */
function lazyLoadWelcomeGraphic() {
    const container = document.getElementById('welcome-graphic'); if (!container) return;
    const inject = () => {
        if (container.dataset.loaded === '1') return; container.dataset.loaded = '1';
        setElementSvg(container, buildQuickEvoLogoSvg({ size: 'welcome' })); startLogoOrbitInContainer(container, 'welcome');
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(inject, { timeout: 900 }); else window.setTimeout(inject, 350);
}

function scheduleWelcomeLogoEntrance() {
    if (!loadingOverlay) return;
    const container = document.getElementById('welcome-graphic');
    if (!container) return;

    if (welcomeLogoEnterTimer !== null) {
        window.clearTimeout(welcomeLogoEnterTimer);
        welcomeLogoEnterTimer = null;
    }

    if (welcomeSeqUnlockTimer !== null) {
        window.clearTimeout(welcomeSeqUnlockTimer);
        welcomeSeqUnlockTimer = null;
    }

    if (welcomeSeqFailSafeTimer !== null) {
        window.clearTimeout(welcomeSeqFailSafeTimer);
        welcomeSeqFailSafeTimer = null;
    }

    const baseTs = Number.isFinite(welcomeOverlayStartedAt) && welcomeOverlayStartedAt > 0
        ? welcomeOverlayStartedAt
        : (typeof welcomeLogoDomContentLoadedTs === 'number' ? welcomeLogoDomContentLoadedTs : performance.now());
    const elapsed = performance.now() - baseTs;
    const remaining = Math.max(0, WELCOME_LOGO_ENTER_DELAY_MS - elapsed);

    const run = () => {
        if (!loadingOverlay) return;
        loadingOverlay.dataset.welcomeSeq = 'ready';
        clearWelcomeElementsInitState();
        if (!container.classList.contains('welcome-graphic--ready')) container.classList.add('welcome-graphic--ready');
        welcomeSeqUnlockTimer = window.setTimeout(() => {
            welcomeSeqUnlockTimer = null;
            completeWelcomeEntrance();
        }, WELCOME_SEQUENCE_UNLOCK_AFTER_MS);
    };

    welcomeLogoEnterTimer = window.setTimeout(() => { welcomeLogoEnterTimer = null; run(); }, remaining);
    welcomeSeqFailSafeTimer = window.setTimeout(() => {
        welcomeSeqFailSafeTimer = null;
        if (!loadingOverlay) return;
        if (loadingOverlay.dataset.welcomeSeq === 'done') return;
        if (!container.classList.contains('welcome-graphic--ready')) container.classList.add('welcome-graphic--ready');
        forceWelcomeSequenceDone();
    }, remaining + WELCOME_SEQUENCE_UNLOCK_AFTER_MS + WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS);
}

function completeWelcomeEntrance() {
    if (loadingOverlay) loadingOverlay.dataset.welcomeSeq = 'done';
    if (welcomeTextUpdatesLocked) {
        welcomeTextUpdatesLocked = false;
        flushPendingWelcomeTextUpdates();
    }
    startLoadingOverlayDynamicEffects();
}

function flushPendingWelcomeTextUpdates() {
    if (!loadingOverlay) return;

    if (pendingLoadingStatusText !== null) {
        if (loadingStatusText) loadingStatusText.textContent = pendingLoadingStatusText;
        pendingLoadingStatusText = null;
    }

    if (pendingLoadingProgressValue !== null) {
        applyLoadingProgressTargetPercent(pendingLoadingProgressValue);
        pendingLoadingProgressValue = null;
    }

    if (pendingLoadingErrorVisible) {
        if (loadingError) {
            loadingError.textContent = pendingLoadingErrorMessage || 'Nieznany błąd ładowania.';
            loadingError.classList.remove('hidden');
        }
        pendingLoadingErrorVisible = false;
        pendingLoadingErrorMessage = null;
    }

    const pendingItems = document.querySelectorAll('.welcome-progress-item[data-pending-status="1"]');
    for (const item of pendingItems) {
        const status = item.querySelector('.welcome-progress-status');
        const text = item.dataset.pendingStatusText;
        if (status && typeof text === 'string') status.textContent = text;
        if (item.dataset.pendingError === '1') item.classList.add('error');
        item.removeAttribute('data-pending-status');
        item.removeAttribute('data-pending-status-text');
        item.removeAttribute('data-pending-error');
    }
}

function setupWelcomeOverlayParallax() {
    if (!loadingOverlay) return;
    const reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const pointerFine = Boolean(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
    if (reduced || !pointerFine) return;

    let scrollOffsetY = 0;
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    const kick = () => {
        if (welcomeParallaxRaf) return;
        welcomeParallaxRaf = window.requestAnimationFrame(() => {
            welcomeParallaxRaf = 0;
            if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) {
                welcomeParallaxTargetX = 0;
                welcomeParallaxTargetY = 0;
            }

            welcomeParallaxCurrentX += (welcomeParallaxTargetX - welcomeParallaxCurrentX) * 0.14;
            welcomeParallaxCurrentY += (welcomeParallaxTargetY - welcomeParallaxCurrentY) * 0.14;

            const x = welcomeParallaxCurrentX;
            const y = welcomeParallaxCurrentY + scrollOffsetY;
            loadingOverlay.style.setProperty('--qe-parallax-x', `${x.toFixed(2)}px`);
            loadingOverlay.style.setProperty('--qe-parallax-y', `${y.toFixed(2)}px`);
        });
    };

    window.addEventListener('pointermove', (e) => {
        if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;
        if (e.pointerType && e.pointerType !== 'mouse') return;
        const card = loadingOverlay.querySelector('.loading-card');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        const dx = (e.clientX - (rect.left + rect.width / 2)) / Math.max(1, rect.width);
        const dy = (e.clientY - (rect.top + rect.height / 2)) / Math.max(1, rect.height);
        welcomeParallaxTargetX = clamp(dx * 10, -8, 8);
        welcomeParallaxTargetY = clamp(dy * 8, -6, 6);
        kick();
    }, { passive: true });

    window.addEventListener('scroll', () => {
        const y = (window.scrollY || document.documentElement.scrollTop || 0);
        scrollOffsetY = -clamp(y / 120, -6, 6);
        kick();
    }, { passive: true });
}

/**
 * Uruchamia ekran ładowania.
 */
function startLoadingScreen() {
    if (!loadingOverlay) return;
    welcomeOverlayStartedAt = performance.now();
    loadingOverlay.dataset.welcomeSeq = 'init';
    loadingOverlay.classList.remove('hidden'); loadingOverlay.setAttribute('aria-hidden', 'false'); loadingOverlay.setAttribute('aria-busy', 'true');
    if (loadingError) { loadingError.textContent = ''; loadingError.classList.add('hidden'); }
    if (loadingContinueButton) loadingContinueButton.disabled = true;
    const welcomeGraphic = document.getElementById('welcome-graphic');
    if (welcomeGraphic) welcomeGraphic.classList.remove('welcome-graphic--ready');

    welcomeTextUpdatesLocked = true;
    pendingLoadingStatusText = null;
    pendingLoadingProgressValue = null;
    pendingLoadingErrorMessage = null;
    pendingLoadingErrorVisible = false;

    loadingProgressDone = false;
    loadingProgressValue = 0;
    loadingProgressDisplayValue = 0;
    stopLoadingProgressAnimation();
    pendingLoadingStatusFinalization = null;
    loadingProgressSim.runId += 1;
    loadingProgressSim.pauseUntilTs = 0;
    if (loadingProgressSim.pauseTimerId !== null) {
        window.clearTimeout(loadingProgressSim.pauseTimerId);
        loadingProgressSim.pauseTimerId = null;
    }
    loadingProgressSim.nextMicroStopAtTs = performance.now() + randomIntInclusive(280, 750);
    loadingProgressSim.nextJumpAtTs = performance.now() + randomIntInclusive(220, 620);
    loadingProgressSim.speedDriftUntilTs = 0;
    loadingProgressSim.speedMultiplier = 1;
    loadingProgressSim.boostUntilTs = 0;
    loadingProgressSim.lastTargetValue = 0;
    loadingProgressSim.profile = null;
    setLoadingProgressDisplayPercent(0);
    if (loadingStatusText) loadingStatusText.textContent = 'Inicjalizacja...';
    if (loadingTitleText) {
        loadingTitleText.textContent = 'Witamy w QuickEvo!';
        loadingTitleText.style.opacity = '1';
    }
    if (loadingTitleRotator) loadingTitleRotator.stop();

    applyWelcomeElementsInitState();
    scheduleWelcomeLogoEntrance();
}

/**
 * Zatrzymuje ekran ładowania.
 */
function stopLoadingScreen() {
    if (!loadingOverlay) return;
    const active = document.activeElement; if (active && loadingOverlay.contains(active)) { try { active.blur(); } catch { } focusBodySafely(); }
    loadingOverlay.classList.add('loading-overlay-fade-out');
    setTimeout(() => { loadingOverlay.classList.add('hidden'); loadingOverlay.classList.remove('loading-overlay-fade-out'); }, 600);
    loadingOverlay.setAttribute('aria-hidden', 'true');
    if (welcomeLogoEnterTimer !== null) { window.clearTimeout(welcomeLogoEnterTimer); welcomeLogoEnterTimer = null; }
    if (welcomeSeqUnlockTimer !== null) { window.clearTimeout(welcomeSeqUnlockTimer); welcomeSeqUnlockTimer = null; }
    if (welcomeSeqFailSafeTimer !== null) { window.clearTimeout(welcomeSeqFailSafeTimer); welcomeSeqFailSafeTimer = null; }
    welcomeTextUpdatesLocked = false;
    stopLoadingProgressAnimation();
    if (loadingTitleRotator) loadingTitleRotator.stop();
}

/**
 * Aktualizuje pasek postępu ładowania.
 */
function setLoadingProgressPercent(percent, { force = false } = {}) {
    if (!loadingOverlay) return;
    const next = force ? Math.min(100, Math.max(0, percent)) : Math.max(loadingProgressValue, Math.min(100, percent));
    loadingProgressValue = next;
    if (welcomeTextUpdatesLocked && loadingOverlay.dataset.welcomeSeq !== 'done') { pendingLoadingProgressValue = next; return; }
    applyLoadingProgressTargetPercent(next);
}

/**
 * Ustawia tekst statusu na ekranie ładowania.
 */
function setLoadingStatusText(text) {
    if (!loadingOverlay) return;
    const next = text || '';
    if (welcomeTextUpdatesLocked && loadingOverlay.dataset.welcomeSeq !== 'done') { pendingLoadingStatusText = next; return; }
    if (loadingStatusText) loadingStatusText.textContent = next;
}

/**
 * Wyświetla komunikat o błędzie na ekranie ładowania.
 */
function showLoadingError(message) {
    setLoadingStatusText('Wystąpił problem podczas ładowania.');
    if (!loadingError) return;
    if (welcomeTextUpdatesLocked && loadingOverlay && loadingOverlay.dataset.welcomeSeq !== 'done') {
        pendingLoadingErrorVisible = true;
        pendingLoadingErrorMessage = message || 'Nieznany błąd ładowania.';
        return;
    }
    loadingError.textContent = message || 'Nieznany błąd ładowania.'; loadingError.classList.remove('hidden');
}

/**
 * Przygotowuje możliwość ręcznego przejścia do aplikacji.
 */
function prepareManualContinue() {
    if (loadingFailed) {
        showLoadingError('Nie udało się załadować wszystkich danych. Możesz kontynuować i spróbować ponownie później.');
        setPendingFinalLoadingStatusText('Ładowanie zakończone (tryb awaryjny).', 'Przygotowywanie trybu awaryjnego...');
    } else if (loadErrors.length > 0) {
        showLoadingError(`Załadowano aplikację z błędami plików: ${loadErrors.length}.`);
        setPendingFinalLoadingStatusText('Ładowanie zakończone (z błędami).', 'Finalizowanie i porządkowanie...');
    } else {
        setPendingFinalLoadingStatusText('Ładowanie zakończone pomyślnie.', 'Finalizowanie i optymalizacja...');
    }
    syncPendingFinalLoadingStatusText();
    updateLoadingContinueAvailability();
}

/**
 * Aktualizuje widoczność wskaźnika przewijania.
 */
function updateScrollIndicator() {
    if (!scrollIndicator) return;
    if (!resultsList) {
        scrollIndicator.classList.add('is-hidden');
        scrollIndicator.setAttribute('aria-hidden', 'true');
        scrollIndicator.dataset.scrollNeeded = 'false';
        return;
    }

    const container = getResultsScrollContainer();
    const hasVerticalOverflow = checkListOverflow(container, resultsList);
    const hasMoreBelow = (resultsEndIntersection.observer && resultsEndIntersection.target) ? !resultsEndIntersection.lastFullyVisible : hasMoreContentBelowViewport(container, resultsList, 40);
    const shouldShow = hasVerticalOverflow && hasMoreBelow;

    scrollIndicator.dataset.scrollNeeded = hasVerticalOverflow ? 'true' : 'false';
    scrollIndicator.classList.toggle('is-hidden', !shouldShow);
    scrollIndicator.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

/**
 * Zwraca element, który faktycznie przewija widok wyników.
 * Celowo nie analizuje headerów/stopki ani innych elementów DOM – korzysta z natywnego scroll kontenera dokumentu.
 * @returns {HTMLElement}
 */
function getResultsScrollContainer() {
    const el = document.scrollingElement;
    if (el && el instanceof HTMLElement) return el;
    return document.documentElement;
}

function ensureResultsEndIntersectionObserver() {
    if (resultsEndIntersection.observer) return;
    if (typeof IntersectionObserver !== 'function') return;

    resultsEndIntersection.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry || entry.target !== resultsEndIntersection.target) continue;
            const fullyVisible = Boolean(entry.isIntersecting && entry.intersectionRatio >= 0.999);
            if (fullyVisible === resultsEndIntersection.lastFullyVisible) continue;
            resultsEndIntersection.lastFullyVisible = fullyVisible;
            updateScrollIndicator();
        }
    }, { root: null, threshold: [0, 1] });
}

function syncResultsEndIntersectionObserver() {
    if (!resultsList) return;
    ensureResultsEndIntersectionObserver();
    if (!resultsEndIntersection.observer) return;

    const groups = Array.from(resultsList.querySelectorAll('.result-group'));
    const lastVisibleGroup = (() => {
        for (let i = groups.length - 1; i >= 0; i--) {
            const el = groups[i];
            if (!el) continue;
            if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            return el;
        }
        return null;
    })();
    const last = lastVisibleGroup || (groups.length > 0 ? groups[groups.length - 1] : resultsList.lastElementChild);
    if (last === resultsEndIntersection.target) return;

    if (resultsEndIntersection.target) {
        try { resultsEndIntersection.observer.unobserve(resultsEndIntersection.target); } catch { }
    }
    resultsEndIntersection.target = last || null;
    resultsEndIntersection.lastFullyVisible = false;

    if (resultsEndIntersection.target) {
        try { resultsEndIntersection.observer.observe(resultsEndIntersection.target); } catch { }
    }
}

/**
 * Sprawdza, czy lista wyników faktycznie wymaga przewijania w pionie (overflow).
 * Mechanizm bazuje wyłącznie na wymiarach kontenera listy i jego zawartości:
 * clientHeight (widoczny viewport kontenera) oraz scrollHeight (sumaryczna wysokość treści).
 *
 * @param {Element|null} container Kontener z włączonym przewijaniem (viewport).
 * @param {Element|null} list Element zawierający elementy listy (treść).
 * @returns {boolean}
 */
function checkListOverflow(container, list) {
    if (!container || !list) return false;
    if (!(container instanceof Element) || !(list instanceof Element)) return false;

    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') return false;
    const listStyle = window.getComputedStyle(list);
    if (listStyle.display === 'none' || listStyle.visibility === 'hidden') return false;

    const containerClientHeight = container.clientHeight;
    const listScrollHeight = list.scrollHeight;
    if (!Number.isFinite(containerClientHeight) || !Number.isFinite(listScrollHeight)) return false;
    if (containerClientHeight <= 0) return false;

    return listScrollHeight > containerClientHeight;
}

/**
 * Sprawdza, czy w kontenerze przewijania są jeszcze elementy listy poniżej dolnej krawędzi viewportu.
 * @param {HTMLElement} container
 * @param {Element} list
 * @param {number} thresholdPx
 * @returns {boolean}
 */
function hasMoreContentBelowViewport(container, list, thresholdPx = 0) {
    if (!container || !(container instanceof HTMLElement)) return false;
    if (!list || !(list instanceof Element)) return false;

    const t = Number(thresholdPx);
    const threshold = Number.isFinite(t) ? Math.max(0, t) : 0;

    if (container === list) {
        const current = container.scrollTop + container.clientHeight;
        return current < (container.scrollHeight - threshold);
    }

    const containerRect = container.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const listOffsetTopInContainer = (listRect.top - containerRect.top) + container.scrollTop;
    const listBottomInContainer = listOffsetTopInContainer + list.scrollHeight;
    const viewportBottomInContainer = container.scrollTop + container.clientHeight;

    return listBottomInContainer > (viewportBottomInContainer + threshold);
}

/**
 * Przełącza widoczność strefy upuszczania plików.
 */
function setDropZoneVisible(visible) {
    if (!dropZone) return; dropZone.classList.toggle('hidden', !visible);
    dropZone.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

/**
 * Włącza lub wyłącza wyszukiwarkę.
 */
function setSearchEnabled(enabled) {
    isSearchEnabled = enabled; searchInput.disabled = !enabled;
    searchInput.setAttribute('aria-disabled', (!enabled).toString());
}

/**
 * Czyści wyniki wyszukiwania.
 */
function clearResults() {
    lastQuery = ''; matchedResults = []; currentResults = [];
    clearElement(resultsList);
    resultsInfo.textContent = '';
    window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); });
}

/**
 * Obsługuje brak wyników wyszukiwania.
 */
function handleNoSearchResults() {
    resultsInfo.textContent = 'Brak wyników.'; statusIndicator.textContent = 'Dane gotowe.';
}

/**
 * Obsługuje brak wyników do wyrenderowania.
 */
function handleNoResultsToRender() {
    resultsInfo.textContent = 'Brak wyników.';
}

/**
 * Obsługuje błąd wyszukiwania.
 */
function handleSearchError(err) {
    console.error('Search error:', err); logAction('search_error', { message: err.message }, 'ERROR');
    statusIndicator.textContent = 'Błąd wyszukiwania.'; resultsInfo.textContent = 'Wystąpił błąd podczas przeszukiwania danych.';
}

/**
 * Obsługuje błąd ładowania danych.
 */
function handleLoadError(error, showProgress) {
    statusIndicator.textContent = 'Błąd ładowania.';
    if (showProgress) showLoadingError('Błąd ładowania danych.');
    logAction('load', { message: error?.message ? String(error.message) : 'Błąd ładowania' }, 'ERROR');
}

/**
 * Kończy proces ładowania danych.
 */
function finalizeLoad(loadStart, showProgress) {
    isLoading = false;
    if (showProgress) {
        setLoadingStatusText(loadErrors.length > 0 ? `Gotowe (błędy: ${loadErrors.length}).` : 'Gotowe.');
        setLoadingProgressPercent(100);
    }
    logAction('load', { ms: Math.round(performance.now() - loadStart), errors: loadErrors.length });
}

let uploadStatusSwapTimer = null;
function setUploadStatusText(nextText, { animate = true } = {}) {
    if (!uploadStatus) return;
    const next = String(nextText ?? '');
    if (!animate) {
        uploadStatus.textContent = next;
        uploadStatus.classList.remove('qe-text-swap-out');
        uploadStatus.classList.add('qe-text-swap-in');
        return;
    }
    if (uploadStatus.textContent === next) return;
    if (uploadStatusSwapTimer) { window.clearTimeout(uploadStatusSwapTimer); uploadStatusSwapTimer = null; }
    uploadStatus.classList.remove('qe-text-swap-in');
    uploadStatus.classList.add('qe-text-swap-out');
    uploadStatusSwapTimer = window.setTimeout(() => {
        uploadStatus.textContent = next;
        uploadStatus.classList.remove('qe-text-swap-out');
        uploadStatus.classList.add('qe-text-swap-in');
        uploadStatusSwapTimer = null;
    }, 140);
}

/**
 * Finalizuje import plików.
 */
async function finalizeFileImport(summary, before) {
    summary.records = Math.max(0, allData.length - before); if (uploadProgress) uploadProgress.value = 100;
    setUploadStatusText('Import zakończony.'); logAction('import', { files: summary.files.length, records: summary.records, errors: summary.errors }, 'INFO');
    displayImportSummary(summary); fileCountSpan.textContent = String((await getRouteSpreadsheetFiles()).length);
    setSearchEnabled(allData.length > 0); if (lastQuery && lastQuery.trim().length >= 3 && isSearchEnabled) performSearch(lastQuery.trim());
    schedulePredictiveIndexRebuild({ reason: 'import_done' });
}

/**
 * Przełącza stan ładowania interfejsu importu.
 */
function setImportLoadingState(loading, total = 0) {
    if (loading) { uploadProgressContainer.classList.remove('hidden'); if (uploadProgress) uploadProgress.value = 0; setUploadStatusText(`Import: ${total} plik(ów)...`, { animate: false }); }
    else window.setTimeout(() => uploadProgressContainer.classList.add('hidden'), 900);
}

/**
 * Przechodzi do widoku głównego aplikacji.
 */
function continueToApp() {
    stopLoadingScreen();
    try { history.replaceState({ view: 'home', search: false }, '', '#home'); }
    catch (e) { logAction('navigation', { error: 'replaceState failed', msg: e.message }, 'WARN'); }
    const elapsed = performance.now() - DOM_READY_TS;
    window.setTimeout(() => {
        if (appShell) { appShell.classList.remove('app-shell-hidden'); appShell.setAttribute('aria-hidden', 'false'); }
        if (isSearchEnabled) searchInput.focus();
        window.requestAnimationFrame(() => updateScrollIndicator());
    }, Math.max(0, 300 - elapsed));
}

/**
 * Powraca do głównego widoku wyszukiwania.
 */
function goHome() {
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (searchView) searchView.classList.remove('view-hidden');
    if (isSearchEnabled) searchInput.focus();
    window.requestAnimationFrame(() => updateScrollIndicator());
}

/**
 * Resetuje aplikację do stanu początkowego.
 */
function resetToInitialState({ source } = {}) {
    const now = Date.now(); if (now - lastHomeResetTs < 450) return; lastHomeResetTs = now;
    if (debouncedSearchRef?.cancel) debouncedSearchRef.cancel(); if (debouncedLogSearchRef?.cancel) debouncedLogSearchRef.cancel();
    if (searchInput) searchInput.value = ''; clearResults();
    const thead = document.getElementById('table-header'), tbody = document.getElementById('table-body');
    clearElement(thead); clearElement(tbody);
    if (previewMeta) { previewMeta.textContent = ''; previewMeta.classList.add('hidden'); }
    const previewFilename = document.getElementById('preview-filename'); if (previewFilename) previewFilename.replaceChildren();
    goHome(); logClientEvent('home', { source: source || 'unknown' });
}

//////////////////////////////////////////////////
// FUNKCJE FORMATOWANIA TEKSTU / DANYCH
//////////////////////////////////////////////////

/**
 * Czyści nazwę pliku z fragmentów w nawiasach i rozszerzenia.
 */
function formatFileName(fileName) {
    let name = fileName.replace(/\s*\([^)]*\)/g, '');
    name = name.replace(/\.xlsx$/i, '');
    return name.replace(/\s+/g, ' ').trim();
}

/**
 * Formatuje nazwę trasy dla listy wyników.
 */
function formatRouteNameForResults(fileName) {
    const base = String(fileName || '').replace(/\.xlsx$/i, '').replace(/\s+/g, ' ').trim();
    const match = base.match(/\btrasa\b\s*([A-Za-zĄĆĘŁŃÓŚŹŻ0-9]+(?:\s*[-–]\s*\d+)?)\b/i);
    if (match && match[1]) {
        const code = match[1].replace(/\s*[-–]\s*/g, '-').replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻ0-9-]/g, '').toUpperCase();
        if (code) return `TRASA ${code}`;
    }
    return base.replace(/[\[\]\{\}]/g, '').replace(/\([^)]*\)/g, '').replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, '').replace(/[^\p{L}\p{N}\s-]+/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function getRouteCategoriesFromFileName(fileName) {
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

/**
 * Formatuje tekst do postaci Title Case.
 */
function toTitleCase(text) {
    if (!text) return '';
    return text.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Podświetla szukane zapytanie w tekście.
 */
function highlightText(text, query) {
    if (!query) return text;
    const normText = fuzzyNormalizeText(text), normQuery = fuzzyNormalizeText(query);
    if (!normQuery) return text;
    let result = '', lastIdx = 0, idx = normText.indexOf(normQuery);
    while (idx !== -1) {
        result += escapeHtml(text.slice(lastIdx, idx));
        result += `<span class="highlight">${escapeHtml(text.slice(idx, idx + normQuery.length))}</span>`;
        lastIdx = idx + normQuery.length; idx = normText.indexOf(normQuery, lastIdx);
    }
    result += escapeHtml(text.slice(lastIdx)); return result;
}

/**
 * Normalizuje tekst do małych liter.
 */
function normalizeText(text) {
    return String(text ?? '').toLowerCase().trim();
}

/**
 * Normalizuje tekst usuwając polskie znaki diakrytyczne.
 */
function fuzzyNormalizeText(text) {
    return normalizeText(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
}

/**
 * Formatuje wartość komórki (obsługa czasu Excela).
 */
function formatCellValue(value) {
    if (value === null || value === undefined) return '';
    let num = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed !== '' && /^-?\d*\.?\d+$/.test(trimmed)) num = parseFloat(trimmed);
    }
    if (typeof num === 'number' && Number.isFinite(num)) {
        if (num > 0 && num < 1) return formatTimeFromDayFraction(num);
        if (num >= 1000 && num < 60000) {
            const frac = num % 1; if (frac > 0 && frac < 1) return formatTimeFromDayFraction(frac);
        }
    }
    const asString = String(value).trim(), timeParsed = parseTimeString(asString);
    return timeParsed || asString;
}

/**
 * Konwertuje ułamek doby na format czasu HH:MM.
 */
function formatTimeFromDayFraction(fraction) {
    const totalMinutes = Math.round(fraction * 24 * 60);
    const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

/**
 * Parsuje ciąg znaków do formatu czasu.
 */
function parseTimeString(value) {
    const match = String(value).trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?(?:[.,]\d+)?$/);
    if (!match) return null;
    const hours = Number(match[1]), minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${pad2(hours)}:${pad2(minutes)}`;
}

/**
 * Formatuje znacznik czasu na czytelną datę i czas.
 */
function pad2(value) {
    return String(value).padStart(2, '0');
}

/**
 * Zabezpiecza tekst przed atakami XSS.
 */
function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * Konwertuje wartość komórki na tekst nagłówka.
 */
function cellToHeaderText(cell) {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') return cell.trim();
    return parseTimeString(String(cell)) || String(cell).trim();
}

/**
 * Formatuje zawartość komórki zgodnie z jej typem.
 */
function formatCellContent(cell, idx, headerMap) {
    if (idx === headerMap['NR_POL']) { const val = parseInt(cell); return isNaN(val) ? '' : val; }
    const formatted = formatCellValue(cell);
    if (idx === headerMap['GODZ']) return (formatted === '' || formatted === '-') ? '-' : formatted;
    return formatted;
}

//////////////////////////////////////////////////
// FUNKCJE ANIMACJI I EFEKTÓW WIZUALNYCH
//////////////////////////////////////////////////

/**
 * Buduje kod SVG logo QuickEvo.
 */
function buildQuickEvoLogoSvg({ size }) {
    const { primary, textStrong, textSoft } = getLogoPalette();
    const fontSize = size === 'header' ? 40 : 56, lineY = size === 'header' ? 14 : 18, textY = size === 'header' ? 4 : 0;
    const prefix = `qe${++logoInstanceCounter}`;
    return `<svg viewBox="0 0 640 180" role="img" aria-label="QuickEvo" xmlns="http://www.w3.org/2000/svg" data-qe-logo-size="${size}"><defs><linearGradient id="${prefix}Grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}" stop-opacity="0.95"></stop><stop offset="1" stop-color="${primary}" stop-opacity="0.35"></stop></linearGradient><filter id="${prefix}Soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur"></feGaussianBlur><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0" result="soft"></feColorMatrix><feMerge><feMergeNode in="soft"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs><g transform="translate(72 90)" filter="url(#${prefix}Soft)"><circle class="qe-pulse" cx="0" cy="0" r="34" fill="url(#${prefix}Grad)"></circle><circle cx="0" cy="0" r="52" fill="none" stroke="${primary}" stroke-opacity="0.35" stroke-width="3"></circle><g class="qe-orbit" data-qe-orbit="1"><circle class="qe-orbit-dot qe-orbit-dot--a" data-qe-orbit-dot="a" cx="52" cy="0" r="6" fill="${primary}"></circle><circle class="qe-orbit-dot qe-orbit-dot--b" data-qe-orbit-dot="b" cx="-26" cy="45" r="4" fill="${primary}" fill-opacity="0.75"></circle></g></g><g transform="translate(150 110)"><text x="0" y="${textY}" font-family="Segoe UI, system-ui, -apple-system, Arial" font-size="${fontSize}" font-weight="800" fill="${textStrong}">Quick<tspan font-weight="300" fill="${textSoft}">Evo</tspan></text><path d="M0 ${lineY} H460" stroke="${primary}" stroke-opacity="0.30" stroke-width="3" stroke-linecap="round"></path></g></svg>`;
}

/**
 * Uruchamia animację orbity w logo.
 */
function startLogoOrbit(svg, size) {
    if (!svg || logoOrbitControllers.has(svg) || shouldReduceMotion()) return;
    const orbitGroup = svg.querySelector('g[data-qe-orbit="1"]'); if (!orbitGroup) return;
    const dotA = orbitGroup.querySelector('[data-qe-orbit-dot="a"]'), dotB = orbitGroup.querySelector('[data-qe-orbit-dot="b"]');
    if (!dotA || !dotB) return;
    let cfg = getLogoOrbitConfig(size), lastCfgTs = 0; const startTs = performance.now();
    const tick = (ts) => {
        if (!svg.isConnected || shouldReduceMotion()) { logoOrbitControllers.delete(svg); return; }
        if ((ts - lastCfgTs) > 700) { cfg = getLogoOrbitConfig(size); lastCfgTs = ts; }
        const t = (ts - startTs) / 1000, theta = cfg.dir * (t / cfg.period) * Math.PI * 2;
        dotA.setAttribute('cx', (cfg.radius * Math.cos(theta)).toFixed(2)); dotA.setAttribute('cy', (cfg.radius * Math.sin(theta)).toFixed(2));
        dotB.setAttribute('cx', (cfg.radius * 0.72 * Math.cos(theta + 2.05)).toFixed(2)); dotB.setAttribute('cy', (cfg.radius * 0.72 * Math.sin(theta + 2.05)).toFixed(2));
        logoOrbitControllers.set(svg, { rafId: window.requestAnimationFrame(tick) });
    };
    logoOrbitControllers.set(svg, { rafId: window.requestAnimationFrame(tick) });
}

/**
 * Uruchamia animację orbity w kontenerze.
 */
function startLogoOrbitInContainer(container, size) {
    const svg = container?.querySelector('svg'); if (svg) startLogoOrbit(svg, size);
}

/**
 * Pobiera konfigurację animacji orbity.
 */
function getLogoOrbitConfig(size) {
    const rootStyle = getComputedStyle(document.documentElement);
    const radius = parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-radius-${size}`), 52);
    const period = Math.max(0.2, parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-period-${size}`), size === 'header' ? 4.8 : 3.2));
    const dir = parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-direction-${size}`), 1) >= 0 ? 1 : -1;
    return { radius, period, dir };
}

/**
 * Pobiera paletę kolorów dla logo na podstawie motywu.
 */
function getLogoPalette() {
    const bodyStyle = getComputedStyle(document.body);
    const primary = bodyStyle.getPropertyValue('--primary-color').trim() || '#0066CC';
    const baseTextColor = bodyStyle.getPropertyValue('--text-color').trim() || '#333333';
    const isMatrix = document.body.classList.contains('matrix-theme') || Boolean(window.isMatrixThemeActive);
    // W trybie MATRIX® oba logotypy (header + ekran powitalny) muszą używać tej samej palety neonowej zieleni.
    if (isMatrix) return { primary, textStrong: 'rgba(0, 255, 65, 0.92)', textSoft: 'rgba(0, 255, 65, 0.72)' };
    const isDark = document.body.classList.contains('dark-theme');
    return { primary, textStrong: isDark ? 'rgba(255, 255, 255, 0.92)' : baseTextColor, textSoft: isDark ? 'rgba(255, 255, 255, 0.78)' : baseTextColor };
}

/**
 * Parsuje wartość liczbową z CSS.
 */
function parseCssNumber(value, fallback) {
    const n = parseFloat(String(value ?? '').trim()); return Number.isFinite(n) ? n : fallback;
}

/**
 * Sprawdza, czy użytkownik preferuje zredukowany ruch.
 */
function shouldReduceMotion() {
    try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}

//////////////////////////////////////////////////
// EVENT LISTENERY
//////////////////////////////////////////////////

// Obsługa kliknięć w wyniki (delegacja zdarzeń)
resultsList.addEventListener('click', (e) => {
    const categoryToggle = e.target.closest('.results-category-toggle');
    if (categoryToggle) {
        toggleRouteCategorySection(categoryToggle.dataset.category);
        return;
    }
    const row = e.target.closest('.result-row');
    if (row) {
        const fileName = row.dataset.fileName, rowIndex = parseInt(row.dataset.rowIndex);
        if (fileName && !isNaN(rowIndex)) showFilePreview(fileName, rowIndex); return;
    }
    const group = e.target.closest('.result-group');
    if (group) {
        const index = parseInt(group.dataset.index), groupData = currentResults[index];
        if (groupData) showFilePreview(groupData.fileName, groupData.items[0].rowIndex);
    }
});

// Obsługa wskaźnika przewijania
if (scrollIndicator) {
    scrollIndicator.addEventListener('click', () => {
        if (!resultsList) return;
        const container = getResultsScrollContainer();
        const amount = container.clientHeight * 0.8;
        try { container.scrollBy({ top: amount, behavior: 'smooth' }); }
        catch { window.scrollBy({ top: amount, behavior: 'smooth' }); }
    });
}

//////////////////////////////////////////////////
// UTILITY / FALLBACK
//////////////////////////////////////////////////

/**
 * Rejestruje zdarzenia użytkownika do DebugLog.
 */
function logClientEvent(type, payload) {
    const safeType = String(type || '').slice(0, 64); if (!safeType) return;
    const norm = (val) => {
        if (typeof val === 'string') return normalizeText(val);
        if (!val || typeof val !== 'object') return val;
        if (Array.isArray(val)) return val.map(norm);
        const out = {}; for (const k of Object.keys(val)) out[k] = norm(val[k]); return out;
    };
    logAction(safeType, norm(payload) ?? null, 'INFO');
}

/**
 * Polifill dla funkcji fetch.
 */
function ensureFetchPolyfill() {
    if (typeof window.fetch === 'function') return;
    window.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
        try {
            const xhr = new XMLHttpRequest(); xhr.open(String(opts.method || 'GET').toUpperCase(), url, true); xhr.responseType = 'arraybuffer';
            for (const [k, v] of Object.entries(opts.headers || {})) xhr.setRequestHeader(k, String(v));
            xhr.onload = () => {
                const ab = xhr.response || new ArrayBuffer(0), response = {
                    ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, arrayBuffer: async () => ab,
                    text: async () => new TextDecoder('utf-8').decode(new Uint8Array(ab)),
                    json: async () => JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(ab))), blob: async () => new Blob([ab])
                }; resolve(response);
            };
            xhr.onerror = () => reject(new Error('fetch() polyfill: network error')); xhr.send(opts.body || null);
        } catch (err) { reject(err); }
    });
}

/**
 * Pobiera wartość z localStorage.
 */
function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch { }
    return memoryStorage.get(key) || null;
}

/**
 * Zapisuje wartość w localStorage.
 */
function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return; } catch { }
    memoryStorage.set(key, String(value));
}

/**
 * Czyści zawartość elementu DOM.
 */
function clearElement(el) { if (el) el.replaceChildren(); }

/**
 * Bezpiecznie ustawia HTML elementu.
 */
function setElementHtml(el, html) {
    if (!el) return;
    const doc = htmlDomParser.parseFromString(`<div>${String(html ?? '')}</div>`, 'text/html'), wrapper = doc.body?.firstElementChild;
    if (wrapper) el.replaceChildren(...Array.from(wrapper.childNodes)); else clearElement(el);
}

/**
 * Bezpiecznie ustawia SVG elementu.
 */
function setElementSvg(el, svgSource) {
    if (!el) return; const source = String(svgSource ?? '').trim(); if (!source) { clearElement(el); return; }
    const doc = svgDomParser.parseFromString(source, 'image/svg+xml'), root = doc.documentElement;
    if (root && root.nodeName.toLowerCase() === 'svg') el.replaceChildren(document.importNode(root, true)); else clearElement(el);
}

/**
 * Funkcja debounce.
 */
function debounce(fn, delayMs) {
    let timerId = null; const debounced = (...args) => { if (timerId) clearTimeout(timerId); timerId = setTimeout(() => fn(...args), delayMs); };
    debounced.cancel = () => { if (timerId) clearTimeout(timerId); timerId = null; }; return debounced;
}

/**
 * Wykonuje zadania z ograniczoną współbieżnością.
 */
async function runWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : []; let idx = 0;
    const workers = new Array(Math.min(limit || 1, list.length)).fill(null).map(async () => {
        while (true) { const i = idx++; if (i >= list.length) break; await worker(list[i], i); }
    });
    await Promise.all(workers);
}

/**
 * Otwiera połączenie z IndexedDB.
 */
function openDocsDb() {
    if (docsDbPromise) return docsDbPromise;
    docsDbPromise = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(DOCS_DB_NAME, DOCS_DB_VERSION);
            const timeout = window.setTimeout(() => {
                docsDbPromise = null;
                reject(new Error('Timeout otwierania IndexedDB'));
            }, DOCS_DB_OPEN_TIMEOUT_MS);
            req.onblocked = () => alert('Zamknij inne karty z tą aplikacją.');
            req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DOCS_DB_STORE)) req.result.createObjectStore(DOCS_DB_STORE, { keyPath: 'name' }); };
            req.onsuccess = () => { window.clearTimeout(timeout); resolve(req.result); };
            req.onerror = () => { window.clearTimeout(timeout); docsDbPromise = null; reject(req.error); };
        } catch (err) { reject(err); }
    });
    return docsDbPromise;
}

/**
 * Pobiera listę plików z bazy.
 */
async function docsListFiles() {
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_DB_STORE, 'readonly'), req = tx.objectStore(DOCS_DB_STORE).getAll();
        req.onsuccess = () => resolve((Array.isArray(req.result) ? req.result : []).map(r => ({ name: String(r?.name ?? ''), size: Number(r?.size ?? (r?.blob?.size ?? 0)), updatedAt: Number(r?.updatedAt ?? 0) })).filter(r => r.name));
        req.onerror = () => reject(req.error);
    });
}

/**
 * Sprawdza, czy plik istnieje w bazie.
 */
async function docsFileExists(fileName) {
    const db = await openDocsDb();
    return await new Promise((resolve) => {
        const req = db.transaction(DOCS_DB_STORE, 'readonly').objectStore(DOCS_DB_STORE).get(fileName);
        req.onsuccess = () => resolve(!!req.result); req.onerror = () => resolve(false);
    });
}

/**
 * Pobiera Blob pliku z bazy.
 */
async function docsGetBlob(fileName) {
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const req = db.transaction(DOCS_DB_STORE, 'readonly').objectStore(DOCS_DB_STORE).get(String(fileName || ''));
        req.onsuccess = () => resolve(req.result?.blob ?? null); req.onerror = () => reject(req.error);
    });
}

/**
 * Pobiera rekord pliku (metadane) z bazy.
 * Zwraca null, jeśli plik nie istnieje.
 */
async function docsGetFileRecord(fileName) {
    const safe = String(fileName || '').trim();
    if (!safe) return null;
    const db = await openDocsDb();
    return await new Promise((resolve, reject) => {
        const req = db.transaction(DOCS_DB_STORE, 'readonly').objectStore(DOCS_DB_STORE).get(safe);
        req.onsuccess = () => {
            const r = req.result;
            if (!r) { resolve(null); return; }
            resolve({
                name: String(r?.name ?? ''),
                size: Number(r?.size ?? (r?.blob?.size ?? 0)),
                updatedAt: Number(r?.updatedAt ?? 0),
                driveModifiedAt: Number(r?.driveModifiedAt ?? 0) || null
            });
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Zapisuje Blob pliku w bazie.
 */
async function docsPutBlob(fileName, blob, { driveModifiedAt } = {}) {
    const safe = String(fileName || '').trim(); if (!safe) throw new Error('Brak nazwy pliku');
    const normalizedDriveModifiedAt = (Number.isFinite(Number(driveModifiedAt)) && Number(driveModifiedAt) > 0) ? Number(driveModifiedAt) : null;
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const req = db.transaction(DOCS_DB_STORE, 'readwrite').objectStore(DOCS_DB_STORE).put({
            name: safe,
            blob,
            size: blob?.size ?? 0,
            updatedAt: Date.now(),
            driveModifiedAt: normalizedDriveModifiedAt
        });
        req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
}

async function docsClearFilesStore() {
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_DB_STORE, 'readwrite');
        const req = tx.objectStore(DOCS_DB_STORE).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function docsDeleteFiles(fileNames) {
    const names = Array.isArray(fileNames) ? fileNames.map(n => String(n || '').trim()).filter(Boolean) : [];
    if (names.length === 0) return { deleted: 0 };
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_DB_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Błąd transakcji IndexedDB'));
        tx.onabort = () => reject(tx.error || new Error('Transakcja IndexedDB przerwana'));
        const store = tx.objectStore(DOCS_DB_STORE);
        for (const name of names) store.delete(name);
    });
    return { deleted: names.length };
}

function pickRandomSample(list, count) {
    const arr = Array.isArray(list) ? list.slice() : [];
    const n = Math.max(0, Math.min(arr.length, Number(count) || 0));
    for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr.slice(0, n);
}

async function qeDevClearDbFilesStore() {
    await docsClearFilesStore();
    resetAppData();
    scheduleCacheByMonth = new Map();
    loadedScheduleFiles = new Set();
    clearResults();
    setSearchEnabled(false);
    if (fileCountSpan) fileCountSpan.textContent = '0';
    if (statusIndicator) { statusIndicator.textContent = 'Baza wyczyszczona.'; statusIndicator.classList.remove('status--hint'); }
    try { resetToInitialState({ source: 'dev_clear_db' }); } catch { }
    schedulePredictiveIndexRebuild({ reason: 'dev_clear_db' });
    return { ok: true };
}

async function qeDevClearRandomFiles({ fraction = 0.2 } = {}) {
    const safeFraction = Math.max(0, Math.min(1, Number(fraction)));
    const list = await docsListFiles();
    const names = Array.isArray(list) ? list.map(r => String(r?.name ?? '').trim()).filter(Boolean) : [];
    const total = names.length;
    if (total === 0) return { ok: true, total: 0, deleted: 0 };
    const count = Math.max(1, Math.floor(total * safeFraction));
    const toDelete = pickRandomSample(names, count);
    const res = await docsDeleteFiles(toDelete);
    for (const name of toDelete) {
        removeFileData(name);
        if (isScheduleFileName(name)) {
            loadedScheduleFiles.delete(name);
            const meta = parseScheduleFileNameYearMonth(name);
            if (meta?.key) scheduleCacheByMonth.delete(meta.key);
        } else {
            loadedFiles.delete(name);
        }
    }
    clearResults();
    setSearchEnabled(allData.length > 0);
    try { resetToInitialState({ source: 'dev_clear_rnd' }); } catch { }
    if (fileCountSpan) fileCountSpan.textContent = String((await getRouteSpreadsheetFiles()).length);
    if (statusIndicator) {
        statusIndicator.textContent = allData.length > 0 ? 'Dane gotowe.' : 'Brak danych.';
        statusIndicator.classList.toggle('status--hint', allData.length === 0);
    }
    schedulePredictiveIndexRebuild({ reason: 'dev_clear_rnd' });
    return { ok: true, total, deleted: res?.deleted ?? toDelete.length };
}

try {
    const api = Object.freeze({
        clearFilesStore: qeDevClearDbFilesStore,
        clearRandomFiles: qeDevClearRandomFiles
    });
    Object.defineProperty(window, 'QE_DevTools', { value: api, writable: false, configurable: false });
} catch {
    window.QE_DevTools = { clearFilesStore: qeDevClearDbFilesStore, clearRandomFiles: qeDevClearRandomFiles };
}

/**
 * Liczy niepuste komórki w wierszu.
 */
function countNonEmpty(row) {
    if (!Array.isArray(row)) return 0; let n = 0; for (const cell of row) if (!isEmptyCell(cell)) n += 1; return n;
}

/**
 * Sprawdza, czy komórka jest pusta.
 */
function isEmptyCell(cell) { return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === ''); }

/**
 * Bezpiecznie ustawia focus na body.
 */
function focusBodySafely() {
    const body = document.body; if (!body) return; const prev = body.getAttribute('tabindex');
    body.setAttribute('tabindex', '-1'); try { body.focus({ preventScroll: true }); } catch { }
    if (prev == null) body.removeAttribute('tabindex'); else body.setAttribute('tabindex', prev);
}

/**
 * Kolejkuje zdarzenie gotowości podglądu.
 */
function queuePreviewReadyEvent(fileName) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('qe:preview-ready', { detail: { fileName: String(fileName || '') } }))));
}

/**
 * Obsługuje wejście wyszukiwania.
 */
function handleSearchInput(query, debouncedSearch, debouncedLogSearch) {
    const isSearchActive = query.length >= 3, currentHistoryState = history.state || {};
    if (isSearchActive) {
        if (!currentHistoryState.search) {
            try { history.pushState({ view: 'home', search: true, query }, '', '#search'); } catch (e) { logAction('navigation', { error: 'pushState search failed', msg: e.message }, 'WARN'); }
        } else try { history.replaceState({ view: 'home', search: true, query }, '', '#search'); } catch (e) { }
        debouncedSearch(query); debouncedLogSearch(query);
    } else {
        debouncedSearch.cancel(); debouncedLogSearch.cancel();
        if (currentHistoryState.search) try { history.replaceState({ view: 'home', search: false }, '', '#home'); } catch (e) { }
        if (query.length > 0) { statusIndicator.textContent = 'Wpisz minimum 3 znaki, aby wyszukać...'; statusIndicator.classList.add('status--hint'); }
        else { statusIndicator.textContent = 'Dane gotowe.'; statusIndicator.classList.remove('status--hint'); }
        clearResults();
    }
}

//////////////////////////////////////////////////
// PREDYKCJA / PODPOWIEDZI WPISYWANEJ FRAZY
//////////////////////////////////////////////////

const PREDICT_MIN_CHARS = 2;
const PREDICT_MAX_OPTIONS = 14;
const PREDICT_BUCKET_PREFIX_LEN = 2;

const PREDICT_TYPE_WEIGHT = Object.freeze({
    address: 330,
    facility: 300,
    route: 270
});

const PREDICT_MATCH_WEIGHT = Object.freeze({
    exactPrefix: 250,
    exactWord: 200,
    caseInsensitivePrefix: 150,
    substring: 50,
    fuzzy: 20
});

/**
 * Planista przebudowy indeksu podpowiedzi, aby nie wykonywać kosztownej pracy wielokrotnie podczas importu.
 */
function schedulePredictiveIndexRebuild({ reason } = {}) {
    if (predictiveIndexBuildTimer) window.clearTimeout(predictiveIndexBuildTimer);
    predictiveIndexBuildTimer = window.setTimeout(() => {
        predictiveIndexBuildTimer = null;
        rebuildPredictiveIndex({ reason: reason || 'unknown' });
    }, 0);
}

/**
 * Przebudowuje indeks podpowiedzi na podstawie aktualnie załadowanych danych.
 */
function rebuildPredictiveIndex({ reason } = {}) {
    const addressMap = new Map();
    const facilityMap = new Map();
    const routeMap = new Map();
    const fileNames = new Set();

    for (const item of (Array.isArray(allData) ? allData : [])) {
        const safeFileName = String(item?.fileName || '').trim();
        if (safeFileName) fileNames.add(safeFileName);

        if (!item?.isComplete || !item?.headerMap || !Array.isArray(item?.cells)) continue;
        const h = item.headerMap;

        const address = String(item.cells[h.ADRES] || '').trim();
        if (address) addPredictiveValueWithVariants(addressMap, address);

        const facility = String(item.cells[h.NAZWA_PLACOWKI] || '').trim();
        if (facility) addPredictiveValueWithVariants(facilityMap, facility);
    }

    for (const fn of fileNames) {
        const routeName = String(formatRouteNameForResults(fn) || '').trim();
        if (routeName) addPredictiveValueWithVariants(routeMap, routeName);
    }

    predictiveIndex = {
        builtAt: Date.now(),
        reason: String(reason || ''),
        buckets: {
            address: buildPredictiveBuckets(addressMap, 'address'),
            facility: buildPredictiveBuckets(facilityMap, 'facility'),
            route: buildPredictiveBuckets(routeMap, 'route')
        }
    };
    predictiveSuggestionsCache.clear();
}

/**
 * Dodaje wartość do mapy deduplikującej po fuzzy-normalizacji.
 */
function addPredictiveValue(map, rawValue) {
    const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const key = fuzzyNormalizeText(value);
    if (!key) return;
    const prev = map.get(key);
    if (!prev) map.set(key, { value, count: 1 });
    else prev.count += 1;
}

/**
 * Dodaje wartość i jej warianty tokenowe (np. „Jerozolimskie 96” z pełnego adresu),
 * aby predykcja działała także dla wpisywania od środka frazy.
 */
function addPredictiveValueWithVariants(map, rawValue) {
    const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    addPredictiveValue(map, value);

    const tokenRe = /[^\s,.;:/\\\-–—()]+/g;
    const matches = Array.from(value.matchAll(tokenRe));
    if (matches.length <= 1) return;

    const maxVariants = 8;
    let added = 0;
    for (let i = 1; i < matches.length && added < maxVariants; i++) {
        const idx = matches[i]?.index;
        if (typeof idx !== 'number' || idx < 0) continue;
        const phrase = value.slice(idx).trimStart();
        if (phrase.length < PREDICT_MIN_CHARS) continue;
        addPredictiveValue(map, phrase);
        added += 1;
    }
}

/**
 * Buduje kubełki podpowiedzi na podstawie prefiksu, aby zapytania były szybkie.
 */
function buildPredictiveBuckets(map, type) {
    const bucketMaps = new Map();

    const addToBucket = (bucketKey, cand) => {
        const key = String(bucketKey || '').slice(0, PREDICT_BUCKET_PREFIX_LEN);
        if (!key) return;
        let inner = bucketMaps.get(key);
        if (!inner) { inner = new Map(); bucketMaps.set(key, inner); }
        inner.set(cand.fuzzy, cand);
    };

    for (const [fuzzy, meta] of map.entries()) {
        const baseFuzzy = String(fuzzy || '');
        if (!baseFuzzy) continue;
        const cand = { type, value: meta.value, fuzzy, count: meta.count };
        addToBucket(baseFuzzy, cand);

        const tokens = baseFuzzy.split(/[\s,.;:/\\\-–—()]+/g).filter(t => t.length >= PREDICT_MIN_CHARS);
        for (const t of tokens) addToBucket(t, cand);
    }

    const buckets = new Map();
    for (const [k, inner] of bucketMaps.entries()) {
        const list = Array.from(inner.values());
        list.sort((a, b) => (b.count - a.count) || String(a.value).localeCompare(String(b.value), 'pl', { sensitivity: 'base' }));
        buckets.set(k, list);
    }
    return buckets;
}

/**
 * Aktualizuje podpowiedź inline (wyszarzony suffix) dla aktualnej frazy.
 */
function updatePredictiveSuggestions(query, { source } = {}) {
    if (predictiveIsComposing) return;
    if (!ghostOverlay || !ghostPrefix || !ghostSuffix || !searchInput) return;

    const raw = String(query ?? '');
    const norm = raw.trim();
    const changed = raw !== predictiveUiState.raw;
    
    if (changed) {
        predictiveUiState = { raw, norm, options: [], index: 0, hidden: false };
        // Pokaż stan ładowania jeśli zapytanie jest wystarczająco długie
        if (norm.length >= PREDICT_MIN_CHARS) {
            ghostOverlay.classList.remove('is-hidden');
            ghostOverlay.classList.add('qe-ghost-loading');
        }
    } else { 
        predictiveUiState.raw = raw; 
        predictiveUiState.norm = norm; 
    }

    if (!isSearchEnabled || norm.length < PREDICT_MIN_CHARS || raw !== norm) {
        predictiveUiState.hidden = true;
        hideGhostOverlay();
        return;
    }

    if (!predictiveIndex) {
        schedulePredictiveIndexRebuild({ reason: 'predictive_lazy' });
        predictiveUiState.hidden = true;
        hideGhostOverlay();
        return;
    }

    const cached = predictiveSuggestionsCache.get(norm);
    const options = cached || computePredictiveSuggestions(norm, PREDICT_MAX_OPTIONS);
    if (!cached) predictiveSuggestionsCache.set(norm, options);

    ghostOverlay.classList.remove('qe-ghost-loading');
    predictiveUiState.options = Array.isArray(options) ? options : [];
    if (predictiveUiState.index >= predictiveUiState.options.length) predictiveUiState.index = 0;

    if (source === 'input') predictiveUiState.index = 0;

    renderGhostOverlay();
}

/**
 * Wylicza listę podpowiedzi z priorytetem: adresy, placówki, trasy.
 */
function computePredictiveSuggestions(query, limit) {
    const q = String(query || '').trim();
    const qf = fuzzyNormalizeText(q);
    if (!qf || qf.length < PREDICT_MIN_CHARS || !predictiveIndex?.buckets) return [];

    const bucketKey = qf.slice(0, PREDICT_BUCKET_PREFIX_LEN);
    if (!bucketKey) return [];

    const scored = [];
    scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.address?.get(bucketKey), q, qf, 'address');
    scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.facility?.get(bucketKey), q, qf, 'facility');
    scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.route?.get(bucketKey), q, qf, 'route');

    scored.sort((a, b) => (b.score - a.score) || String(a.value).localeCompare(String(b.value), 'pl', { sensitivity: 'base' }));

    const out = [];
    const seen = new Set();
    for (const row of scored) {
        const v = String(row.value || '').trim();
        if (!v) continue;
        if (!predictiveCandidateStartsWithQuery(q, v)) continue;
        if (v.length <= q.length) continue;
        const k = fuzzyNormalizeText(v);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(v);
        if (out.length >= (Number(limit || 0) || PREDICT_MAX_OPTIONS)) break;
    }
    return out;
}

function predictiveCandidateStartsWithQuery(query, candidate) {
    const q = String(query ?? '').trim();
    const c = String(candidate ?? '').trim();
    if (!q || !c) return false;
    const qf = fuzzyNormalizeText(q);
    const cf = fuzzyNormalizeText(c);
    return cf.startsWith(qf);
}

/**
 * Oblicza wagę dla kandydata na podstawie dopasowania do zapytania.
 */
function scorePredictiveCandidatesInto(target, candidates, q, qf, type) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return;

    const typeWeight = PREDICT_TYPE_WEIGHT[type] || 0;
    const maxScan = 2000; // Zwiększony limit skanowania dla lepszej jakości
    
    for (let i = 0; i < list.length && i < maxScan; i++) {
        const c = list[i];
        const value = String(c?.value || '');
        const fuzzyValue = String(c?.fuzzy || '');
        if (!value || !fuzzyValue) continue;

        let matchWeight = 0;
        
        // 1. Exact prefix match (z uwzględnieniem wielkości liter jeśli to możliwe, ale tu mamy głównie fuzzy)
        if (value.startsWith(q)) {
            matchWeight = PREDICT_MATCH_WEIGHT.exactPrefix;
        } 
        // 2. Exact word match / Case-insensitive prefix
        else if (fuzzyValue.startsWith(qf)) {
            matchWeight = PREDICT_MATCH_WEIGHT.caseInsensitivePrefix;
        }
        // 3. Exact word match (początek słowa wewnątrz frazy)
        else if (fuzzyValue.includes(` ${qf}`)) {
            matchWeight = PREDICT_MATCH_WEIGHT.exactWord;
        }
        // 4. Substring match
        else if (fuzzyValue.includes(qf)) {
            matchWeight = PREDICT_MATCH_WEIGHT.substring;
        }
        // 5. Fuzzy match (jeśli zapytanie jest wystarczająco długie)
        else if (qf.length >= 4) {
            const fuzzyScore = getFuzzyScore(qf, fuzzyValue);
            if (fuzzyScore > 0.7) {
                matchWeight = PREDICT_MATCH_WEIGHT.fuzzy * fuzzyScore;
            } else {
                continue;
            }
        } else {
            continue;
        }

        // Dodatkowa premia za częstotliwość (logarytmiczna)
        const freqBonus = Math.min(50, Math.round(Math.log2(Math.max(1, Number(c.count || 1))) * 10));
        
        target.push({ 
            value: c.value, 
            score: typeWeight + matchWeight + freqBonus 
        });
    }
}

function renderGhostOverlay() {
    if (!ghostOverlay || !ghostPrefix || !ghostSuffix || !searchInput) return;

    if (predictiveUiState.hidden) { hideGhostOverlay(); return; }

    const query = String(predictiveUiState.raw || '');
    const suggestion = predictiveUiState.options[predictiveUiState.index] || '';
    
    if (!query || !suggestion || suggestion.length <= query.length || 
        String(predictiveUiState.norm || '') !== query || 
        !predictiveCandidateStartsWithQuery(predictiveUiState.norm, suggestion)) { 
        
        // Nie ukrywaj jeśli trwa ładowanie
        if (!ghostOverlay.classList.contains('qe-ghost-loading')) {
            hideGhostOverlay(); 
        }
        return; 
    }

    const selStart = Number(searchInput.selectionStart ?? 0);
    const selEnd = Number(searchInput.selectionEnd ?? 0);
    if (selStart !== selEnd || selEnd !== query.length) { hideGhostOverlay(); return; }

    ghostOverlay.classList.remove('qe-ghost-loading');
    ghostPrefix.textContent = query;
    ghostSuffix.textContent = String(suggestion).slice(query.length);
    ghostOverlay.classList.toggle('is-hidden', ghostSuffix.textContent.length === 0);
    syncGhostOverlayScroll();
}

function syncGhostOverlayScroll() {
    if (!ghostOverlay || !searchInput) return;
    ghostOverlay.scrollLeft = searchInput.scrollLeft;
}

function hideGhostOverlay() {
    if (!ghostOverlay || !ghostPrefix || !ghostSuffix) return;
    ghostPrefix.textContent = '';
    ghostSuffix.textContent = '';
    ghostOverlay.classList.remove('qe-ghost-loading');
    ghostOverlay.classList.add('is-hidden');
}

function acceptPredictiveSuggestion() {
    const query = String(predictiveUiState.norm || '').trim();
    const suggestion = predictiveUiState.options[predictiveUiState.index] || '';
    if (!query || !suggestion || suggestion.length <= query.length) return false;
    if (!predictiveCandidateStartsWithQuery(query, suggestion)) return false;
    if (!searchInput) return false;

    searchInput.value = suggestion;
    try { searchInput.setSelectionRange(suggestion.length, suggestion.length); } catch { }
    predictiveUiState = { raw: suggestion, norm: suggestion, options: [], index: 0, hidden: false };
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function handlePredictiveKeydown(e) {
    if (!isSearchEnabled || predictiveIsComposing) return;
    if (!e || !searchInput) return;

    const key = String(e.key || '');
    const raw = String(searchInput.value || '');
    const norm = raw.trim();
    if (norm.length < PREDICT_MIN_CHARS || raw !== norm) return;
    if (!predictiveIndex) { schedulePredictiveIndexRebuild({ reason: 'predictive_lazy_keydown' }); return; }

    updatePredictiveSuggestions(raw, { source: 'keydown' });

    const hasOptions = Array.isArray(predictiveUiState.options) && predictiveUiState.options.length > 0;
    if (!hasOptions) return;

    if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        predictiveUiState.hidden = false;
        const delta = key === 'ArrowDown' ? 1 : -1;
        const n = predictiveUiState.options.length;
        predictiveUiState.index = (predictiveUiState.index + delta + n) % n;
        renderGhostOverlay();
        return;
    }

    const canAccept = (key === 'Tab') || (key === 'Enter') || (key === 'ArrowRight' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey);
    if (canAccept) {
        // Jeśli jest widoczna sugestia, zaakceptuj ją
        if (!ghostOverlay?.classList.contains('is-hidden')) {
            const ok = acceptPredictiveSuggestion();
            if (ok) {
                e.preventDefault();
                return;
            }
        }
    }

    if (key === 'Escape') {
        if (!ghostOverlay?.classList.contains('is-hidden')) {
            e.preventDefault();
            predictiveUiState.hidden = true;
            hideGhostOverlay();
        }
    }
}

/**
 * Obsługuje zbyt krótkie zapytanie wyszukiwania.
 */
function handleSearchShortQuery() {
    statusIndicator.textContent = 'Wpisz minimum 3 znaki, aby wyszukać...';
    statusIndicator.classList.add('status--hint'); clearResults();
}

// Start aplikacji
init();
