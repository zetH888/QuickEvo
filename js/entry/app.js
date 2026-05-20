/**
 * QuickEvo - Logika Frontendowa
 * 
 * Aplikacja do wyszukiwania tras i dokumentów w plikach Excel (.xlsx, .xls) oraz CSV.
 * Obsługuje import plików z dysku lokalnego oraz z Google Drive.
 * Wykorzystuje IndexedDB do przechowywania plików i Web Workers (opcjonalnie) do przetwarzania.
 */

import * as utils from '../core/utils.js';
import * as searchEngine from '../core/search-engine.js';
import * as state from '../core/state.js';
import * as excelProcessor from '../core/excel-processor.js';
import * as driveService from '../services/drive-service.js';
import { docsClearFilesStore, docsDeleteFiles, docsFileExists, docsGetBlob, docsGetFileRecord, docsListFiles, docsPutBlob, openDocsDb } from '../storage/docs-db.js';
import { importLocalFiles } from '../services/import-service.js';
import { createImportApplication } from '../app/import-application.js';
import { createSearchApplication } from '../app/search-application.js';
import { createPreviewApplication } from '../app/preview-application.js';
import { createDriveSyncApplication } from '../app/drive-sync-application.js';
import { createDriveUnifiedSyncApplication } from '../app/drive-unified-sync-application.js';
import { createNavigationApplication } from '../app/navigation-application.js';
import { createLoadingApplication } from '../app/loading-application.js';
import { createScheduleService } from '../services/schedule-service.js';
import { createSearchOrchestrator } from '../features/search/search-orchestrator.js';
import { createNavigationService } from '../services/navigation-service.js';
import { createLogoRenderer, createModalController, createPreviewController, createResultsCategoryController, createResultsRenderer, createScheduleController, createScrollIndicatorController, createWelcomeProgressRenderer, highlightLabsInPreviewTableDom, prepareResultsListDom, updateResultsCountInfoDom } from '../ui/ui-components.js';
import { createDriveChangesModalController } from '../ui/drive/drive-changes-modal.js';
import { createWelcomeLoadingOverlayController } from '../ui/loading/welcome-loading-overlay-controller.js';
import { createPredictiveGhostController } from '../ui/search/predictive-ghost.js';
import { buildQuickEvoLogoSvg, startLogoOrbitInContainer } from '../ui/logo/quickevo-logo.js';
import { formatFileName } from '../core/formatters/file-name.js';
import { highlightText } from '../core/formatters/highlight.js';
import { getRouteCategoriesFromFileName } from '../core/formatters/route-categories.js';
import { formatRouteNameForResults } from '../core/formatters/route-name.js';
import { toTitleCase } from '../core/formatters/title-case.js';
import { BOOT_WATCHDOG_MS, LOADING_PROGRESS_JUMP_MAX, LOADING_PROGRESS_JUMP_MIN, LOADING_PROGRESS_MICROSTOP_MAX_MS, LOADING_PROGRESS_MICROSTOP_MIN_MS, LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH, LOADING_TITLE_FADE_IN_MS, LOADING_TITLE_FADE_OUT_MS, LOADING_TITLE_INTERVAL_MAX_MS, LOADING_TITLE_INTERVAL_MIN_MS, LOADING_TITLE_MESSAGES, MAX_IMPORT_BYTES, ROUTE_CATEGORIES_ORDER, ROUTE_CATEGORY_STORAGE_PREFIX, WELCOME_LOGO_ENTER_DELAY_MS, WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS, WELCOME_SEQUENCE_UNLOCK_AFTER_MS } from '../config/constants.js';
import * as qeConstants from '../config/constants.js';

//////////////////////////////////////////////////
// STAŁE GLOBALNE, KONFIGURACJA, IMPORTY
//////////////////////////////////////////////////

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

/**
 * Referencje do modułów ESM.
 *
 * @type {{ utils: any, searchEngine: any, state: any, excelProcessor: any, driveService: any }}
 */
const qeModules = { utils, searchEngine, state, excelProcessor, driveService };

/**
 * Stan aplikacji przekazywany do modułów.
 * Jest inicjalizowany w `qeBootstrap()` i przechowywany wyłącznie wewnątrz tego pliku (brak global scope).
 *
 * @type {ReturnType<any> | null}
 */
let appState = null;

/**
 * Uruchamia aplikację po załadowaniu modułów ESM oraz zainicjalizowaniu stanu.
 * W przypadku błędu startu, blokuje inicjalizację i pokazuje komunikat awaryjny.
 *
 * @returns {Promise<void>}
 */
