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
 * Cache dla wyników wyszukiwania.
 * @type {Map<string, Array>}
 */
let searchCache = new Map();

/**
 * Kontrolery animacji orbit logo.
 * @type {WeakMap<SVGElement, Object>}
 */
const logoOrbitControllers = new WeakMap();

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

//////////////////////////////////////////////////
// KLUCZOWY STAN APLIKACJI
//////////////////////////////////////////////////

/** @type {Array<Object>} Znormalizowane wiersze ze wszystkich załadowanych plików. */
let allData = []; 

/** @type {Array<Object>} Aktualnie wyświetlana strona wyników wyszukiwania. */
let currentResults = []; 

/** @type {Array<Object>} Wszystkie dopasowania dla bieżącego zapytania. */
let matchedResults = []; 

/** @type {number} Indeks zaznaczonego wyniku podczas nawigacji klawiaturą. */
let selectedResultIndex = -1; 

/** @type {string} Ostatnie zapytanie użyte do wyszukiwania. */
let lastQuery = ''; 

/** @type {Set<string>} Zbiór nazw plików, które zostały już przetworzone. */
let loadedFiles = new Set(); 

/** @type {Object<string, Object>} Mapowanie nazwy pliku na pełny model danych tabeli. */
let fullFileData = {}; 

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
    debouncedSearchRef = debouncedSearch;
    debouncedLogSearchRef = debouncedLogSearch;

    searchInput.addEventListener('input', (e) => {
        if (!isSearchEnabled) return;
        const query = e.target.value.trim();
        handleSearchInput(query, debouncedSearch, debouncedLogSearch);
    });

    searchInput.addEventListener('keydown', handleKeyNavigation);
}

/**
 * Konfiguruje listenery importu plików.
 */
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
        syncGDriveButton.addEventListener('click', handleGoogleDriveSync);
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
        const spreadsheetFiles = await getSpreadsheetFiles();
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
 * Pobiera listę plików arkuszy z bazy danych.
 */
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
    await parseSpreadsheet(arrayBuffer, safeName);
    loadedFiles.add(safeName);
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

/**
 * Obsługuje inicjalizację importu z Google Drive.
 */
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
        const accessToken = picked.accessToken;
        const accepted = filterGoogleDriveFiles(pickedFiles, api);
        summary.errors += (pickedFiles.length - accepted.length);
        if (accepted.length === 0) {
            uploadStatus.textContent = 'Google Drive: brak poprawnych plików (.xlsx/.xls).';
            return;
        }
        const toImport = await resolveImportConflicts(accepted);
        if (toImport.length === 0) {
            logAction('import', { source: 'google_drive', phase: 'skipped_by_user' });
            return;
        }
        await importFilesFromGoogleDrive(toImport, api, accessToken, summary);
        finalizeGoogleDriveImport(summary, before);
    } catch (err) {
        handleGoogleDriveError(err);
    } finally {
        setGoogleDriveLoadingState(false);
    }
}

/**
 * Importuje pliki z Google Drive przy użyciu tokena.
 */
