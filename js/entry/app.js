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
import { createDataStore } from '../core/data-store.js';
import { getAppDomRefs } from '../core/dom-refs.js';
import * as driveService from '../services/drive-service.js';
import { docsClearFilesStore, docsDeleteFiles, docsFileExists, docsGetBlob, docsGetFileRecord, docsListFiles, docsPutBlob, openDocsDb } from '../storage/docs-db.js';
import { importLocalFiles } from '../services/import-service.js';
import { createImportApplication } from '../app/import-application.js';
import { createSearchApplication } from '../app/search-application.js';
import { createPreviewApplication } from '../app/preview-application.js';
import { createDriveUnifiedSyncApplication } from '../app/drive-unified-sync-application.js';
import { createNavigationApplication } from '../app/navigation-application.js';
import { createLoadingApplication } from '../app/loading-application.js';
import { createScheduleService } from '../services/schedule-service.js';
import { createSearchOrchestrator } from '../features/search/search-orchestrator.js';
import { SEARCH_RESULTS_SORT_MODE_ALPHANUM, SEARCH_RESULTS_SORT_MODE_TIME, sortSearchResultGroups } from '../features/search/search-results-sort.js';
import { createNavigationService } from '../services/navigation-service.js';
import { createImportSummaryRenderer, createLogoRenderer, createModalController, createPreviewController, createResultsCategoryController, createResultsRenderer, createScheduleController, createWelcomeProgressRenderer, highlightLabsInPreviewTableDom, prepareResultsListDom, updateResultsCountInfoDom } from '../ui/ui-components.js';
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


//////////////////////////////////////////////////
// CACHE ELEMENTÓW DOM
//////////////////////////////////////////////////

const dom = getAppDomRefs();
const {
    searchInput,
    resultsList,
    resultsInfo,
    statusIndicator,
    fileCountSpan,
    searchSortToggle,
    themeToggle,
    themeIcon,
    importButton,
    googleDriveButton,
    scheduleButton,
    navRoutesButton,
    navDriversButton,
    navScheduleButton,
    fileInput,
    uploadProgressContainer,
    uploadProgress,
    uploadStatus,
    searchView,
    routesView,
    routesStandardGrid,
    routesEveningGrid,
    routesWeekendGrid,
    driversView,
    driversGrid,
    filePreviewView,
    backToSearchBtn,
    scheduleView,
    backToSearchFromScheduleBtn,
    scheduleTableHeader,
    scheduleTableBody,
    scheduleMonthSelect,
    schedulePrevMonthBtn,
    scheduleNextMonthBtn,
    scheduleTodayBtn,
    scheduleSubtitle,
    previewMeta,
    loadingOverlay,
    loadingTitleText,
    loadingStatusText,
    loadingProgressBar,
    loadingProgressMeta,
    loadingError,
    loadingContinueButton,
    appShell,
    appHeaderLogo,
    homeLink,
    dropZone,
    syncGDriveButton,
    modalOverlay,
    modalTitle,
    modalContent,
    modalActions,
    welcomeImportProgress,
    welcomeProgressList,
    ghostOverlay,
    ghostPrefix,
    ghostSuffix,
    suggestOverlay,
    suggestList,
    previewFileName,
    previewTableHeader,
    previewTableBody,
    welcomeGraphic
} = dom;

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

let importSummaryRenderer = null;

/** @type {{ renderHeaderLogo: Function, refreshWelcomeGraphicIfPresent: Function, lazyLoadWelcomeGraphic: Function } | null} */
let logoRenderer = null;

//////////////////////////////////////////////////
// KLUCZOWY STAN APLIKACJI
//////////////////////////////////////////////////

/**
 * Znormalizowane wiersze ze wszystkich załadowanych plików.
 * Tymczasowo zachowujemy zmienną `allData` dla kompatybilności w `app.js`,
 * ale źródłem prawdy staje się `dataStore`.
 *
 * @type {ReturnType<typeof createDataStore>}
 */
const dataStore = createDataStore();

/** @type {Array<Object>} */
let allData = dataStore.getAllData();

/**
 * Aktualnie wyświetlana strona wyników wyszukiwania.
 * Referencja pochodzi z dataStore, aby ograniczyć stan trzymany bezpośrednio w `app.js`.
 *
 * @type {Array<any>}
 */
const currentResults = dataStore.getCurrentResults();

/**
 * Wszystkie dopasowania dla bieżącego zapytania.
 * Referencja pochodzi z dataStore, aby ograniczyć stan trzymany bezpośrednio w `app.js`.
 *
 * @type {Array<any>}
 */
const matchedResults = dataStore.getMatchedResults();

/**
 * Stan potrzebny do przywrócenia scrolla listy wyników po powrocie z podglądu (Back / „Powrót”).
 * Zapisujemy zarówno `scrollTop`, jak i offset klikniętego wiersza względem górnej krawędzi kontenera,
 * żeby po powrocie odtworzyć możliwie identyczne położenie wiersza na ekranie, niezależnie od rozdzielczości.
 *
 * @type {{
 *   query: string,
 *   fileName: string,
 *   rowIndex: number,
 *   scrollTop: number,
 *   rowOffsetTop: number,
 *   ts: number
 * } | null}
 */
let pendingResultsScrollRestore = null;

/**
 * Kontroluje wielokrotne próby restore, gdy wynik DOM jeszcze się nie wyrenderował (np. po popstate + render).
 *
 * @type {{ attempt: number, maxAttempts: number, rafId: number, reason?: string } | null}
 */
let pendingResultsScrollRestoreRunner = null;