async function qeBootstrap() {
    try {
        appState = qeModules.state.createAppState();
        searchCache = appState.search.searchCache;
        predictiveSuggestionsCache = appState.predictive.predictiveSuggestionsCache;
        compiledKeyLabTokenSets = appState.search.compiledKeyLabTokenSets;

        const onDomReady = () => {
            const ctrl = ensureWelcomeLoadingOverlayController();
            ctrl.markWelcomeLogoDomContentLoadedNow();
            ctrl.scheduleWelcomeLogoEntrance();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
        else onDomReady();

        await init();
    } catch (err) {
        console.error(err);
        alert('Nie udało się uruchomić aplikacji. Odśwież stronę i spróbuj ponownie.');
    }
}

/**
 * Zapewnia dostęp do modułu utils i umożliwia wczesne wykrycie błędów inicjalizacji.
 *
 * @returns {any}
 */
function qeGetUtils() {
    if (!qeModules.utils) throw new Error('Moduł utils nie został załadowany.');
    return qeModules.utils;
}

/**
 * Zapewnia dostęp do modułu search-engine i umożliwia wczesne wykrycie błędów inicjalizacji.
 *
 * @returns {any}
 */
function qeGetSearchEngine() {
    if (!qeModules.searchEngine) throw new Error('Moduł search-engine nie został załadowany.');
    return qeModules.searchEngine;
}

/**
 * Zapewnia dostęp do modułu excel-processor i umożliwia wczesne wykrycie błędów inicjalizacji.
 *
 * @returns {any}
 */
function qeGetExcelProcessor() {
    if (!qeModules.excelProcessor) throw new Error('Moduł excel-processor nie został załadowany.');
    return qeModules.excelProcessor;
}

/**
 * Zapewnia dostęp do modułu drive-service i umożliwia wczesne wykrycie błędów inicjalizacji.
 *
 * @returns {any}
 */
function qeGetDriveService() {
    if (!qeModules.driveService) throw new Error('Moduł drive-service nie został załadowany.');
    return qeModules.driveService;
}

const DOM_READY_TS = performance.now();

/**
 * Cache dla wyników wyszukiwania (LRU).
 */
let searchCache = null;
let searchOrchestrator = null;
let navigationService = null;
let importApplication = null;
let searchApplication = null;
let previewApplication = null;
let driveSyncApplication = null;
let driveUnifiedSyncApplication = null;
let navigationApplication = null;
let loadingApplication = null;

let predictiveSuggestionsCache = null;
let predictiveGhostController = null;

/**
 * Licznik blokad przycisków synchronizacji Google Drive.
 * Pozwala bezpiecznie nakładać się kilku procesom (np. import tras + import grafiku) bez ryzyka przedwczesnego odblokowania UI.
 */
let googleDriveSyncBusyLocks = 0;

/**
 * Stały folder Google Drive z plikami grafiku.
 */
const DRIVE_SCHEDULE_FOLDER_ID = '10m4VzgbWqLy3U5V4lP_e-TN-vZVCyhGj';

/**
 * Interwał cyklicznego sprawdzania aktualności grafiku.
 */
const SCHEDULE_AUTO_REFRESH_INTERVAL_MS = 60_000;

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
const scheduleButton = document.getElementById('schedule-button');
const fileInput = document.getElementById('file-input');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgress = document.getElementById('upload-progress');
const uploadStatus = document.getElementById('upload-status');
const searchView = document.getElementById('search-view');
const filePreviewView = document.getElementById('file-preview-view');
const backToSearchBtn = document.getElementById('back-to-search');
const scheduleView = document.getElementById('schedule-view');
const backToSearchFromScheduleBtn = document.getElementById('back-to-search-from-schedule');
const scheduleTableHeader = document.getElementById('schedule-table-header');
const scheduleTableBody = document.getElementById('schedule-table-body');
const scheduleMonthSelect = document.getElementById('schedule-month-select');
const schedulePrevMonthBtn = document.getElementById('schedule-prev-month');
const scheduleNextMonthBtn = document.getElementById('schedule-next-month');
const scheduleTodayBtn = document.getElementById('schedule-today');
const scheduleSubtitle = document.getElementById('schedule-subtitle');
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

/** @type {{ show: Function, hide: Function } | null} */
let modalController = null;

/** @type {{ showSearch: Function, showPreview: Function } | null} */
let previewController = null;

/** @type {{ isVisible: Function, setAvailableMonthsList: Function, setMonthByKey: Function, renderMonthDays: Function, setSelectedDay: Function, goToday: Function } | null} */
let scheduleController = null;

/** @type {{ ensureSections: Function, updateCounts: Function, syncHeights: Function, toggleCategory: Function } | null} */
let resultsCategoryController = null;

/** @type {{ createGroupElement: Function } | null} */
let resultsRenderer = null;

/** @type {{ createItem: Function, updateItem: Function } | null} */
let welcomeProgressRenderer = null;

/** @type {{ renderHeaderLogo: Function, refreshWelcomeGraphicIfPresent: Function, lazyLoadWelcomeGraphic: Function } | null} */
let logoRenderer = null;

let scrollIndicatorController = null;

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

/** @type {number} Rewizja danych (allData) używana do detekcji zmian wymagających ponownego renderu wyników. */
let allDataRevision = 0;

/** @type {{ query: string, dataRevision: number }} Ostatnio wyrenderowane wyniki (zapytanie + rewizja danych). */
let lastRenderedSearch = { query: '', dataRevision: -1 };

/** @type {Set<string>} Zbiór nazw plików, które zostały już przetworzone. */
let loadedFiles = new Set(); 

/** @type {Object<string, Object>} Mapowanie nazwy pliku na pełny model danych tabeli. */
let fullFileData = {}; 
let scheduleService = null;

/**
 * Indeks tras zaimportowanych do bazy (kod trasy -> nazwa pliku).
 * Używany do ograniczenia klikalności w grafiku wyłącznie do tras dostępnych w IndexedDB.
 *
 * @type {Map<string, string>}
 */
let routeFileIndexByCode = new Map();

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

/**
 * Kontroler animacji paska postępu na ekranie ładowania.
 */
let welcomeLoadingOverlayController = null;

/** @type {boolean} Flaga zakończenia animacji ładowania. */
let loadingProgressDone = false;

/** @type {boolean} Flaga gotowości danych aplikacji. */
let loadingDataReady = false;

/** @type {boolean} Flaga błędu ładowania. */
let loadingFailed = false;

/** @type {number} Czas rozpoczęcia procesu ładowania. */
let loadingStartedAt = 0;

/** @type {Object} Ostatni stan podglądu pliku. */
let lastPreviewState = { fileName: null, rowIndex: null, contextIsoDate: null };

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
let bootWatchdogTimer = null;

function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function clampNumber(v, min, max) {
    return qeGetUtils().clampNumber(v, min, max);
}

function isLoadingVisualFinishAllowed() {
    return Boolean(loadingProgressDone && (loadingDataReady || loadingFailed));
}

function ensureWelcomeLoadingOverlayController() {
    if (welcomeLoadingOverlayController) return welcomeLoadingOverlayController;
    welcomeLoadingOverlayController = createWelcomeLoadingOverlayController({
        els: {
            loadingOverlay,
            loadingTitleText,
            loadingStatusText,
            loadingError,
            loadingContinueButton,
            loadingProgressMeta,
            loadingProgressBar,
            welcomeImportProgress,
            welcomeProgressList
        },
        constants: {
            LOADING_TITLE_MESSAGES,
            LOADING_TITLE_FADE_OUT_MS,
            LOADING_TITLE_FADE_IN_MS,
            LOADING_TITLE_INTERVAL_MIN_MS,
            LOADING_TITLE_INTERVAL_MAX_MS,
            LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH,
            LOADING_PROGRESS_MICROSTOP_MIN_MS,
            LOADING_PROGRESS_MICROSTOP_MAX_MS,
            LOADING_PROGRESS_JUMP_MIN,
            LOADING_PROGRESS_JUMP_MAX,
            WELCOME_LOGO_ENTER_DELAY_MS,
            WELCOME_SEQUENCE_UNLOCK_AFTER_MS,
            WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS
        },
        prefersReducedMotion,
        isVisualFinishAllowed: isLoadingVisualFinishAllowed,
        focusBodySafely,
        getWelcomeGraphicEl: () => document.getElementById('welcome-graphic'),
        flags: {
            getLoadingProgressDone: () => loadingProgressDone,
            setLoadingProgressDone: (v) => { loadingProgressDone = Boolean(v); },
            getLoadingDataReady: () => loadingDataReady,
            getLoadingFailed: () => loadingFailed,
            getLoadErrorsCount: () => loadErrors.length
        },
        setElementHtml
    });
    return welcomeLoadingOverlayController;
}

function forceWelcomeSequenceDone() {
    ensureWelcomeLoadingOverlayController().forceWelcomeSequenceDone();
}

function ensurePredictiveGhostController() {
    if (predictiveGhostController) return predictiveGhostController;
    predictiveGhostController = createPredictiveGhostController({
        searchInput,
        ghostOverlay,
        ghostPrefix,
        ghostSuffix,
        minChars: 2,
        isSearchEnabled: () => isSearchEnabled,
        fuzzyNormalizeText,
        getPredictiveSuggestions: (norm, opts) => ensureSearchApplication().getPredictiveSuggestions(norm, opts)
    });
    return predictiveGhostController;
}

//////////////////////////////////////////////////
// FUNKCJE INICJALIZACYJNE
//////////////////////////////////////////////////

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
    ensureWelcomeLoadingOverlayController().setupParallax();

    ensureLogoRenderer().lazyLoadWelcomeGraphic(document.getElementById('welcome-graphic'));
    ensureLogoRenderer().renderHeaderLogo(appHeaderLogo);

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
    ensureWelcomeLoadingOverlayController().updateProgressStart(total);
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
        ensureLogoRenderer().renderHeaderLogo(appHeaderLogo);
        ensureLogoRenderer().refreshWelcomeGraphicIfPresent(document.getElementById('welcome-graphic'));
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
    ensureLogoRenderer().renderHeaderLogo(appHeaderLogo);
    ensureLogoRenderer().refreshWelcomeGraphicIfPresent(document.getElementById('welcome-graphic'));
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
    const debouncedPredictive = debounce((query, source) => ensurePredictiveGhostController().update(query, { source }), 150);
    debouncedSearchRef = debouncedSearch;
    debouncedLogSearchRef = debouncedLogSearch;

    searchInput.addEventListener('input', (e) => {
        if (!isSearchEnabled) return;
        const query = e.target.value.trim();
        debouncedPredictive(query, 'input');
        handleSearchInput(query, debouncedSearch, debouncedLogSearch);
    });

    searchInput.addEventListener('keydown', (e) => ensurePredictiveGhostController().onKeydown(e));
    searchInput.addEventListener('scroll', () => ensurePredictiveGhostController().onScroll(), { passive: true });
    searchInput.addEventListener('blur', () => ensurePredictiveGhostController().onBlur(), { passive: true });
    searchInput.addEventListener('compositionstart', () => ensurePredictiveGhostController().onCompositionStart(), { passive: true });
    searchInput.addEventListener('compositionend', () => ensurePredictiveGhostController().onCompositionEnd(searchInput.value), { passive: true });
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
    ensureNavigationService().attach({ backToSearchBtn, homeLink });
    if (scheduleButton) {
        scheduleButton.addEventListener('click', async () => {
            try { await openScheduleView({ source: 'toolbar' }); } catch { }
        });
    }
    if (backToSearchFromScheduleBtn) {
        backToSearchFromScheduleBtn.addEventListener('click', () => handleBackFromSchedule());
    }
}