async function importFilesFromGoogleDrive(accepted, api, accessToken, summary) {
    let done = 0;
    const total = accepted.length;
    uploadStatus.textContent = `Google Drive: importuję ${total} plik(ów)...`;
    await runWithConcurrency(accepted, 2, async (meta) => {
        const name = String(meta.name).trim();
        try {
            uploadStatus.textContent = `Google Drive: pobieram ${formatFileName(name)}...`;
            const ab = await api.downloadFileArrayBuffer(meta.id, accessToken);
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

/**
 * Rozpoczyna synchronizację z Google Drive dla wskazanego folderu.
 */
async function startGoogleDriveSync(files, token) {
    logAction('sync', { phase: 'process', count: files.length });
    const toImport = await resolveImportConflicts(files);
    if (toImport.length === 0) {
        logAction('sync', { phase: 'skipped_by_user' });
        return;
    }
    if (welcomeImportProgress) {
        welcomeImportProgress.classList.remove('hidden');
        clearElement(welcomeProgressList);
    }
    setImportLoadingState(true, toImport.length);
    const summary = { files: [], records: 0, errors: 0 };
    try {
        const before = allData.length;
        let processed = 0;
        for (const file of toImport) {
            const name = file.name;
            const progressItem = createWelcomeProgressItem(name);
            welcomeProgressList.appendChild(progressItem);
            progressItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setLoadingStatusText(`Pobieranie: ${formatFileName(name)}...`);
            if (loadingProgressBar) {
                loadingProgressBar.value = (processed / toImport.length) * 100;
                if (loadingProgressMeta) loadingProgressMeta.textContent = `${Math.round(loadingProgressBar.value)}%`;
            }
            try {
                const buffer = await window.GoogleDriveImport.downloadFileArrayBuffer(file.id, token);
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                await docsPutBlob(name, blob);
                removeFileData(name);
                loadedFiles.delete(name);
                await processFile(name);
                loadedFiles.add(name);
                summary.files.push(name);
                updateWelcomeProgressItem(progressItem, 100, 'Gotowe');
            } catch (err) {
                summary.errors += 1;
                logAction('sync', { fileName: name, message: err.message }, 'ERROR');
                updateWelcomeProgressItem(progressItem, 0, 'Błąd', true);
            } finally {
                processed += 1;
            }
        }
        finalizeFileImport(summary, before);
        setLoadingStatusText('Synchronizacja zakończona');
        if (loadingProgressBar) {
            loadingProgressBar.value = 100;
            if (loadingProgressMeta) loadingProgressMeta.textContent = '100%';
        }
    } catch (err) {
        logAction('sync', { phase: 'fatal_error', message: err.message }, 'ERROR');
        setLoadingStatusText('Błąd synchronizacji');
    } finally {
        setImportLoadingState(false);
    }
}

/**
 * Obsługuje synchronizację z Google Drive (folder stały).
 */
async function handleGoogleDriveSync() {
    const FOLDER_ID = '1tyClIJEDwntOrYCMVYmyR5nR6LNHmN-x';
    logAction('sync', { phase: 'start', folderId: FOLDER_ID });
    try {
        setLoadingStatusText('Łączenie z Google Drive...');
        const token = await window.GoogleDriveImport.getAccessToken();
        setLoadingStatusText('Przeszukiwanie folderów...');
        const files = await window.GoogleDriveImport.crawlFolder(FOLDER_ID, token);
        if (files.length === 0) {
            showModal('Brak plików', 'Nie znaleziono żadnych plików .xlsx w wskazanym folderze Google Drive.');
            return;
        }
        showModal('Potwierdź synchronizację', `Znaleziono <strong>${files.length}</strong> plików .xlsx na Dysku Google. Czy chcesz rozpocząć import?`, [
            { label: 'Rozpocznij import', class: 'modal-btn--primary', onClick: () => startGoogleDriveSync(files, token) },
            { label: 'Anuluj', onClick: () => logAction('sync', { phase: 'cancelled' }) }
        ]);
    } catch (err) {
        logAction('sync', { phase: 'error', message: err.message }, 'ERROR');
        showModal('Błąd synchronizacji', `Wystąpił błąd podczas łączenia z Google Drive: ${err.message}`);
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
    selectedResultIndex = -1;
    try {
        matchedResults = await executeSearch(trimmedQuery);
        if (matchedResults.length === 0) {
            handleNoSearchResults();
            return;
        }
        statusIndicator.textContent = 'Dane gotowe.';
        currentResults = matchedResults;
        renderResults(trimmedQuery, { append: false, startIndex: 0 });
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
    if (searchCache.size > 50) searchCache.delete(searchCache.keys().next().value);
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
 * Filtruje pliki z Google Drive.
 */
function filterGoogleDriveFiles(pickedFiles, api) {
    return pickedFiles.filter(f => {
        const name = String(f?.name || '');
        const ok = typeof api.validateExcelFileName === 'function' ? api.validateExcelFileName(name) : (name.toLowerCase().endsWith('.xlsx') || name.toLowerCase().endsWith('.xls'));
        if (!ok) logAction('import', { source: 'google_drive', fileName: name, reason: 'extension' }, 'WARN');
        return ok;
    }).map(f => ({ id: String(f.id), name: String(f.name), mimeType: String(f.mimeType) }));
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
    allData = []; currentResults = []; selectedResultIndex = -1; lastQuery = '';
    loadedFiles = new Set(); fullFileData = {}; loadErrors = [];
}

//////////////////////////////////////////////////
// FUNKCJE RENDERUJĄCE UI
//////////////////////////////////////////////////

/**
 * Renderuje listę wyników wyszukiwania.
 */
function renderResults(query, { append = false, startIndex = 0 } = {}) {
    if (!append) clearElement(resultsList);
    if (currentResults.length === 0) {
        handleNoResultsToRender(); window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); }); return;
    }
    updateResultsCountInfo();

    const sections = ensureRouteCategorySections();
    const fragmentByCategory = new Map();
    for (const category of ROUTE_CATEGORIES_ORDER) fragmentByCategory.set(category, document.createDocumentFragment());

    for (let index = startIndex; index < currentResults.length; index++) {
        const group = currentResults[index];
        const cats = Array.isArray(group?.categories) && group.categories.length > 0 ? group.categories : ['STANDARD'];
        const uniqueCats = Array.from(new Set(cats.map(c => String(c || '').trim()).filter(Boolean)));
        const targetCats = uniqueCats.length > 0 ? uniqueCats : ['STANDARD'];
        for (const category of targetCats) {
            if (!fragmentByCategory.has(category)) continue;
            fragmentByCategory.get(category).appendChild(createResultGroupElement(group, index, query));
        }
    }

    for (const category of ROUTE_CATEGORIES_ORDER) {
        const section = sections.get(category);
        if (!section) continue;
        section.body.appendChild(fragmentByCategory.get(category));
    }

    updateRouteCategorySectionCounts(sections);
    window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); });
}

function ensureRouteCategorySections() {
    const map = new Map();
    const shouldRebuild = ROUTE_CATEGORIES_ORDER.some((c) => !resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(c)}"]`));
    if (shouldRebuild) clearElement(resultsList);

    for (const category of ROUTE_CATEGORIES_ORDER) {
        const existing = resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(category)}"]`);
        if (existing) {
            const btn = existing.querySelector('.results-category-toggle');
            const count = existing.querySelector('.results-category-count');
            const body = existing.querySelector('.results-category-body');
            if (btn && count && body) map.set(category, { section: existing, button: btn, count, body });
            continue;
        }

        const section = document.createElement('section');
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

        const collapsed = isRouteCategoryCollapsed(category);
        section.classList.toggle('is-collapsed', collapsed);
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

        section.appendChild(button);
        section.appendChild(body);
        resultsList.appendChild(section);

        map.set(category, { section, button, count, body });
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
    const isCollapsed = section.classList.toggle('is-collapsed');
    if (button) button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    storageSet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${cat}`, isCollapsed ? '1' : '0');
    window.requestAnimationFrame(() => { syncResultsEndIntersectionObserver(); updateScrollIndicator(); });
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
function createResultGroupElement(group, index, query) {
    const routeName = formatRouteNameForResults(group.fileName);
    const groupDiv = document.createElement('div');
    groupDiv.className = 'result-group'; groupDiv.dataset.index = index;
    if (index === selectedResultIndex) groupDiv.classList.add('selected');
    const rowsHtml = group.items.map(item => {
        const isLab = item.isComplete ? rowMatchesKeyLab(item.cells.join(' ')) : false;
        const rowClass = isLab ? 'result-row result-row--lab' : 'result-row';
        return `<div class="${rowClass}" data-row-index="${item.rowIndex}" data-file-name="${escapeHtml(item.fileName)}">
            <div class="result-content">${buildResultSummaryHtml(item, query, { isLab })}</div>
        </div>`;
    }).join('');
    setElementHtml(groupDiv, `<div class="result-group-header"><span class="result-filename"><span class="result-route-name">${routeName}</span></span></div><div class="result-group-body">${rowsHtml}</div>`);
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
        ].map((html, idx) => (idx === 0 ? html : `<span class="result-sep">|</span>${html}`)).join('');
    }
    return result.cells.filter(c => !isEmptyCell(c)).map(c => {
        let text = String(c); if (isLab) text = toTitleCase(text);
        return `<span class="result-cell-fragment">${highlightText(text, query)}</span>`;
    }).join('<span class="result-sep">|</span>');
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
    const idxTh = document.createElement('th'); idxTh.textContent = '#'; thead.appendChild(idxTh);
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
        const tdNum = document.createElement('td'); tdNum.className = 'row-num'; tdNum.textContent = String(rowObj.originalRowIndex + 1); tr.appendChild(tdNum);
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
    modalTitle.textContent = title; setElementHtml(modalContent, content); clearElement(modalActions);
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
    lastQuery = ''; matchedResults = []; currentResults = []; selectedResultIndex = -1;
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

/**
 * Finalizuje import plików.
 */
async function finalizeFileImport(summary, before) {
    summary.records = Math.max(0, allData.length - before); if (uploadProgress) uploadProgress.value = 100;
    uploadStatus.textContent = 'Import zakończony.'; logAction('import', { files: summary.files.length, records: summary.records, errors: summary.errors }, 'INFO');
    displayImportSummary(summary); fileCountSpan.textContent = String((await docsListFiles()).length);
    setSearchEnabled(allData.length > 0); if (lastQuery && lastQuery.trim().length >= 3 && isSearchEnabled) performSearch(lastQuery.trim());
}

/**
 * Finalizuje import z Google Drive.
 */
async function finalizeGoogleDriveImport(summary, before) {
    summary.records = Math.max(0, allData.length - before); uploadStatus.textContent = 'Google Drive: import zakończony.';
    logAction('import', { source: 'google_drive', files: summary.files.length, records: summary.records, errors: summary.errors }, 'INFO');
    displayImportSummary(summary); fileCountSpan.textContent = String((await docsListFiles()).length);
    setSearchEnabled(allData.length > 0); if (lastQuery && lastQuery.trim().length >= 3 && isSearchEnabled) performSearch(lastQuery.trim());
}

/**
 * Obsługuje niedostępność API Google Drive.
 */
function handleGoogleDriveUnavailable() {
    const msg = 'Import z Google Drive jest niedostępny (brak modułu).';
    console.error(msg); logAction('import', { source: 'google_drive', message: msg }, 'ERROR');
    uploadProgressContainer.classList.remove('hidden'); uploadStatus.textContent = msg;
    window.setTimeout(() => uploadProgressContainer.classList.add('hidden'), 1500);
}

/**
 * Obsługuje anulowanie importu z Google Drive.
 */
function handleGoogleDriveCancel() {
    uploadStatus.textContent = 'Google Drive: anulowano.'; logAction('import', { source: 'google_drive', phase: 'cancel' }, 'INFO');
}

/**
 * Obsługuje błąd połączenia z Google Drive.
 */
function handleGoogleDriveError(err) {
    const msg = err?.message ? String(err.message) : 'Błąd importu z Google Drive';
    console.error(err); logAction('import', { source: 'google_drive', message: msg }, 'ERROR');
    uploadStatus.textContent = `Google Drive: ${msg}`;
}

/**
 * Przełącza stan ładowania interfejsu Google Drive.
 */
function setGoogleDriveLoadingState(loading) {
    if (importGoogleDriveButton) { importGoogleDriveButton.setAttribute('aria-busy', String(loading)); importGoogleDriveButton.disabled = loading; }
    if (loading) { uploadProgressContainer.classList.remove('hidden'); if (uploadProgress) uploadProgress.value = 0; uploadStatus.textContent = 'Google Drive: inicjalizacja...'; }
    else window.setTimeout(() => uploadProgressContainer.classList.add('hidden'), 900);
}

/**
 * Przełącza stan ładowania interfejsu importu.
 */
function setImportLoadingState(loading, total = 0) {
    if (loading) { uploadProgressContainer.classList.remove('hidden'); if (uploadProgress) uploadProgress.value = 0; uploadStatus.textContent = `Import: ${total} plik(ów)...`; }
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

/**
 * Przewija widok do zaznaczonego wyniku wyszukiwania.
 */
function scrollToSelected() {
    const selected = resultsList.querySelector('.result-group.selected');
    if (!selected) return;
    const section = selected.closest('.results-category');
    if (section && section.classList.contains('is-collapsed')) {
        const category = section.dataset.category;
        section.classList.remove('is-collapsed');
        const button = section.querySelector('.results-category-toggle');
        if (button) button.setAttribute('aria-expanded', 'true');
        storageSet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${String(category || '').trim()}`, '0');
    }
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
function formatTimestamp(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * Uzupełnia liczbę zerem wiodącym.
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
 * Funkcja opóźniająca.
 */
function waitMs(ms) { return new Promise(resolve => window.setTimeout(resolve, ms)); }

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
 * Zapisuje Blob pliku w bazie.
 */
async function docsPutBlob(fileName, blob) {
    const safe = String(fileName || '').trim(); if (!safe) throw new Error('Brak nazwy pliku');
    const db = await openDocsDb();
    await new Promise((resolve, reject) => {
        const req = db.transaction(DOCS_DB_STORE, 'readwrite').objectStore(DOCS_DB_STORE).put({ name: safe, blob, size: blob?.size ?? 0, updatedAt: Date.now() });
        req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
    });
}

/**
 * Zabezpiecza ciąg dla RegExp.
 */
function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Bezpiecznie konwertuje obiekt na JSON.
 */
function safeStringifyForSearch(value) {
    try { return (value == null || typeof value === 'string') ? (value || '') : JSON.stringify(value); } catch { return ''; }
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

/**
 * Obsługuje zbyt krótkie zapytanie wyszukiwania.
 */
function handleSearchShortQuery() {
    statusIndicator.textContent = 'Wpisz minimum 3 znaki, aby wyszukać...';
    statusIndicator.classList.add('status--hint'); clearResults();
}

/**
 * Obsługuje nawigację klawiaturą po wynikach.
 */
function handleKeyNavigation(e) {
    if (currentResults.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedResultIndex = Math.min(selectedResultIndex + 1, currentResults.length - 1); renderResults(lastQuery); scrollToSelected(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedResultIndex = Math.max(selectedResultIndex - 1, 0); renderResults(lastQuery); scrollToSelected(); }
    else if (e.key === 'Enter' && selectedResultIndex >= 0) { const group = currentResults[selectedResultIndex]; showFilePreview(group.fileName, group.items[0].rowIndex); }
}

// Start aplikacji
init();