/** @type {string} Ostatnie zapytanie użyte do wyszukiwania. */
let lastQuery = ''; 

/**
 * Tryb sortowania wyników wyszukiwania (domyślnie alfanumerycznie).
 * Wartość jest przechowywana w localStorage i odczytywana podczas startu aplikacji.
 *
 * @type {string}
 */
let searchResultsSortMode = SEARCH_RESULTS_SORT_MODE_ALPHANUM;

/**
 * Klucz localStorage dla trybu sortowania wyników wyszukiwania.
 */
const SEARCH_RESULTS_SORT_MODE_STORAGE_KEY = 'qeSearchResultsSortMode';

/** @type {number} Rewizja danych (allData) używana do detekcji zmian wymagających ponownego renderu wyników. */
let allDataRevision = dataStore.getRevision();

/** @type {{ query: string, dataRevision: number }} Ostatnio wyrenderowane wyniki (zapytanie + rewizja danych). */
const lastRenderedSearch = dataStore.getLastRenderedSearch();

/** @type {Set<string>} Zbiór nazw plików, które zostały już przetworzone. */
const loadedFiles = dataStore.getLoadedFiles();

/** @type {Object<string, Object>} Mapowanie nazwy pliku na pełny model danych tabeli. */
const fullFileData = dataStore.getFullFileData(); 
let scheduleService = null;

/**
 * Indeks tras zaimportowanych do bazy (kod trasy -> nazwa pliku).
 * Używany do ograniczenia klikalności w grafiku wyłącznie do tras dostępnych w IndexedDB.
 *
 * @type {Map<string, string>}
 */
const routeFileIndexByCode = dataStore.getRouteFileIndexByCode();

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
 * Obserwatory listy wyników utrzymujące poprawny layout (np. wysokości sekcji kategorii)
 * oraz umożliwiające odtworzenie scrolla po powrocie z podglądu.
 *
 * @type {{
 *   resize: ResizeObserver | null,
 *   mutation: MutationObserver | null
 * }}
 */
let resultsListLayoutObservers = { resize: null, mutation: null };
let bootWatchdogTimer = null;

function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
        getWelcomeGraphicEl: () => welcomeGraphic,
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
        suggestOverlay,
        suggestList,
        minChars: 2,
        maxDropdownItems: 5,
        isSearchEnabled: () => isSearchEnabled,
        fuzzyNormalizeText,
        getPredictiveSuggestions: (norm, opts) => ensureSearchApplication().getPredictiveSuggestions(norm, opts),
        onAcceptSuggestion: (_query, suggestion) => { try { qeIncrementPredictiveAcceptStat(suggestion); } catch { } }
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
    setupResultsListLayoutObservers();
    compileKeyLabTokenSets();
    ensureWelcomeLoadingOverlayController().setupParallax();

    ensureLogoRenderer().lazyLoadWelcomeGraphic(welcomeGraphic);
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
        ensureLogoRenderer().refreshWelcomeGraphicIfPresent(welcomeGraphic);
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
    ensureLogoRenderer().refreshWelcomeGraphicIfPresent(welcomeGraphic);
}

/**
 * Konfiguruje przełącznik trybu sortowania wyników wyszukiwania.
 */
function setupSearchResultsSortToggle() {
    if (!searchSortToggle) return;

    const rawMode = String(storageGet(SEARCH_RESULTS_SORT_MODE_STORAGE_KEY) || '').trim();
    if (rawMode === SEARCH_RESULTS_SORT_MODE_TIME || rawMode === SEARCH_RESULTS_SORT_MODE_ALPHANUM) {
        searchResultsSortMode = rawMode;
    } else {
        searchResultsSortMode = SEARCH_RESULTS_SORT_MODE_ALPHANUM;
    }

    const applyToggleState = () => {
        const isTime = searchResultsSortMode === SEARCH_RESULTS_SORT_MODE_TIME;
        searchSortToggle.checked = isTime;
        const label = isTime ? 'Sortowanie godzinowe (najbliższa następna godzina)' : 'Sortowanie alfanumeryczne';
        searchSortToggle.setAttribute('aria-label', label);
        searchSortToggle.setAttribute('title', label);
    };

    applyToggleState();

    searchSortToggle.addEventListener('change', () => {
        searchResultsSortMode = searchSortToggle.checked ? SEARCH_RESULTS_SORT_MODE_TIME : SEARCH_RESULTS_SORT_MODE_ALPHANUM;
        storageSet(SEARCH_RESULTS_SORT_MODE_STORAGE_KEY, searchResultsSortMode);
        applyToggleState();

        const hasResults = Array.isArray(currentResults) && currentResults.length > 0;
        const activeQuery = String(lastQuery || '').trim();
        if (hasResults && activeQuery.length >= 3) {
            const sorted = sortSearchResultGroups(currentResults, { mode: searchResultsSortMode, now: new Date(), formatRouteNameForResults });
            currentResults.length = 0;
            currentResults.push(...sorted);
            void renderResults(activeQuery, { append: false, startIndex: 0 }).catch((err) => console.error(err));
        }

        logClientEvent('search_sort_mode', { mode: searchResultsSortMode });
    });
}

/**
 * Rejestruje globalne event listenery.
 */