function ensureNavigationApplication() {
    if (navigationApplication) return navigationApplication;
    navigationApplication = createNavigationApplication({
        onLog: logAction,
        resetToInitialState,
        showFilePreview,
        showSearchView: ({ source } = {}) => { goHome(); ensurePreviewApplication().openSearch({ source: String(source || '') }); },
        showScheduleView: ({ ym, selectedIsoDate, skipPush, source } = {}) => openScheduleView({ ym: String(ym || ''), selectedIsoDate: selectedIsoDate ?? null, skipPush: Boolean(skipPush), source: String(source || '') }),
        setSearchInputValue: (value) => { if (searchInput) searchInput.value = String(value ?? ''); },
        performSearch: (q) => performSearch(String(q || '')),
        getIsSearchEnabled: () => Boolean(isSearchEnabled),
        clearSearchUi: () => {
            clearResults();
            statusIndicator.textContent = 'Dane gotowe.';
            statusIndicator.classList.remove('status--hint');
        },
        onPageshowRestore: () => {
            window.requestAnimationFrame(() => {
                try {
                    const ctrl = ensureScrollIndicatorController();
                    ctrl.syncResultsEndIntersectionObserver();
                    ctrl.update();
                } catch { }
            });
        },
        canOpenPreview: (fileName) => Boolean(fullFileData && fullFileData[String(fileName || '')]),
        isHomeState: () => Boolean(history.state && history.state.view === 'home' && !history.state.search && !searchInput.value),
        shouldIgnoreHomeClick: (e) => Boolean(e?.metaKey || e?.ctrlKey || e?.shiftKey || e?.altKey),
        onScrollTop: () => { try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { try { window.scrollTo(0, 0); } catch { } } },
        logClientEvent
    });
    return navigationApplication;
}

function ensureNavigationService() {
    if (navigationService) return navigationService;
    navigationService = createNavigationService(ensureNavigationApplication().createServiceConfig());
    return navigationService;
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
        const ctrl = ensureScrollIndicatorController();
        ctrl.syncResultsEndIntersectionObserver();
        ctrl.update();
    }, 120);
    const scrollContainer = ensureScrollIndicatorController().getScrollContainer();

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

    if (!resultsListOverflowObservers.attached) {
        resultsListOverflowObservers.attached = true;
        resultsListOverflowObservers.onWindowScroll = () => ensureScrollIndicatorController().update();
        resultsListOverflowObservers.onWindowResize = () => debouncedUpdate();
        resultsListOverflowObservers.onListScroll = () => ensureScrollIndicatorController().update();

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
        routeFileIndexByCode = buildRouteFileIndex(spreadsheetFiles);
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
        const tableModel = await qeGetExcelProcessor().parseTableModelFromSource(source, fileName);
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

function ensureScheduleService() {
    if (scheduleService) return scheduleService;
    scheduleService = createScheduleService({
        fuzzyNormalizeText,
        readWorkbook,
        sheetToMatrix: (worksheet) => qeGetExcelProcessor().sheetToMatrix(worksheet),
        getBlob: docsGetBlob,
        listFiles: docsListFiles,
        logAction
    });
    return scheduleService;
}

function parseScheduleFileNameYearMonth(fileName) {
    return ensureScheduleService().parseScheduleFileNameYearMonth(fileName);
}

function isScheduleFileName(fileName) {
    return ensureScheduleService().isScheduleFileName(fileName);
}

async function parseScheduleSpreadsheet(source, fileName) {
    return await ensureScheduleService().parseScheduleSpreadsheet(source, fileName);
}

async function processScheduleFile(fileName) {
    return await ensureScheduleService().processScheduleFile(fileName);
}

function invalidateScheduleFile(fileName) {
    ensureScheduleService().invalidateScheduleFile(fileName);
}

async function loadScheduleFiles({ fullReload, showProgress } = { fullReload: false, showProgress: false }) {
    return await ensureScheduleService().loadScheduleFiles({
        fullReload: Boolean(fullReload),
        showProgress: Boolean(showProgress),
        onStatusText: (text) => setLoadingStatusText(text),
        formatFileName
    });
}

function getDriverForRouteOnDate(routeCode, date) {
    return ensureScheduleService().getDriverNamesForRouteOnDate(routeCode, date);
}

/**
 * Zwraca kierowcę dla trasy w konkretnym dniu (YYYY-MM-DD).
 * To preferowana ścieżka dla UI, bo jest niezależna od stref czasowych.
 *
 * @param {string} routeCode
 * @param {string} isoDate
 * @returns {string[] | null}
 */
function getDriverForRouteOnIsoDate(routeCode, isoDate) {
    return ensureScheduleService().getDriverNamesForRouteOnIsoDate(routeCode, isoDate);
}

function normalizeDriverDisplayName(value) {
    const raw = value === null || value === undefined ? '' : String(value);
    return raw.replace(/\s+/g, ' ').trim();
}

function buildDriverBadgesHtml(driverNames) {
    const names = Array.isArray(driverNames) ? driverNames.map(normalizeDriverDisplayName).filter(Boolean) : [];
    if (names.length === 0) return '';
    const parts = [];
    for (let i = 0; i < names.length; i++) {
        if (i > 0) parts.push('<span class="result-driver-sep">i/lub</span>');
        parts.push(`<span class="result-driver-badge">${escapeHtml(names[i])}</span>`);
    }
    return parts.join('');
}

//////////////////////////////////////////////////
// OBSŁUGA IMPORTU GRAFIKU Z GOOGLE DRIVE
//////////////////////////////////////////////////

function ensureDriveUnifiedSyncApplication() {
    if (driveUnifiedSyncApplication) return driveUnifiedSyncApplication;

    const ROUTES_FOLDER_ID = '1tyClIJEDwntOrYCMVYmyR5nR6LNHmN-x';

    driveUnifiedSyncApplication = createDriveUnifiedSyncApplication({
        getApi: () => qeGetDriveService(),
        getFolderIdRoutes: () => ROUTES_FOLDER_ID,
        getFolderIdSchedule: () => DRIVE_SCHEDULE_FOLDER_ID,
        parseScheduleMetaStrictXlsx: (name) => ensureScheduleService().parseScheduleFileNameYearMonthStrictXlsx(name),
        toTitleCase,
        maxImportBytes: MAX_IMPORT_BYTES,
        listDbFiles: () => docsListFiles(),
        getDbFileRecord: (name) => docsGetFileRecord(name),
        putDbBlob: (name, blob, meta) => docsPutBlob(name, blob, meta),
        removeFileData,
        isScheduleFileName,
        invalidateScheduleFile,
        processScheduleFile,
        processFile,
        loadedFiles,
        getAllDataLength: () => allData.length,
        finalizeImport: (summary, before) => ensureImportApplication().finalizeImport(summary, before),
        logAction,
        escapeHtml,
        buildConnectingModalHtml: buildDriveConnectingModalHtml,
        buildNoChangesModalHtml: buildDriveNoChangesModalHtml,
        buildChangesModalHtml: (changed) => ensureDriveChangesModalController().buildChangesModalHtml(changed),
        showModal: (title, content, actions) => showModal(title, content, actions),
        hideModal: () => hideModal(),
        setLoadingStatusText: (text) => {
            setLoadingStatusText(text);
            if (String(text || '').trim() === 'Dane aktualne.') {
                if (statusIndicator) statusIndicator.textContent = 'Dane aktualne.';
            }
        },
        setUploadStatusText: (text, opts) => setUploadStatusText(text, opts),
        setUploadProgressValue: (v) => { if (uploadProgress) uploadProgress.value = Number(v) || 0; },
        setLoadingProgress: (value, metaText) => {
            if (loadingProgressBar) loadingProgressBar.value = Number(value) || 0;
            if (loadingProgressMeta && metaText) loadingProgressMeta.textContent = String(metaText);
        },
        setUploadUiVisible: (visible, total) => {
            if (visible) {
                uploadProgressContainer?.classList.remove('hidden');
                if (uploadProgress) uploadProgress.value = 0;
                setUploadStatusText(`Google Drive: synchronizacja ${Number(total) || 0} plik(ów)...`, { animate: false });
                return;
            }
            window.setTimeout(() => uploadProgressContainer?.classList.add('hidden'), 900);
        },
        setButtonsBusy: (busy) => setGoogleDriveSyncButtonsBusy(Boolean(busy)),
        initChangesModal: (files, token) => ensureDriveChangesModalController().init({ files, token, api: qeGetDriveService() }),
        formatFileName,
        isWelcomeVisible: () => ensureWelcomeLoadingOverlayController().isVisible(),
        prepareWelcomeProgressList: () => ensureWelcomeLoadingOverlayController().prepareWelcomeProgressList(),
        createWelcomeItem: (name) => ensureWelcomeProgressRenderer().createItem(name),
        appendWelcomeItem: (item) => { if (welcomeProgressList && item) welcomeProgressList.appendChild(item); },
        scrollWelcomeItemIntoView: (item) => { try { item?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); } catch { } },
        updateWelcomeItem: (item, percent, label, opts) => ensureWelcomeProgressRenderer().updateItem(item, percent, label, opts),
        shouldDeferWelcomeUpdates: () => ensureWelcomeLoadingOverlayController().shouldDeferWelcomeUpdates(),
        runWithConcurrency
    });

    return driveUnifiedSyncApplication;
}
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

/**
 * Normalizuje kod trasy do postaci porównywalnej między:
 * - nazwą pliku trasy (extractRouteCodeFromFileName),
 * - grafikiem (schedule-service).
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRouteCodeForLookup(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return raw
        .replace(/[–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '')
        .toUpperCase();
}

/**
 * Buduje indeks kodów tras dostępnych w bazie (IndexedDB) na podstawie listy plików arkuszy.
 *
 * @param {string[]} spreadsheetFiles
 * @returns {Map<string, string>}
 */
function buildRouteFileIndex(spreadsheetFiles) {
    const list = Array.isArray(spreadsheetFiles) ? spreadsheetFiles : [];
    const map = new Map();
    for (const fileName of list) {
        const name = String(fileName ?? '').trim();
        if (!name) continue;
        const code = normalizeRouteCodeForLookup(extractRouteCodeFromFileName(name));
        if (!code) continue;
        if (!map.has(code)) map.set(code, name);
    }
    return map;
}

/**
 * Odczytuje skoroszyt z różnych źródeł danych.
 */
async function readWorkbook(source, fileName) {
    return await qeGetExcelProcessor().readWorkbook(source, fileName);
}

/**
 * Konwertuje źródło danych na ArrayBuffer.
 */
async function getArrayBufferFromSource(source) {
    return await qeGetExcelProcessor().getArrayBufferFromSource(source);
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
        invalidateScheduleFile(safeName);
        await parseScheduleSpreadsheet(arrayBuffer, safeName);
    } else {
        await parseSpreadsheet(arrayBuffer, safeName);
        loadedFiles.add(safeName);
    }
}

function ensureImportApplication() {
    if (importApplication) return importApplication;
    importApplication = createImportApplication({
        importLocalFiles,
        maxImportBytes: MAX_IMPORT_BYTES,
        fileExists: docsFileExists,
        resolveConflicts: resolveImportConflicts,
        onRejected: (r) => logAction('import', { fileName: r?.name, reason: r?.reason }, 'WARN'),
        onLoadingState: setImportLoadingState,
        onStatusText: (text) => setUploadStatusText(text),
        onProgress: (value) => { if (uploadProgress) uploadProgress.value = Number(value) || 0; },
        putBlob: docsPutBlob,
        removeFileData,
        isScheduleFileName,
        invalidateScheduleFile,
        loadedFiles,
        processScheduleFile,
        processFile,
        formatFileName,
        onFileError: ({ fileName, error }) => logAction('import', { fileName, message: error?.message }, 'ERROR'),
        getAllDataLength: () => allData.length,
        setSearchEnabled,
        getLastQuery: () => lastQuery,
        getIsSearchEnabled: () => Boolean(isSearchEnabled),
        performSearch: (query) => performSearch(query),
        schedulePredictiveIndexRebuild,
        displayImportSummary,
        refreshFileCount: async () => {
            if (!fileCountSpan) return;
            fileCountSpan.textContent = String((await getRouteSpreadsheetFiles()).length);
        },
        setUploadProgressValue: (value) => { if (uploadProgress) uploadProgress.value = Number(value) || 0; },
        setUploadStatusText: (text) => setUploadStatusText(text),
        logAction
    });
    return importApplication;
}