function setupEventListeners() {
    setupSearchResultsSortToggle();
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
    if (navRoutesButton) {
        navRoutesButton.addEventListener('click', async () => {
            try { await openRoutesView({ source: 'nav' }); } catch { }
        });
    }
    if (navDriversButton) {
        navDriversButton.addEventListener('click', async () => {
            try { await openDriversView({ source: 'nav' }); } catch { }
        });
    }
    if (navScheduleButton) {
        navScheduleButton.addEventListener('click', async () => {
            try { await openScheduleView({ source: 'nav' }); } catch { }
        });
    }
    if (backToSearchFromScheduleBtn) {
        backToSearchFromScheduleBtn.addEventListener('click', () => handleBackFromSchedule());
    }
    if (routesView) {
        routesView.addEventListener('click', (e) => {
            const tile = e.target.closest('.qe-tile');
            if (!tile) return;
            const fileName = String(tile.dataset.fileName || '').trim();
            if (!fileName) return;
            showFilePreview(fileName, null);
        });
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
        showRoutesView: ({ skipPush, source } = {}) => openRoutesView({ skipPush: Boolean(skipPush), source: String(source || '') }),
        showDriversView: ({ skipPush, source } = {}) => openDriversView({ skipPush: Boolean(skipPush), source: String(source || '') }),
        setSearchInputValue: (value) => { if (searchInput) searchInput.value = String(value ?? ''); },
        performSearch: (q) => performSearch(String(q || '')),
        getIsSearchEnabled: () => Boolean(isSearchEnabled),
        clearSearchUi: () => {
            clearResults();
            statusIndicator.textContent = 'Dane gotowe.';
            statusIndicator.classList.remove('status--hint');
        },
        restoreSearchScroll: ({ state, source } = {}) => {
            const q = String(state?.query || '').trim();
            if (pendingResultsScrollRestore && q) pendingResultsScrollRestore.query = q;
            requestResultsScrollRestore({ reason: String(source || '') });
        },
        onPageshowRestore: () => requestResultsScrollRestore({ reason: 'pageshow' }),
        canOpenPreview: (fileName) => Boolean(fullFileData && fullFileData[String(fileName || '')]),
        isHomeState: () => Boolean(history.state && history.state.view === 'home' && !history.state.search && !searchInput.value),
        shouldIgnoreHomeClick: (e) => Boolean(e?.metaKey || e?.ctrlKey || e?.shiftKey || e?.altKey),
        onScrollTop: () => {
            try { if (resultsList) resultsList.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { try { if (resultsList) resultsList.scrollTop = 0; } catch { } }
            try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { try { window.scrollTo(0, 0); } catch { } }
        },
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
 * Konfiguruje obserwatory listy wyników, aby:
 * - utrzymać poprawne wysokości sekcji kategorii (po renderze i mutacjach DOM),
 * - umożliwić deterministyczne przywrócenie scrolla po powrocie z podglądu.
 */
function setupResultsListLayoutObservers() {
    if (!resultsList) return;

    const debouncedUpdate = debounce(() => {
        syncRouteCategorySectionHeights();
        requestResultsScrollRestore({ reason: 'results_list_layout' });
    }, 120);

    if (resultsListLayoutObservers.mutation) {
        try { resultsListLayoutObservers.mutation.disconnect(); } catch { }
        resultsListLayoutObservers.mutation = null;
    }
    if (resultsListLayoutObservers.resize) {
        try { resultsListLayoutObservers.resize.disconnect(); } catch { }
        resultsListLayoutObservers.resize = null;
    }

    resultsListLayoutObservers.mutation = new MutationObserver(() => debouncedUpdate());
    resultsListLayoutObservers.mutation.observe(resultsList, { childList: true, subtree: true, attributes: true });

    if (typeof ResizeObserver === 'function') {
        resultsListLayoutObservers.resize = new ResizeObserver(() => debouncedUpdate());
        resultsListLayoutObservers.resize.observe(resultsList);
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
    const container = welcomeGraphic;
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
        dataStore.setRouteFileIndexByCode(buildRouteFileIndex(spreadsheetFiles));
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
        try {
            const payload = qeBuildPredictiveSourcePayloadFromTableModel(tableModel, fileName);
            if (payload) ensureSearchApplication().upsertPredictiveSource(fileName, payload);
        } catch { }
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



function ensureImportApplication() {
    if (importApplication) return importApplication;
    importApplication = createImportApplication({
        importLocalFiles,
        maxImportBytes: MAX_IMPORT_BYTES,
        fileExists: docsFileExists,
        getFileRecord: docsGetFileRecord,
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
    dataStore.addRows(normalizedRows);
    allDataRevision = dataStore.getRevision();
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
                predictiveIndexMode: 'trie',
                getPredictiveAcceptCount: (fuzzyKey) => qeGetPredictiveAcceptCount(fuzzyKey),
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
        setMatchedResults: (results) => {
            matchedResults.length = 0;
            const list = Array.isArray(results) ? results : [];
            matchedResults.push(...list);
        },
        setCurrentResults: (results) => {
            const list = Array.isArray(results) ? results : [];
            const sorted = sortSearchResultGroups(list, { mode: searchResultsSortMode, now: new Date(), formatRouteNameForResults });
            currentResults.length = 0;
            currentResults.push(...sorted);
        },
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
    dataStore.setAllData(allData.filter(d => d?.fileName !== safe));
    if (allData.length !== beforeLen) allDataRevision = dataStore.getRevision();
    delete fullFileData[safe];
    loadErrors = loadErrors.filter(e => e?.fileName !== safe);
    try { ensureSearchApplication().removePredictiveSource(safe); } catch { }
}

/**
 * Resetuje kluczowe dane aplikacji.
 */
function resetAppData() {
    dataStore.reset(); lastQuery = '';
    dataStore.clearLoadedFiles(); dataStore.clearFullFileData(); loadErrors = [];
    routeFileIndexByCode.clear();
    allDataRevision = dataStore.getRevision();
    dataStore.clearCurrentResults();
    dataStore.clearMatchedResults();
    dataStore.resetLastRenderedSearch();
    try { schedulePredictiveIndexRebuild({ reason: 'full_reload_force' }); } catch { }
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
        requestResultsScrollRestore({ reason: 'render_results_empty' });
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
    if (!append && startIndex === 0) {
        lastRenderedSearch.query = String(query || '');
        lastRenderedSearch.dataRevision = allDataRevision;
    }
    window.requestAnimationFrame(() => {
        try { syncRouteCategorySectionHeights(sections); } catch { }
        requestResultsScrollRestore({ reason: 'render_results' });
    });
}

function cssEscapeAttrValue(value) {
    const v = String(value ?? '');
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(v);
    return v.replace(/["\\\]]/g, '\\$&');
}

function findResultRowElement(fileName, rowIndex) {
    if (!resultsList) return null;
    const safeName = String(fileName ?? '');
    const idx = Number(rowIndex);
    if (!safeName || !Number.isFinite(idx)) return null;
    const selector = `.result-row[data-file-name="${cssEscapeAttrValue(safeName)}"][data-row-index="${String(idx)}"]`;
    try { return resultsList.querySelector(selector); } catch { return null; }
}

function clearActiveResultRow() {
    if (!resultsList) return;
    const active = resultsList.querySelectorAll('.result-row--active');
    for (const el of active) {
        try { el.classList.remove('result-row--active'); } catch { }
    }
}

function cancelResultsScrollRestore() {
    if (!pendingResultsScrollRestoreRunner) return;
    try { window.cancelAnimationFrame(pendingResultsScrollRestoreRunner.rafId); } catch { }
    pendingResultsScrollRestoreRunner = null;
}

function applyResultsScrollRestoreOnce() {
    if (!pendingResultsScrollRestore || !resultsList) return true;

    const expectedQuery = String(pendingResultsScrollRestore.query || '').trim();
    const currentQuery = String(lastQuery || '').trim();
    if (expectedQuery && currentQuery && expectedQuery !== currentQuery) {
        pendingResultsScrollRestore = null;
        return true;
    }

    const rowEl = findResultRowElement(pendingResultsScrollRestore.fileName, pendingResultsScrollRestore.rowIndex);
    if (!rowEl) return false;

    clearActiveResultRow();
    try { rowEl.classList.add('result-row--active'); } catch { }

    const rowRect = rowEl.getBoundingClientRect();
    const containerRect = resultsList.getBoundingClientRect();
    const currentScrollTop = Number(resultsList.scrollTop) || 0;
    const rowTopInContainer = (rowRect.top - containerRect.top) + currentScrollTop;
    const savedOffset = Number(pendingResultsScrollRestore.rowOffsetTop);
    const savedScrollTop = Number(pendingResultsScrollRestore.scrollTop);

    let desiredScrollTop = Number.isFinite(savedOffset)
        ? (rowTopInContainer - savedOffset)
        : (Number.isFinite(savedScrollTop) ? savedScrollTop : 0);

    const maxScrollTop = Math.max(0, resultsList.scrollHeight - resultsList.clientHeight);
    desiredScrollTop = Math.min(Math.max(0, desiredScrollTop), maxScrollTop);

    try { resultsList.scrollTop = desiredScrollTop; } catch { }

    try {
        const afterRowRect = rowEl.getBoundingClientRect();
        const afterContainerRect = resultsList.getBoundingClientRect();
        const margin = 10;
        const isVisible = afterRowRect.top >= afterContainerRect.top + margin && afterRowRect.bottom <= afterContainerRect.bottom - margin;
        if (!isVisible && typeof rowEl.scrollIntoView === 'function') rowEl.scrollIntoView({ block: 'nearest' });
    } catch { }

    pendingResultsScrollRestore = null;
    return true;
}

/**
 * Próbuje przywrócić scroll listy wyników po powrocie z podglądu.
 * Mechanizm odpala się wielokrotnie w `requestAnimationFrame`, aby poczekać na render DOM po `popstate`.
 *
 * @param {{ reason?: string }} [opts]
 */
function requestResultsScrollRestore(opts = {}) {
    if (!pendingResultsScrollRestore || !resultsList) return;
    if (pendingResultsScrollRestoreRunner) return;

    pendingResultsScrollRestoreRunner = {
        attempt: 0,
        maxAttempts: 24,
        rafId: 0,
        reason: String(opts?.reason || '')
    };
    const run = () => {
        if (!pendingResultsScrollRestoreRunner) return;
        const done = applyResultsScrollRestoreOnce();
        if (done) { pendingResultsScrollRestoreRunner = null; return; }
        pendingResultsScrollRestoreRunner.attempt += 1;
        if (pendingResultsScrollRestoreRunner.attempt >= pendingResultsScrollRestoreRunner.maxAttempts) {
            pendingResultsScrollRestoreRunner = null;
            pendingResultsScrollRestore = null;
            return;
        }
        pendingResultsScrollRestoreRunner.rafId = window.requestAnimationFrame(run);
    };

    pendingResultsScrollRestoreRunner.rafId = window.requestAnimationFrame(run);
}

/**
 * Zapamiętuje pozycję scrolla i kontekst klikniętego wyniku, żeby po Back/„Powrót” wrócić dokładnie
 * w to samo miejsce na liście.
 *
 * @param {Element|null} anchorEl
 * @param {{ fileName?: string, rowIndex?: number }} opts
 */
function capturePendingResultsScrollRestore(anchorEl, { fileName, rowIndex } = {}) {
    if (!resultsList) return;
    const safeName = String(fileName ?? '');
    const idx = Number(rowIndex);
    if (!safeName || !Number.isFinite(idx)) return;

    cancelResultsScrollRestore();

    const scrollTop = Number(resultsList.scrollTop) || 0;
    let rowOffsetTop = 0;
    try {
        if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
            const rowRect = anchorEl.getBoundingClientRect();
            const containerRect = resultsList.getBoundingClientRect();
            const off = rowRect.top - containerRect.top;
            if (Number.isFinite(off)) rowOffsetTop = off;
        }
    } catch { }

    pendingResultsScrollRestore = {
        query: String(lastQuery || '').trim(),
        fileName: safeName,
        rowIndex: idx,
        scrollTop,
        rowOffsetTop,
        ts: Date.now()
    };

    const rowEl = anchorEl && anchorEl.classList && anchorEl.classList.contains('result-row')
        ? anchorEl
        : findResultRowElement(safeName, idx);
    if (rowEl) {
        clearActiveResultRow();
        try { rowEl.classList.add('result-row--active'); } catch { }
    }
}

function syncRouteCategorySectionHeights(sections) {
    ensureResultsCategoryController().syncHeights(sections);
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
    if (routesView) routesView.classList.add('view-hidden');
    if (driversView) driversView.classList.add('view-hidden');
    setPrimaryNavActive(null);
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
        logClientEvent
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
        previewFileName,
        tableHeader: previewTableHeader,
        tableBody: previewTableBody,
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
        onLayout: () => requestResultsScrollRestore({ reason: 'results_category_layout' })
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

function ensureImportSummaryRenderer() {
    if (importSummaryRenderer) return importSummaryRenderer;
    importSummaryRenderer = createImportSummaryRenderer({ formatFileName, escapeHtml, now: () => Date.now() });
    return importSummaryRenderer;
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

/**
 * Wyświetla podsumowanie po zakończeniu importu.
 */
function displayImportSummary(summary) {
    setElementHtml(resultsInfo, ensureImportSummaryRenderer().buildHtml(summary));
}

/**
 * Podświetla laboratoria w tabeli podglądu.
 */
function highlightLabsInPreviewTable() {
    highlightLabsInPreviewTableDom({
        tbody: previewTableBody,
        rowMatchesKeyLab,
        escapeHtml,
        toTitleCase
    });
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
    lastQuery = '';
    dataStore.clearMatchedResults();
    dataStore.clearCurrentResults();
    dataStore.resetLastRenderedSearch();
    clearElement(resultsList);
    resultsInfo.textContent = '';
    clearActiveResultRow();
    cancelResultsScrollRestore();
    pendingResultsScrollRestore = null;
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
        focusSearchIfEnabled: () => { if (isSearchEnabled) searchInput.focus(); }
    });
    return loadingApplication;
}

function setPrimaryNavActive(activeKey) {
    const items = [
        { key: 'routes', el: navRoutesButton },
        { key: 'drivers', el: navDriversButton },
        { key: 'schedule', el: navScheduleButton }
    ];
    for (const it of items) {
        if (!it.el) continue;
        try { it.el.classList.remove('is-active'); } catch { }
        try { it.el.removeAttribute('aria-current'); } catch { }
    }
    const key = String(activeKey || '').trim();
    if (!key) return;
    const target = items.find(i => i.key === key);
    if (!target?.el) return;
    try { target.el.classList.add('is-active'); } catch { }
    try { target.el.setAttribute('aria-current', 'page'); } catch { }
}

/**
 * Powraca do głównego widoku wyszukiwania.
 */
function goHome() {
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.add('view-hidden');
    if (routesView) routesView.classList.add('view-hidden');
    if (driversView) driversView.classList.add('view-hidden');
    if (searchView) searchView.classList.remove('view-hidden');
    setPrimaryNavActive(null);
    if (isSearchEnabled) searchInput.focus();
    requestResultsScrollRestore({ reason: 'go_home' });
}

function renderTileGrid(containerEl, items, { emptyText = 'Brak danych.', passive = false } = {}) {
    if (!containerEl) return;
    clearElement(containerEl);

    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'status status--hint';
        empty.textContent = String(emptyText || 'Brak danych.');
        containerEl.appendChild(empty);
        return;
    }

    for (const item of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = passive ? 'qe-tile is-passive' : 'qe-tile';
        const variantRaw = String(item?.variant ?? '').trim().toUpperCase();
        const variant = variantRaw.replace(/[^A-Z0-9_-]/g, '');
        if (variant) btn.classList.add(`qe-tile--${variant}`);
        btn.textContent = String(item?.label ?? '');
        btn.setAttribute('role', 'listitem');
        const fileName = String(item?.fileName ?? '').trim();
        if (fileName) btn.dataset.fileName = fileName;
        containerEl.appendChild(btn);
    }
}

async function renderRoutesView() {
    const spreadsheetFiles = await getRouteSpreadsheetFiles();
    const files = Array.isArray(spreadsheetFiles) ? spreadsheetFiles : [];

    const standard = [];
    const evening = [];
    const weekend = [];

    /**
     * Buduje etykietę kafelka trasy bez prefiksu "TRASA", aby oszczędzić miejsce w UI.
     *
     * W praktyce:
     * - preferuje kod trasy wyciągnięty z nazwy pliku (np. "1", "A", "S-12"),
     * - w razie braku kodu, fallback do formatowania używanego w wynikach wyszukiwania.
     *
     * @param {string} fileName
     * @returns {string}
     */
    const buildRouteTileLabel = (fileName) => {
        const code = String(extractRouteCodeFromFileName(fileName) || '').trim();
        if (code) return code;
        const fallback = String(formatRouteNameForResults(fileName) || '').trim();
        return fallback.replace(/^\s*trasa\s+/i, '').trim();
    };

    /**
     * Dobiera wariant wizualny kafelka trasy na podstawie kategorii i/lub prefiksu kodu.
     * Kolory odpowiadają chipom z widoku grafiku.
     *
     * @param {string[]} categories
     * @param {string} label
     * @returns {string}
     */
    const resolveRouteTileVariant = (categories, label) => {
        const cats = Array.isArray(categories) ? categories.map(c => String(c || '').trim().toUpperCase()).filter(Boolean) : [];
        if (cats.includes('WIECZOREK')) return 'WIECZOREK';
        const code = String(label || '').trim().toUpperCase();
        if (code.startsWith('S-') || cats.includes('SOBOTA')) return 'SOBOTA';
        if (code.startsWith('N-') || cats.includes('NIEDZIELA')) return 'NIEDZIELA';
        return 'STANDARD';
    };

    for (const fileName of files) {
        const name = String(fileName ?? '').trim();
        if (!name) continue;
        const cats = getRouteCategoriesFromFileName(name);
        const categories = Array.isArray(cats) ? cats.map(c => String(c || '').trim().toUpperCase()).filter(Boolean) : [];
        const label = buildRouteTileLabel(name);
        const model = { fileName: name, label, variant: resolveRouteTileVariant(categories, label) };

        if (categories.includes('WIECZOREK')) evening.push(model);
        else if (categories.includes('SOBOTA') || categories.includes('NIEDZIELA')) weekend.push(model);
        else standard.push(model);
    }

    /**
     * Sortowanie kafelków tras „0-9 i A-Z” (naturalne) z kontrolą pierwszeństwa:
     * - STANDARD: zaczyna od tras numerycznych (0-9...), potem alfabetycznych (A-Z...),
     * - WIECZOREK: zaczyna od tras alfabetycznych (A-Z...), potem numerycznych (0-9...),
     * - liczby są porównywane numerycznie (2 < 10),
     * - porównanie jest odporne na mieszane formaty (np. A-1, S-12).
     */
    const createRouteTilesComparator = ({ preferDigitsFirst }) => {
        const digitsFirst = Boolean(preferDigitsFirst);

        const extractCode = (label) => {
            const raw = String(label ?? '').trim();
            const m = raw.match(/^\s*trasa\s+(.+)\s*$/i);
            return String(m?.[1] ?? raw).trim();
        };

        const classify = (code) => {
            const c = String(code ?? '').trim();
            if (!c) return 2;
            const isDigitStart = /^\d/.test(c);
            const isAlphaStart = /^[A-Za-zĄĆĘŁŃÓŚŹŻ]/.test(c);
            if (isDigitStart) return digitsFirst ? 0 : 1;
            if (isAlphaStart) return digitsFirst ? 1 : 0;
            return 2;
        };

        const tokenize = (code) => {
            const c = String(code ?? '').toUpperCase();
            const parts = c.match(/[0-9]+|[A-ZĄĆĘŁŃÓŚŹŻ]+/g);
            return Array.isArray(parts) && parts.length > 0 ? parts : [c];
        };

        return (a, b) => {
            const codeA = extractCode(a?.label);
            const codeB = extractCode(b?.label);
            const groupA = classify(codeA);
            const groupB = classify(codeB);
            if (groupA !== groupB) return groupA - groupB;

            const toksA = tokenize(codeA);
            const toksB = tokenize(codeB);
            const max = Math.max(toksA.length, toksB.length);
            for (let i = 0; i < max; i++) {
                const ta = toksA[i];
                const tb = toksB[i];
                if (ta === undefined) return -1;
                if (tb === undefined) return 1;
                if (ta === tb) continue;

                const na = ta.match(/^\d+$/) ? Number(ta) : NaN;
                const nb = tb.match(/^\d+$/) ? Number(tb) : NaN;
                const isNumA = Number.isFinite(na);
                const isNumB = Number.isFinite(nb);

                if (isNumA && isNumB) {
                    if (na !== nb) return na - nb;
                    continue;
                }
                if (!isNumA && !isNumB) {
                    const r = String(ta).localeCompare(String(tb), 'pl', { sensitivity: 'base' });
                    if (r !== 0) return r;
                    continue;
                }
                return isNumA ? 1 : -1;
            }

            return 0;
        };
    };

    const standardCmp = createRouteTilesComparator({ preferDigitsFirst: true });
    const eveningCmp = createRouteTilesComparator({ preferDigitsFirst: false });
    const weekendBaseCmp = createRouteTilesComparator({ preferDigitsFirst: true });
    const weekendCmp = (a, b) => {
        const codeA = String(a?.label ?? '').trim().toUpperCase();
        const codeB = String(b?.label ?? '').trim().toUpperCase();
        const group = (code) => {
            if (code.startsWith('S-')) return 0;
            if (code.startsWith('N-')) return 2;
            return 1;
        };
        const ga = group(codeA);
        const gb = group(codeB);
        if (ga !== gb) return ga - gb;
        return weekendBaseCmp(a, b);
    };

    standard.sort(standardCmp);
    evening.sort(eveningCmp);
    weekend.sort(weekendCmp);

    renderTileGrid(routesStandardGrid, standard, { emptyText: 'Brak tras standardowych.' });
    renderTileGrid(routesEveningGrid, evening, { emptyText: 'Brak tras wieczorowych.' });
    renderTileGrid(routesWeekendGrid, weekend, { emptyText: 'Brak tras na soboty i święta.' });
}

async function renderDriversView() {
    await loadScheduleFiles({ fullReload: false, showProgress: false });
    const scheduleFiles = await docsListFiles();
    const list = Array.isArray(scheduleFiles) ? scheduleFiles : [];

    const names = new Set();
    for (const f of list) {
        const name = String(f?.name ?? '').trim();
        if (!name) continue;
        const meta = parseScheduleFileNameYearMonth(name);
        if (!meta?.year || !meta?.month) continue;
        const table = ensureScheduleService().getMonthScheduleTable(meta.year, meta.month);
        const rows = Array.isArray(table?.rows) ? table.rows : [];
        for (const r of rows) {
            const dn = String(r?.driverName ?? '').trim();
            if (dn) names.add(dn);
        }
    }

    const drivers = Array.from(names).sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
    const tiles = drivers.map(d => ({ label: d }));
    renderTileGrid(driversGrid, tiles, { emptyText: 'Brak kierowców w zaimportowanych plikach grafiku.', passive: true });
}

function showRoutesShell() {
    if (searchView) searchView.classList.add('view-hidden');
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.add('view-hidden');
    if (driversView) driversView.classList.add('view-hidden');
    if (routesView) routesView.classList.remove('view-hidden');
    setPrimaryNavActive('routes');
}

function showDriversShell() {
    if (searchView) searchView.classList.add('view-hidden');
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.add('view-hidden');
    if (routesView) routesView.classList.add('view-hidden');
    if (driversView) driversView.classList.remove('view-hidden');
    setPrimaryNavActive('drivers');
}

async function openRoutesView({ skipPush = false, source = '' } = {}) {
    showRoutesShell();
    await renderRoutesView();
    if (!skipPush) ensureNavigationService().pushRoutes();
    logClientEvent('navigate', { to: 'routes', source: String(source || '') });
}

async function openDriversView({ skipPush = false, source = '' } = {}) {
    showDriversShell();
    await renderDriversView();
    if (!skipPush) ensureNavigationService().pushDrivers();
    logClientEvent('navigate', { to: 'drivers', source: String(source || '') });
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
    if (routesView) routesView.classList.add('view-hidden');
    if (driversView) driversView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.remove('view-hidden');
    setPrimaryNavActive('schedule');
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
    dataStore.setRouteFileIndexByCode(buildRouteFileIndex(spreadsheetFiles));

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
    const thead = previewTableHeader, tbody = previewTableBody;
    clearElement(thead); clearElement(tbody);
    if (previewMeta) { previewMeta.textContent = ''; previewMeta.classList.add('hidden'); }
    if (previewFileName) previewFileName.replaceChildren();
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
 * Parsuje ciąg znaków do formatu czasu.
 */
function parseTimeString(value) {
    return qeGetUtils().parseTimeString(value);
}

/**
 * Zabezpiecza tekst przed atakami XSS.
 */
function escapeHtml(value) {
    return qeGetUtils().escapeHtml(value);
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
        if (fileName && !isNaN(rowIndex)) {
            capturePendingResultsScrollRestore(row, { fileName, rowIndex });
            showFilePreview(fileName, rowIndex);
        }
        return;
    }
    const group = e.target.closest('.result-group');
    if (group) {
        const index = parseInt(group.dataset.index), groupData = currentResults[index];
        if (groupData) {
            const firstRow = group.querySelector('.result-row');
            capturePendingResultsScrollRestore(firstRow || group, { fileName: groupData.fileName, rowIndex: groupData.items[0].rowIndex });
            showFilePreview(groupData.fileName, groupData.items[0].rowIndex);
        }
    }
});

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
 * Minimalna liczba znaków dla predykcji (zgodna z ghostem i orchestrator'em).
 */
const QE_PREDICT_MIN_CHARS = 2;

/**
 * Klucz localStorage do statystyk akceptacji predykcji.
 */
const QE_PREDICT_ACCEPT_STORAGE_KEY = 'qePredictiveAcceptStatsV1';

/**
 * Maksymalna liczba wariantów (sufiksów) generowanych dla jednej frazy.
 * Odpowiada dotychczasowemu zachowaniu predykcji, aby zminimalizować ryzyko regresji.
 */
const QE_PREDICT_MAX_VARIANTS = 8;

/**
 * Bufor statystyk akceptacji predykcji:
 * fuzzyKey -> liczba akceptacji.
 *
 * @type {Map<string, number>|null}
 */
let qePredictiveAcceptStats = null;

/**
 * @type {number|null}
 */
let qePredictiveAcceptWriteTimer = null;

/**
 * Rozszerza popularne skróty adresowe dla predykcji (ul./pl./al./os.).
 *
 * @param {string} text
 * @returns {string}
 */
function qeExpandPredictiveAbbreviations(text) {
    const raw = String(text ?? '');
    if (!raw) return '';
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t) return '';

    const replaceWord = (src, re, next) => src.replace(re, `$1${next}$2`);
    let out = t;
    out = replaceWord(out, /(^|\s)(ul)\.?(?=\s|$)/gi, 'ulica');
    out = replaceWord(out, /(^|\s)(pl)\.?(?=\s|$)/gi, 'plac');
    out = replaceWord(out, /(^|\s)(al)\.?(?=\s|$)/gi, 'aleja');
    out = replaceWord(out, /(^|\s)(os)\.?(?=\s|$)/gi, 'osiedle');
    return out;
}

/**
 * Normalizacja rozmyta dla predykcji (z obsługą skrótów).
 *
 * @param {unknown} text
 * @returns {string}
 */
function qePredictiveFuzzyNormalizeText(text) {
    return fuzzyNormalizeText(qeExpandPredictiveAbbreviations(String(text ?? '')));
}

/**
 * Wczytuje statystyki akceptacji z localStorage do Mapy.
 *
 * @returns {Map<string, number>}
 */
function qeLoadPredictiveAcceptStats() {
    const map = new Map();
    let raw = '';
    try { raw = String(localStorage.getItem(QE_PREDICT_ACCEPT_STORAGE_KEY) || ''); } catch { raw = ''; }
    if (!raw) return map;
    try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return map;
        for (const [k, v] of Object.entries(obj)) {
            const key = String(k || '').trim();
            const n = Math.max(0, Number(v || 0));
            if (key && Number.isFinite(n) && n > 0) map.set(key, n);
        }
    } catch { }
    return map;
}

/**
 * Zwraca liczbę akceptacji dla danego klucza rozmytego (fuzzyKey).
 *
 * @param {unknown} fuzzyKey
 * @returns {number}
 */
function qeGetPredictiveAcceptCount(fuzzyKey) {
    if (!qePredictiveAcceptStats) qePredictiveAcceptStats = qeLoadPredictiveAcceptStats();
    const k = String(fuzzyKey ?? '').trim();
    if (!k) return 0;
    return Math.max(0, Number(qePredictiveAcceptStats.get(k) || 0));
}

/**
 * Zapisuje statystyki akceptacji do localStorage z krótkim opóźnieniem (batching),
 * aby ograniczyć liczbę zapisów przy częstych akceptacjach.
 */
function qeSchedulePredictiveAcceptStatsWrite() {
    if (qePredictiveAcceptWriteTimer) return;
    qePredictiveAcceptWriteTimer = globalThis.setTimeout?.(() => {
        qePredictiveAcceptWriteTimer = null;
        try {
            const map = qePredictiveAcceptStats || new Map();
            const obj = Object.fromEntries(Array.from(map.entries()));
            localStorage.setItem(QE_PREDICT_ACCEPT_STORAGE_KEY, JSON.stringify(obj));
        } catch { }
    }, 250);
}

/**
 * Zwiększa licznik akceptacji dla zaakceptowanej sugestii.
 *
 * @param {unknown} suggestion
 */
function qeIncrementPredictiveAcceptStat(suggestion) {
    const s = String(suggestion ?? '').trim();
    if (!s) return;
    if (!qePredictiveAcceptStats) qePredictiveAcceptStats = qeLoadPredictiveAcceptStats();
    const key = qePredictiveFuzzyNormalizeText(s);
    if (!key) return;
    const next = qeGetPredictiveAcceptCount(key) + 1;
    qePredictiveAcceptStats.set(key, next);
    qeSchedulePredictiveAcceptStatsWrite();
}

/**
 * Dodaje wartość do mapy predykcji w postaci:
 * fuzzyKey -> { value, count }
 *
 * @param {Map<string, { value: string, count: number }>} map
 * @param {unknown} rawValue
 */
function qeAddPredictiveValue(map, rawValue) {
    const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const key = qePredictiveFuzzyNormalizeText(value);
    if (!key) return;
    const prev = map.get(key);
    if (!prev) map.set(key, { value, count: 1 });
    else prev.count += 1;
}

/**
 * Dodaje wartość oraz jej warianty sufiksowe (od kolejnych tokenów).
 * Zachowuje ten sam wzorzec tokenizacji co poprzednia implementacja orchestratora.
 *
 * @param {Map<string, { value: string, count: number }>} map
 * @param {unknown} rawValue
 */
function qeAddPredictiveValueWithVariants(map, rawValue) {
    const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    qeAddPredictiveValue(map, value);

    const tokenRe = /[^\s,.;:/\\\-–—()]+/g;
    const matches = Array.from(value.matchAll(tokenRe));
    if (matches.length <= 1) return;

    let added = 0;
    for (let i = 1; i < matches.length && added < QE_PREDICT_MAX_VARIANTS; i++) {
        const idx = matches[i]?.index;
        if (typeof idx !== 'number' || idx < 0) continue;
        const phrase = value.slice(idx).trimStart();
        if (phrase.length < QE_PREDICT_MIN_CHARS) continue;
        qeAddPredictiveValue(map, phrase);
        added += 1;
    }
}

/**
 * Buduje payload predykcyjny dla pojedynczego pliku na podstawie `tableModel`.
 * Używane do aktualizacji inkrementalnej indeksu Trie po imporcie lub podmianie pliku.
 *
 * @param {string} fileName
 * @returns {{ importedAt: number, byType: { address: Map<string, { value: string, count: number }>, facility: Map<string, { value: string, count: number }> } } | null}
 */
function qeBuildPredictiveSourcePayloadFromTableModel(tableModel, fileName) {
    const safe = String(fileName || '').trim();
    if (!safe) return null;
    if (!tableModel || !Array.isArray(tableModel.rows) || !tableModel.headerMap) return null;

    const address = new Map();
    const facility = new Map();

    const isComplete = Boolean(tableModel.isCompleteStructure);
    const h = tableModel.headerMap;
    for (const row of tableModel.rows) {
        if (!isComplete || !row || !Array.isArray(row.cells)) continue;
        const addr = String(row.cells[h.ADRES] || '').trim();
        if (addr) qeAddPredictiveValueWithVariants(address, addr);

        const fac = String(row.cells[h.NAZWA_PLACOWKI] || '').trim();
        if (fac) qeAddPredictiveValueWithVariants(facility, fac);
    }

    return { importedAt: Date.now(), byType: { address, facility } };
}

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