/**
 * Obsługuje import plików z dysku lokalnego.
 */
async function handleImportFiles(files) {
    await ensureImportApplication().importLocal(files);
}

/**
 * Przełącza stan „zajętości” przycisków Google Drive, aby uniknąć uruchamiania wielu synchronizacji równocześnie.
 */
function setGoogleDriveSyncButtonsBusy(loading) {
    const isLock = Boolean(loading);
    if (isLock) googleDriveSyncBusyLocks += 1;
    else googleDriveSyncBusyLocks = Math.max(0, googleDriveSyncBusyLocks - 1);

    const effectiveBusy = googleDriveSyncBusyLocks > 0;
    const busy = String(effectiveBusy);
    if (googleDriveButton) { googleDriveButton.setAttribute('aria-busy', busy); googleDriveButton.disabled = effectiveBusy; }
    if (syncGDriveButton) { syncGDriveButton.setAttribute('aria-busy', busy); syncGDriveButton.disabled = effectiveBusy; }
}

let driveChangesModalController = null;

function ensureDriveChangesModalController() {
    if (driveChangesModalController) return driveChangesModalController;
    driveChangesModalController = createDriveChangesModalController({
        modalOverlay,
        modalContent,
        setElementHtml,
        prefersReducedMotion,
        formatFileName
    });
    return driveChangesModalController;
}

function buildDriveConnectingModalHtml(stageText) {
    const stage = escapeHtml(String(stageText || '').trim() || 'Łączenie z Google Drive...');
    return `<div class="qe-drive-connecting"><div class="qe-spinner" aria-hidden="true"></div><div class="qe-drive-connecting-title">${stage}</div><div class="qe-drive-connecting-sub">To może potrwać kilka sekund. Nie zamykaj aplikacji.</div><div class="qe-indeterminate" aria-hidden="true"><div class="qe-indeterminate-bar"></div></div></div>`;
}

function buildDriveNoChangesModalHtml() {
    return `<div class="qe-drive-modal qe-drive-modal--ok"><div class="qe-drive-summary"><strong>Dane aktualne.</strong> Nie wykryto zmian w folderze Google Drive od ostatniej synchronizacji.</div></div>`;
}

function ensureDriveSyncApplication() {
    if (driveSyncApplication) return driveSyncApplication;
    const FOLDER_ID = '1tyClIJEDwntOrYCMVYmyR5nR6LNHmN-x';
    driveSyncApplication = createDriveSyncApplication({
        getApi: () => qeGetDriveService(),
        getFolderId: () => FOLDER_ID,
        maxImportBytes: MAX_IMPORT_BYTES,
        listDbFiles: () => docsListFiles(),
        getDbFileRecord: (name) => docsGetFileRecord(name),
        putDbBlob: (name, blob, meta) => docsPutBlob(name, blob, meta),
        removeFileData,
        isScheduleFileName,
        invalidateScheduleFile,
        processScheduleFile,
        processFile,
        loadedFiles,
        getAllDataLength: () => allData.length,
        finalizeImport: (summary, before) => ensureImportApplication().finalizeImport(summary, before),
        logAction,
        escapeHtml,
        buildConnectingModalHtml: buildDriveConnectingModalHtml,
        buildNoChangesModalHtml: buildDriveNoChangesModalHtml,
        buildChangesModalHtml: (changed) => ensureDriveChangesModalController().buildChangesModalHtml(changed),
        showModal: (title, content, actions) => showModal(title, content, actions),
        hideModal: () => hideModal(),
        setLoadingStatusText: (text) => {
            setLoadingStatusText(text);
            if (String(text || '').trim() === 'Dane aktualne.') {
                if (statusIndicator) statusIndicator.textContent = 'Dane aktualne.';
            }
        },
        setUploadStatusText: (text, opts) => setUploadStatusText(text, opts),
        setUploadProgressValue: (v) => { if (uploadProgress) uploadProgress.value = Number(v) || 0; },
        setLoadingProgress: (value, metaText) => {
            if (loadingProgressBar) loadingProgressBar.value = Number(value) || 0;
            if (loadingProgressMeta && metaText) loadingProgressMeta.textContent = String(metaText);
        },
        setUploadUiVisible: (visible, total) => {
            if (visible) {
                uploadProgressContainer?.classList.remove('hidden');
                if (uploadProgress) uploadProgress.value = 0;
                setUploadStatusText(`Google Drive: synchronizacja ${Number(total) || 0} plik(ów)...`, { animate: false });
                return;
            }
            window.setTimeout(() => uploadProgressContainer?.classList.add('hidden'), 900);
        },
        setButtonsBusy: (busy) => setGoogleDriveSyncButtonsBusy(Boolean(busy)),
        initChangesModal: (files, token) => ensureDriveChangesModalController().init({ files, token, api: qeGetDriveService() }),
        formatFileName,
        isWelcomeVisible: () => ensureWelcomeLoadingOverlayController().isVisible(),
        prepareWelcomeProgressList: () => ensureWelcomeLoadingOverlayController().prepareWelcomeProgressList(),
        createWelcomeItem: (name) => ensureWelcomeProgressRenderer().createItem(name),
        appendWelcomeItem: (item) => { if (welcomeProgressList && item) welcomeProgressList.appendChild(item); },
        scrollWelcomeItemIntoView: (item) => { try { item?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); } catch { } },
        updateWelcomeItem: (item, percent, label, opts) => ensureWelcomeProgressRenderer().updateItem(item, percent, label, opts),
        shouldDeferWelcomeUpdates: () => ensureWelcomeLoadingOverlayController().shouldDeferWelcomeUpdates(),
        runWithConcurrency
    });
    return driveSyncApplication;
}

/**
 * Obsługuje synchronizację z Google Drive (folder stały).
 */
async function handleGoogleDriveSync({ source } = {}) {
    const src = source || 'unknown';
    await ensureDriveUnifiedSyncApplication().start({ source: src });
}

//////////////////////////////////////////////////
// GŁÓWNA LOGIKA PRZETWARZANIA DANYCH
//////////////////////////////////////////////////

/**
 * Buduje model tabeli z surowej macierzy danych.
 */
function buildTableModel(matrix) {
    return qeGetExcelProcessor().buildTableModel(matrix);
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
    return qeGetExcelProcessor().normalizeMatrix(matrix);
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
    if (normalizedRows.length > 0) allDataRevision += 1;
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
    const trimmed = String(query || '').trim();
    if (trimmed.length >= 3) {
        const renderedMatchesQuery = String(lastRenderedSearch?.query || '').trim() === trimmed;
        const renderedMatchesData = Number(lastRenderedSearch?.dataRevision) === allDataRevision;
        const lastMatchesQuery = String(lastQuery || '').trim() === trimmed;
        const hasRenderedDom = Boolean(resultsList && resultsList.childElementCount > 0);
        if (renderedMatchesQuery && renderedMatchesData && lastMatchesQuery && currentResults.length > 0 && hasRenderedDom) {
            if (statusIndicator) statusIndicator.textContent = 'Dane gotowe.';
            return;
        }
    }
    await ensureSearchApplication().search(trimmed);
}

function ensureSearchApplication() {
    if (searchApplication) return searchApplication;
    searchApplication = createSearchApplication({
        createOrchestrator: () => {
            if (searchOrchestrator) return searchOrchestrator;
            searchOrchestrator = createSearchOrchestrator({
                getAllData: () => allData,
                searchEngine: qeGetSearchEngine(),
                searchCache,
                predictiveSuggestionsCache,
                getRouteCategoriesFromFileName,
                formatRouteNameForResults,
                normalizeText,
                fuzzyNormalizeText,
                logAction
            });
            return searchOrchestrator;
        },
        setStatusText: (text) => { if (statusIndicator) statusIndicator.textContent = String(text ?? ''); },
        setStatusHint: (isHint) => {
            if (!statusIndicator) return;
            statusIndicator.classList.toggle('status--hint', Boolean(isHint));
        },
        setLastQuery: (q) => { lastQuery = String(q || ''); },
        setMatchedResults: (results) => { matchedResults = Array.isArray(results) ? results : []; },
        setCurrentResults: (results) => { currentResults = Array.isArray(results) ? results : []; },
        renderResults: async (q) => { await renderResults(String(q || ''), { append: false, startIndex: 0 }); },
        handleShortQuery: handleSearchShortQuery,
        handleNoResults: handleNoSearchResults,
        handleError: handleSearchError,
        logAction
    });
    return searchApplication;
}

//////////////////////////////////////////////////
// FUNKCJE POMOCNICZE BIZNESOWE
//////////////////////////////////////////////////

/**
 * Sprawdza, czy wiersz pasuje do reguł "laboratorium".
 */
function rowMatchesKeyLab(text) {
    return qeGetSearchEngine().rowMatchesKeyLab(text, compiledKeyLabTokenSets);
}

/**
 * Kompiluje zestawy tokenów dla laboratoriów.
 */
function compileKeyLabTokenSets() {
    const compiled = qeGetSearchEngine().compileKeyLabTokenSets(qeGetSearchEngine().KEY_LAB_TOKEN_SETS);
    compiledKeyLabTokenSets = compiled;
    if (appState?.search) appState.search.compiledKeyLabTokenSets = compiled;
}

/**
 * Rozwiązuje konflikty nazw plików przed importem.
 */
async function resolveImportConflicts({ files, conflicts } = {}) {
    const list = Array.isArray(files) ? files : [];
    const detected = Array.isArray(conflicts) ? conflicts : [];
    if (detected.length === 0) return list;
    return new Promise((resolve) => {
        if (list.length === 1) {
            showModal('Konflikt nazw', `Plik o nazwie <strong>${escapeHtml(list[0].name)}</strong> już istnieje. Czy chcesz go nadpisać?`, [
                { label: `Nadpisz tylko ${list[0].name}`, class: 'modal-btn--primary', onClick: () => resolve(list) },
                { label: 'Anuluj', onClick: () => resolve([]) }
            ]);
        } else {
            showModal('Konflikty nazw', `Wykryto ${detected.length} plików, które już istnieją w bazie. Wybierz akcję dla importu zbiorczego.`, [
                { label: 'Nadpisz wszystkie', class: 'modal-btn--danger', onClick: () => resolve(list) },
                { label: 'Pomiń istniejące', class: 'modal-btn--primary', onClick: () => {
                    const conflictNames = new Set(detected.map(c => c.name));
                    resolve(list.filter(f => !conflictNames.has(f.name)));
                }},
                { label: 'Anuluj', onClick: () => resolve([]) }
            ]);
        }
    });
}

/**
 * Usuwa dane powiązane z konkretnym plikiem.
 */
function removeFileData(fileName) {
    const safe = String(fileName || '');
    if (!safe) return;
    const beforeLen = allData.length;
    allData = allData.filter(d => d?.fileName !== safe);
    if (allData.length !== beforeLen) allDataRevision += 1;
    delete fullFileData[safe];
    loadErrors = loadErrors.filter(e => e?.fileName !== safe);
}

/**
 * Resetuje kluczowe dane aplikacji.
 */
function resetAppData() {
    allData = []; currentResults = []; lastQuery = '';
    loadedFiles = new Set(); fullFileData = {}; loadErrors = [];
    allDataRevision += 1;
    lastRenderedSearch = { query: '', dataRevision: -1 };
}

//////////////////////////////////////////////////
// FUNKCJE RENDERUJĄCE UI
//////////////////////////////////////////////////

/**
 * Renderuje listę wyników wyszukiwania.
 */
async function renderResults(query, { append = false, startIndex = 0 } = {}) {
    const reduceMotion = prefersReducedMotion();
    await prepareResultsListDom(resultsList, { append, reduceMotion, exitClass: 'qe-results-exiting', exitDelayMs: 160 });

    if (currentResults.length === 0) {
        handleNoResultsToRender();
        window.requestAnimationFrame(() => {
            const ctrl = ensureScrollIndicatorController();
            ctrl.syncResultsEndIntersectionObserver();
            ctrl.update();
        });
        return;
    }
    updateResultsCountInfo();

    const shouldAnimateEnter = !reduceMotion;
    const sections = ensureResultsCategoryController().ensureSections({ animate: shouldAnimateEnter && !append });
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
            const el = ensureResultsRenderer().createGroupElement(group, index, query, animateIn ? { animateIn: true, enterDelayMs } : undefined);
            if (animateIn) enterOrdinal += 1;
            fragmentByCategory.get(category).appendChild(el);
        }
    }

    for (const category of ROUTE_CATEGORIES_ORDER) {
        const section = sections.get(category);
        if (!section) continue;
        (section.inner || section.body).appendChild(fragmentByCategory.get(category));
    }

    ensureResultsCategoryController().updateCounts(sections, currentResults);
    ensureResultsCategoryController().syncHeights(sections);
    if (!append && startIndex === 0) lastRenderedSearch = { query: String(query || ''), dataRevision: allDataRevision };
    window.requestAnimationFrame(() => {
        const ctrl = ensureScrollIndicatorController();
        ctrl.syncResultsEndIntersectionObserver();
        ctrl.update();
    });
}

function syncRouteCategorySectionHeights(sections) {
    ensureResultsCategoryController().syncHeights(sections);
}

function ensureRouteCategorySections({ animate = false } = {}) {
    return ensureResultsCategoryController().ensureSections({ animate });
}

function updateRouteCategorySectionCounts(sections) {
    ensureResultsCategoryController().updateCounts(sections, currentResults);
}

function toggleRouteCategorySection(category) {
    ensureResultsCategoryController().toggleCategory(category);
}

function isRouteCategoryCollapsed(category) {
    const cat = String(category || '').trim();
    if (!cat) return false;
    return storageGet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${cat}`) === '1';
}

/**
 * Wyświetla widok podglądu pełnej tabeli pliku.
 */
function showFilePreview(fileName, highlightRowIndex, options = { skipPush: false, contextIsoDate: null }) {
    if (scheduleView) scheduleView.classList.add('view-hidden');
    ensurePreviewApplication().openPreview({
        fileName: String(fileName || ''),
        rowIndex: Number.isInteger(highlightRowIndex) ? highlightRowIndex : null,
        contextIsoDate: options?.contextIsoDate ?? null,
        skipPush: Boolean(options?.skipPush)
    });
}

function ensurePreviewApplication() {
    if (previewApplication) return previewApplication;
    previewApplication = createPreviewApplication({
        getTableModel: (name) => fullFileData[String(name || '')],
        pushPreview: ({ fileName, rowIndex, contextIsoDate }) => ensureNavigationService().pushPreview({ fileName, rowIndex, contextIsoDate }),
        setLastPreviewState: (s) => { lastPreviewState = s; },
        showPreview: ({ fileName, tableModel, highlightRowIndex, contextIsoDate }) => ensurePreviewController().showPreview({ fileName, tableModel, highlightRowIndex, contextIsoDate }),
        showSearch: () => ensurePreviewController().showSearch(),
        queuePreviewReadyEvent,
        logClientEvent,
        requestScrollIndicatorUpdate: () => window.requestAnimationFrame(() => window.requestAnimationFrame(() => ensureScrollIndicatorController().update()))
    });
    return previewApplication;
}

/**
 * Aktualizuje informację o liczbie znalezionych wyników.
 */
function updateResultsCountInfo() {
    updateResultsCountInfoDom(resultsInfo, { matchedCount: matchedResults.length, loadedFileCount: loadedFiles.size });
}

/**
 * Wyświetla systemowy modal z opcjami.
 */
function showModal(title, content, actions = []) {
    ensureModalController().show(title, content, actions);
}

/**
 * Ukrywa aktualnie wyświetlany modal.
 */
function hideModal() {
    ensureModalController().hide();
}

function qeBuildModalTitleHtml(title) {
    const safe = escapeHtml(String(title ?? ''));
    const hasDrive = safe.includes('Google Drive');
    const html = hasDrive ? safe.replaceAll('Google Drive', '<span class="qe-modal-gdrive">Google Drive</span>') : safe;
    return { html, hasDrive };
}

function ensureModalController() {
    if (modalController) return modalController;
    modalController = createModalController({
        modalOverlay,
        modalTitle,
        modalContent,
        modalActions,
        buildTitleHtml: qeBuildModalTitleHtml,
        setElementHtml,
        clearElement,
        onBeforeHide: () => ensureDriveChangesModalController().teardown()
    });
    return modalController;
}

function ensurePreviewController() {
    if (previewController) return previewController;
    previewController = createPreviewController({
        searchView,
        filePreviewView,
        previewMeta,
        previewFileName: document.getElementById('preview-filename'),
        tableHeader: document.getElementById('table-header'),
        tableBody: document.getElementById('table-body'),
        formatFileName,
        getRouteCategoriesFromFileName,
        extractRouteCodeFromFileName,
        getDriverForRouteOnDate,
        getDriverForRouteOnIsoDate,
        buildDriverBadgesHtml
    });
    return previewController;
}

function ensureScheduleController() {
    if (scheduleController) return scheduleController;
    scheduleController = createScheduleController({
        scheduleView,
        tableHeaderRow: scheduleTableHeader,
        tableBody: scheduleTableBody,
        monthSelect: scheduleMonthSelect,
        subtitleEl: scheduleSubtitle,
        prevMonthBtn: schedulePrevMonthBtn,
        nextMonthBtn: scheduleNextMonthBtn,
        todayBtn: scheduleTodayBtn,
        getMonthScheduleTable: (year, month) => ensureScheduleService().getMonthScheduleTable(year, month),
        markerMeanings: (qeConstants && qeConstants.SCHEDULE_MARKER_MEANINGS && typeof qeConstants.SCHEDULE_MARKER_MEANINGS === 'object')
            ? qeConstants.SCHEDULE_MARKER_MEANINGS
            : {},
        isRouteAvailable: (routeCode) => routeFileIndexByCode.has(normalizeRouteCodeForLookup(routeCode)),
        onOpenRoute: ({ routeCode, isoDate }) => openRouteFromSchedule(routeCode, isoDate),
        storageGet,
        storageSet
    });
    return scheduleController;
}

function ensureResultsCategoryController() {
    if (resultsCategoryController) return resultsCategoryController;
    resultsCategoryController = createResultsCategoryController({
        resultsList,
        categories: ROUTE_CATEGORIES_ORDER,
        getCollapsed: isRouteCategoryCollapsed,
        setCollapsed: (category, collapsed) => {
            const cat = String(category || '').trim();
            if (!cat) return;
            storageSet(`${ROUTE_CATEGORY_STORAGE_PREFIX}${cat}`, collapsed ? '1' : '0');
        },
        prefersReducedMotion,
        onLayout: () => {
            const ctrl = ensureScrollIndicatorController();
            ctrl.syncResultsEndIntersectionObserver();
            ctrl.update();
        }
    });
    return resultsCategoryController;
}

function ensureResultsRenderer() {
    if (resultsRenderer) return resultsRenderer;
    resultsRenderer = createResultsRenderer({
        formatRouteNameForResults,
        extractRouteCodeFromFileName,
        getDriverForRouteOnDate,
        buildDriverBadgesHtml,
        escapeHtml,
        setElementHtml,
        rowMatchesKeyLab,
        toTitleCase,
        highlightText,
        isEmptyCell
    });
    return resultsRenderer;
}

function ensureWelcomeProgressRenderer() {
    if (welcomeProgressRenderer) return welcomeProgressRenderer;
    welcomeProgressRenderer = createWelcomeProgressRenderer({
        formatFileName,
        escapeHtml,
        setElementHtml
    });
    return welcomeProgressRenderer;
}

function ensureLogoRenderer() {
    if (logoRenderer) return logoRenderer;
    logoRenderer = createLogoRenderer({
        setElementSvg,
        buildQuickEvoLogoSvg,
        startLogoOrbitInContainer
    });
    return logoRenderer;
}

function ensureScrollIndicatorController() {
    if (scrollIndicatorController) return scrollIndicatorController;
    scrollIndicatorController = createScrollIndicatorController({
        scrollIndicator,
        resultsList,
        resultsEndIntersection
    });
    return scrollIndicatorController;
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
    highlightLabsInPreviewTableDom({
        tbody: document.getElementById('table-body'),
        rowMatchesKeyLab,
        escapeHtml,
        toTitleCase
    });
}

function scheduleWelcomeLogoEntrance() {
    ensureWelcomeLoadingOverlayController().scheduleWelcomeLogoEntrance();
}

function startLoadingScreen() {
    ensureWelcomeLoadingOverlayController().start();
}

function stopLoadingScreen() {
    ensureWelcomeLoadingOverlayController().stop();
}

function setLoadingProgressPercent(percent, { force = false } = {}) {
    ensureWelcomeLoadingOverlayController().setProgressPercent(percent, { force });
}

function setLoadingStatusText(text) {
    ensureWelcomeLoadingOverlayController().setStatusText(text);
}

function showLoadingError(message) {
    ensureWelcomeLoadingOverlayController().showError(message);
}

function prepareManualContinue() {
    ensureWelcomeLoadingOverlayController().prepareManualContinue();
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
    lastRenderedSearch = { query: '', dataRevision: -1 };
    clearElement(resultsList);
    resultsInfo.textContent = '';
    window.requestAnimationFrame(() => {
        const ctrl = ensureScrollIndicatorController();
        ctrl.syncResultsEndIntersectionObserver();
        ctrl.update();
    });
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
    ensureLoadingApplication().continueToApp();
}

function ensureLoadingApplication() {
    if (loadingApplication) return loadingApplication;
    loadingApplication = createLoadingApplication({
        stopLoadingScreen,
        replaceHome: () => ensureNavigationService().replaceHome({ search: false }),
        getDomReadyTs: () => DOM_READY_TS,
        now: () => performance.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        requestAnimationFrame: (fn) => window.requestAnimationFrame(fn),
        showAppShell: () => { if (appShell) { appShell.classList.remove('app-shell-hidden'); appShell.setAttribute('aria-hidden', 'false'); } },
        focusSearchIfEnabled: () => { if (isSearchEnabled) searchInput.focus(); },
        updateScrollIndicator: () => ensureScrollIndicatorController().update()
    });
    return loadingApplication;
}

/**
 * Powraca do głównego widoku wyszukiwania.
 */
function goHome() {
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.add('view-hidden');
    if (searchView) searchView.classList.remove('view-hidden');
    if (isSearchEnabled) searchInput.focus();
    window.requestAnimationFrame(() => ensureScrollIndicatorController().update());
}

/**
 * Otwiera podgląd trasy z widoku grafiku, zachowując kontekst daty.
 *
 * @param {string} routeCode
 * @param {string} isoDate
 */
function openRouteFromSchedule(routeCode, isoDate) {
    const code = normalizeRouteCodeForLookup(routeCode);
    const fileName = routeFileIndexByCode.get(code);
    if (!fileName) return;
    showFilePreview(fileName, null, { contextIsoDate: String(isoDate || '').trim() || null });
}

/**
 * Pokazuje widok grafiku, ukrywając pozostałe widoki.
 */
function showScheduleShell() {
    if (searchView) searchView.classList.add('view-hidden');
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.remove('view-hidden');
}

/**
 * Wczytuje i pokazuje widok grafiku dla wybranego miesiąca.
 *
 * @param {{ ym?: string, selectedIsoDate?: (string|null), skipPush?: boolean, source?: string }} opts
 */
async function openScheduleView({ ym, selectedIsoDate, skipPush = false, source = '' } = {}) {
    showScheduleShell();
    if (scheduleSubtitle) scheduleSubtitle.textContent = 'Ładowanie grafiku...';

    const scheduleFiles = await docsListFiles();
    const monthKeys = [];
    const list = Array.isArray(scheduleFiles) ? scheduleFiles : [];
    for (const f of list) {
        const name = String(f?.name ?? '').trim();
        if (!name) continue;
        const meta = parseScheduleFileNameYearMonth(name);
        if (!meta?.key) continue;
        monthKeys.push(meta.key);
    }
    monthKeys.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
    const uniqueMonthKeys = Array.from(new Set(monthKeys));

    const now = new Date();
    const nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const requestedYm = String(ym || '').trim();
    const defaultYm = uniqueMonthKeys.includes(nowYm)
        ? nowYm
        : (uniqueMonthKeys.length > 0 ? uniqueMonthKeys[uniqueMonthKeys.length - 1] : '');
    const targetYm = uniqueMonthKeys.includes(requestedYm) ? requestedYm : defaultYm;

    const spreadsheetFiles = await getRouteSpreadsheetFiles();
    routeFileIndexByCode = buildRouteFileIndex(spreadsheetFiles);

    const ctrl = ensureScheduleController();
    ctrl.setAvailableMonthsList(uniqueMonthKeys);
    if (targetYm) ctrl.setMonthByKey(targetYm);

    const iso = typeof selectedIsoDate === 'string' ? selectedIsoDate.trim() : '';
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ctrl.setSelectedDay(iso);

    if (!skipPush && targetYm) {
        ensureNavigationService().pushSchedule({ ym: targetYm, selectedIsoDate: iso || null });
    }
    logClientEvent('navigate', { to: 'schedule', ym: targetYm, source: String(source || '') });
}

/**
 * Obsługuje powrót z widoku grafiku do poprzedniego widoku.
 * Preferuje `history.back()`, aby zachować naturalny przebieg Back/Forward.
 */
function handleBackFromSchedule() {
    const st = history.state || {};
    if (st?.view === 'schedule') {
        try { history.back(); return; } catch { }
    }
    goHome();
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
 * Normalizuje tekst do małych liter.
 */
function normalizeText(text) {
    return qeGetUtils().normalizeText(text);
}

/**
 * Normalizuje tekst usuwając polskie znaki diakrytyczne.
 */
function fuzzyNormalizeText(text) {
    return qeGetUtils().fuzzyNormalizeText(text);
}

/**
 * Formatuje wartość komórki (obsługa czasu Excela).
 */
function formatCellValue(value) {
    return qeGetUtils().formatCellValue(value);
}

/**
 * Konwertuje ułamek doby na format czasu HH:MM.
 */
function formatTimeFromDayFraction(fraction) {
    return qeGetUtils().formatTimeFromDayFraction(fraction);
}

/**
 * Parsuje ciąg znaków do formatu czasu.
 */
function parseTimeString(value) {
    return qeGetUtils().parseTimeString(value);
}

/**
 * Formatuje znacznik czasu na czytelną datę i czas.
 */
function pad2(value) {
    return qeGetUtils().pad2(value);
}

/**
 * Zabezpiecza tekst przed atakami XSS.
 */
function escapeHtml(value) {
    return qeGetUtils().escapeHtml(value);
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
        const container = ensureScrollIndicatorController().getScrollContainer();
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
    return qeGetUtils().debounce(fn, delayMs);
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
    ensureScheduleService().clearCache();
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
            invalidateScheduleFile(name);
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
    const isSearchActive = query.length >= 3;
    if (isSearchActive) {
        ensureNavigationService().setSearchState({ active: true, query });
        debouncedSearch(query); debouncedLogSearch(query);
    } else {
        debouncedSearch.cancel(); debouncedLogSearch.cancel();
        ensureNavigationService().setSearchState({ active: false, query: '' });
        if (query.length > 0) { statusIndicator.textContent = 'Wpisz minimum 3 znaki, aby wyszukać...'; statusIndicator.classList.add('status--hint'); }
        else { statusIndicator.textContent = 'Dane gotowe.'; statusIndicator.classList.remove('status--hint'); }
        clearResults();
    }
}

//////////////////////////////////////////////////
// PREDYKCJA / PODPOWIEDZI WPISYWANEJ FRAZY
//////////////////////////////////////////////////

/**
 * Planista przebudowy indeksu podpowiedzi, aby nie wykonywać kosztownej pracy wielokrotnie podczas importu.
 */
function schedulePredictiveIndexRebuild({ reason } = {}) {
    ensureSearchApplication().schedulePredictiveIndexRebuild({ reason: reason || 'unknown' });
}

/**
 * Obsługuje zbyt krótkie zapytanie wyszukiwania.
 */
function handleSearchShortQuery() {
    statusIndicator.textContent = 'Wpisz minimum 3 znaki, aby wyszukać...';
    statusIndicator.classList.add('status--hint'); clearResults();
}

// Start aplikacji
qeBootstrap();
