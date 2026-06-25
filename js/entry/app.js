/**
 * QuickEvo - Logika Frontendowa
 * 
 * Aplikacja do wyszukiwania tras i dokumentów w plikach Excel (.xlsx, .xls) oraz CSV.
 * Obsługuje synchronizację plików z Google Drive oraz lokalne przetwarzanie danych w przeglądarce.
 * Wykorzystuje IndexedDB do przechowywania plików i Web Workers (opcjonalnie) do przetwarzania.
 */

import * as utils from '../core/utils.js';
import * as searchEngine from '../core/search-engine.js';
import * as state from '../core/state.js';
import * as excelProcessor from '../core/excel-processor.js';
import { buildRouteFileIndex, createDataStore, extractRouteCodeFromFileName, normalizeRouteCodeForLookup } from '../core/data-store.js';
import { getAppDomRefs } from '../core/dom-refs.js';
import { buildSimpleXlsxDiff } from '../core/simple-xlsx-diff.js';
import * as driveService from '../services/drive-service.js';
import { docsClearFilesStore, docsDeleteFiles, docsGetBlob, docsGetFileRecord, docsListFiles, docsPutBlob, openDocsDb } from '../storage/docs-db.js';
import { createSearchApplication } from '../app/search-application.js';
import { createPreviewApplication } from '../app/preview-application.js';
import { createDriveUnifiedSyncApplication } from '../app/drive-unified-sync-application.js';
import { createNavigationApplication } from '../app/navigation-application.js';
import { createLoadingApplication } from '../app/loading-application.js';
import { createDriverContactsService } from '../services/driver-contacts-service.js';
import { createScheduleService } from '../services/schedule-service.js';
import { createSearchOrchestrator } from '../features/search/search-orchestrator.js';
import { SEARCH_RESULTS_SORT_MODE_ALPHANUM, SEARCH_RESULTS_SORT_MODE_TIME, sortSearchResultGroups } from '../features/search/search-results-sort.js';
import { createNavigationService } from '../services/navigation-service.js';
import { createImportSummaryRenderer, createLogoRenderer, createModalController, createPreviewController, createResultsCategoryController, createResultsRenderer, createScheduleController, createWelcomeProgressRenderer, highlightLabsInPreviewTableDom, prepareResultsListDom, updateResultsCountInfoDom } from '../ui/ui-components.js';
import { createDriveChangesModalController } from '../ui/drive/drive-changes-modal.js';
import { createXlsxDiffModalController } from '../ui/drive/xlsx-diff-modal.js';
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
let searchApplication = null;
let previewApplication = null;
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
 * Stały identyfikator pliku Google Drive z kontaktami kierowców.
 */
const DRIVE_DRIVER_CONTACTS_FILE_ID = '1Er4pGFK3_5_nsAPKO5xgyWfgO1UUoYws';

/**
 * Typ źródła pliku kontaktów kierowców zapisywany w IndexedDB.
 */
const DRIVER_CONTACTS_SOURCE_KIND = 'driver_contacts';

/**
 * Testowe numery rejestracyjne wykorzystywane tymczasowo w UI kierowców.
 *
 * Docelowo pole zostanie podmienione na dane z osobnego pliku źródłowego.
 */
const DRIVER_TEST_REGISTRATIONS = Object.freeze(['WG T3ST', 'WND T3ST', 'WW T3ST', 'WB T3ST', 'WU T3ST']);


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
    googleDriveButton,
    scheduleButton,
    navRoutesButton,
    navDriversButton,
    navScheduleButton,
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
    scheduleTableContainer,
    scheduleTableHeader,
    scheduleTableBody,
    scheduleMonthSelect,
    schedulePrevMonthBtn,
    scheduleNextMonthBtn,
    scheduleTodayBtn,
    scheduleSelectedDay,
    scheduleSubtitle,
    scheduleDriverFilter,
    scheduleRouteFilter,
    scheduleRouteFilterOptions,
    scheduleClearFiltersBtn,
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
    ghostHint,
    previewFileName,
    previewTableHeader,
    previewTableBody,
    welcomeGraphic
} = dom;

/** @type {{ show: Function, hide: Function } | null} */
let modalController = null;

/** @type {{ showSearch: Function, showPreview: Function } | null} */
let previewController = null;

/** @type {{ isVisible: Function, getViewState: Function, resetViewState: Function, restoreViewState: Function, setAvailableMonthsList: Function, setMonthByKey: Function, renderMonthDays: Function, setSelectedDay: Function, goToday: Function } | null} */
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
const allData = dataStore.getAllData();

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

/** @type {{ query: string, dataRevision: number }} Ostatnio wyrenderowane wyniki (zapytanie + rewizja danych). */
const lastRenderedSearch = dataStore.getLastRenderedSearch();

/** @type {Set<string>} Zbiór nazw plików, które zostały już przetworzone. */
const loadedFiles = dataStore.getLoadedFiles();

/** @type {Object<string, Object>} Mapowanie nazwy pliku na pełny model danych tabeli. */
const fullFileData = dataStore.getFullFileData(); 
let scheduleService = null;
let driverContactsService = null;
const driverGridInteractionControllers = new WeakMap();
let activeDriverDetailsTile = null;
let activeDriverDetailsClose = null;

/**
 * Indeks tras zaimportowanych do bazy (kod trasy -> nazwa pliku).
 * Używany do ograniczenia klikalności w grafiku wyłącznie do tras dostępnych w IndexedDB.
 *
 * @type {Map<string, string>}
 */
const routeFileIndexByCode = dataStore.getRouteFileIndexByCode();

/**
 * Pamięciowy indeks metadanych tras pobranych z Google Drive.
 * Kluczem jest nazwa pliku, a wartością kategoria wyznaczona z folderu pierwszego poziomu.
 *
 * Folder jest źródłem prawdy dla kategorii tras:
 * - STANDARD: Baltic Medica, Dostawy, Dzika, Wilanów, Wołomin
 * - WIECZOREK: Wieczorki
 * - SOBOTA / NIEDZIELA: odpowiednio foldery Soboty / Niedziele
 *
 * @type {Map<string, { category: string, topLevelFolderName: string }>}
 */
const routeMetaByFileName = new Map();

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
 * Monotoniczny identyfikator aktywnej operacji głównej nawigacji.
 *
 * Pozwala odrzucić spóźnione zakończenia asynchronicznych renderów,
 * gdy użytkownik zdążył już zamknąć sekcję albo przełączyć się na inny ekran.
 *
 * @type {number}
 */
let primaryNavTransitionToken = 0;
let currentVisibleView = 'home';
let currentViewEnteredFrom = '';
let lastScheduleViewState = null;

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

/**
 * Sprawdza, czy dany kontener widoku jest aktualnie widoczny.
 *
 * @param {Element | null | undefined} el
 * @returns {boolean}
 */
function isViewCurrentlyVisible(el) {
    return Boolean(el && !el.classList.contains('view-hidden'));
}

/**
 * Zwraca klucz bieżącego widoku aplikacji.
 *
 * @returns {'search' | 'preview' | 'routes' | 'drivers' | 'schedule'}
 */
function getCurrentViewKey() {
    if (isViewCurrentlyVisible(filePreviewView)) return 'preview';
    if (isViewCurrentlyVisible(scheduleView)) return 'schedule';
    if (isViewCurrentlyVisible(routesView)) return 'routes';
    if (isViewCurrentlyVisible(driversView)) return 'drivers';
    return 'search';
}

/**
 * Obsługuje kliknięcie głównego przycisku nawigacji.
 *
 * Ponowne kliknięcie aktywnego przycisku nie wraca już do poprzedniej sekcji,
 * tylko zamyka bieżący ekran i pokazuje widok wyszukiwania z paskiem inputu.
 *
 * @param {'routes' | 'drivers' | 'schedule'} navKey
 * @param {(opts?: { source?: string }) => Promise<void>} openView
 * @returns {Promise<void>}
 */
async function handlePrimaryNavButtonClick(navKey, openView) {
    const safeNavKey = String(navKey || '').trim();
    if (!safeNavKey || typeof openView !== 'function') return;

    if (getCurrentViewKey() === safeNavKey) {
        primaryNavTransitionToken += 1;
        const currentQuery = String(searchInput?.value || '').trim();
        goHome();
        ensureNavigationService().replaceHome({
            search: currentQuery.length >= 3,
            query: currentQuery
        });
        return;
    }

    const transitionToken = primaryNavTransitionToken + 1;
    primaryNavTransitionToken = transitionToken;
    await openView({ source: 'nav', transitionToken });
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
        ghostHint,
        minChars: 2,
        maxNavigableItems: 5,
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
        showLoadingError('Ładowanie trwa zbyt długo. Możesz przejść dalej do aplikacji i uruchomić synchronizację z Google Drive.');
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
            setLoadingStatusText('Brak danych. Kliknij „Dalej”, a potem uruchom synchronizację z Google Drive.');
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
    showLoadingError('Błąd ładowania danych. Uruchom synchronizację z Google Drive.');
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
        const activeQuery = String(dataStore.getLastQuery() || '').trim();
        if (hasResults && activeQuery.length >= 3) {
            const sorted = sortSearchResultGroups(currentResults, { mode: searchResultsSortMode, now: new Date(), formatRouteNameForResults });
            dataStore.setCurrentResults(sorted);
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
    setupSyncListeners();
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
 * Konfiguruje listenery synchronizacji z Google Drive.
 */
function setupSyncListeners() {
    if (googleDriveButton) googleDriveButton.addEventListener('click', async () => {
        logAction('sync', { phase: 'start', source: 'toolbar' }, 'INFO');
        await handleGoogleDriveSync({ source: 'toolbar' });
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
            try { await handlePrimaryNavButtonClick('routes', openRoutesView); } catch { }
        });
    }
    if (navDriversButton) {
        navDriversButton.addEventListener('click', async () => {
            try { await handlePrimaryNavButtonClick('drivers', openDriversView); } catch { }
        });
    }
    if (navScheduleButton) {
        navScheduleButton.addEventListener('click', async () => {
            try { await handlePrimaryNavButtonClick('schedule', openScheduleView); } catch { }
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
        const routeRecords = await getRouteFileRecords();
        refreshRouteMetaIndex(routeRecords);
        const spreadsheetFiles = routeRecords.map(r => String(r?.name ?? '')).filter(Boolean);
        dataStore.rebuildRouteFileIndex(routeRecords);
        fileCountSpan.textContent = String(routeRecords.length);
        if (fullReload) resetAppData();
        const filesToLoad = fullReload ? spreadsheetFiles : spreadsheetFiles.filter((fileName) => !dataStore.hasLoadedFile(fileName));
        if (showProgress) updateLoadingProgressStart(filesToLoad.length);

        if (filesToLoad.length > 0) {
            await processFilesWithConcurrency(filesToLoad, showProgress);
            statusIndicator.textContent = loadErrors.length > 0 ? `Dane gotowe (błędy: ${loadErrors.length}).` : 'Dane gotowe.';
        } else {
            statusIndicator.textContent = 'Dane aktualne.';
        }

        schedulePredictiveIndexRebuild({ reason: 'load_all_files_done' });
        const activeQuery = String(dataStore.getLastQuery() || '').trim();
        if (isSearchEnabled && activeQuery.length >= 3) {
            performSearch(activeQuery);
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
    const routeRecords = await getRouteFileRecords();
    refreshRouteMetaIndex(routeRecords);
    return routeRecords.map(r => String(r?.name ?? '')).filter(Boolean);
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
                dataStore.addLoadedFile(file);
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
        dataStore.setFullFileData(fileName, tableModel);
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
        getRouteCatalog: () => buildRouteCatalogForSchedule(),
        logAction
    });
    return scheduleService;
}

function ensureDriverContactsService() {
    if (driverContactsService) return driverContactsService;
    driverContactsService = createDriverContactsService({
        listFiles: docsListFiles,
        getBlob: docsGetBlob,
        readWorkbook,
        sheetToMatrix: (worksheet) => qeGetExcelProcessor().sheetToMatrix(worksheet),
        logAction
    });
    return driverContactsService;
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

async function processDriverContactsFile(fileName) {
    return await ensureDriverContactsService().processDriverContactsFile(fileName);
}

function invalidateDriverContactsFile(fileName) {
    ensureDriverContactsService().invalidateDriverContactsFile(fileName);
}

async function loadDriverContactsFiles({ fullReload } = { fullReload: false }) {
    return await ensureDriverContactsService().loadDriverContactsFiles({
        fullReload: Boolean(fullReload)
    });
}

function getDriverContactForName(driverName) {
    return ensureDriverContactsService().getContactForDriverName(driverName);
}

function getDriverContactsByRole(roleCategory) {
    return ensureDriverContactsService().getContactsByRole(roleCategory);
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

/**
 * Zwraca nazwisko kierowcy na podstawie danych z grafiku.
 *
 * Zgodnie z założeniem widoku pierwszy człon w grafiku jest źródłem prawdy
 * dla nazwiska i to po nim sortujemy oraz grupujemy kafelki.
 *
 * @param {string} driverName
 * @returns {string}
 */
function getDriverSurnameFromScheduleName(driverName) {
    const normalized = normalizeDriverDisplayName(driverName);
    if (!normalized) return '';
    const [surname = ''] = normalized.split(' ');
    return surname.trim();
}

/**
 * Buduje klucz sortowania kierowcy po nazwisku, a następnie po pełnej nazwie.
 *
 * @param {string} driverName
 * @returns {string}
 */
function buildDriverSurnameSortKey(driverName) {
    const normalized = normalizeDriverDisplayName(driverName);
    const surname = getDriverSurnameFromScheduleName(normalized);
    const surnameKey = fuzzyNormalizeText(surname);
    const fullKey = fuzzyNormalizeText(normalized);
    return `${surnameKey}||${fullKey}`;
}

/**
 * Wyznacza literę sekcji alfabetycznej na podstawie nazwiska kierowcy.
 *
 * @param {string} driverName
 * @returns {string}
 */
function buildDriverSectionLetter(driverName) {
    const surname = getDriverSurnameFromScheduleName(driverName);
    const normalized = fuzzyNormalizeText(surname);
    const letter = String(normalized.charAt(0) || '').toUpperCase();
    return /^[A-Z]$/.test(letter) ? letter : '#';
}

const DRIVER_ROLE_SECTION_CONFIG = Object.freeze([
    { key: 'szef', singular: 'Szef', plural: 'Szefowie' },
    { key: 'kierownik', singular: 'Kierownik', plural: 'Kierownicy' },
    { key: 'koordynator', singular: 'Koordynator', plural: 'Koordynatorzy' },
    { key: 'dyspozytor', singular: 'Dyspozytor', plural: 'Dyspozytorzy' }
]);

function getDriverRoleSectionTitle(roleKey, count) {
    const config = DRIVER_ROLE_SECTION_CONFIG.find((item) => item.key === String(roleKey ?? '').trim());
    if (!config) return '';
    return Number(count) === 1 ? config.singular : config.plural;
}

function ensureDriverRoleSectionsContainer() {
    if (!driversView) return null;
    let container = driversView.querySelector('.qe-role-sections');
    if (container) return container;

    container = document.createElement('div');
    container.className = 'qe-role-sections';
    const header = driversView.querySelector('.qe-view-header');
    if (header?.parentNode === driversView) {
        driversView.insertBefore(container, header);
    } else {
        driversView.prepend(container);
    }
    return container;
}

function cleanupDriverGridInteractions(rootEl) {
    if (!(rootEl instanceof HTMLElement)) return;
    if (activeDriverDetailsTile instanceof HTMLElement && rootEl.contains(activeDriverDetailsTile)) {
        activeDriverDetailsTile = null;
        activeDriverDetailsClose = null;
    }
    const containers = [rootEl, ...rootEl.querySelectorAll('.qe-driver-sections, .qe-driver-role-grid')];
    for (const container of containers) {
        if (!(container instanceof HTMLElement)) continue;
        const controller = driverGridInteractionControllers.get(container);
        if (!controller) continue;
        try { controller.abort(); } catch { }
        driverGridInteractionControllers.delete(container);
    }
}

function buildDriverTileModel(label, phones, registration, roleCategory = '', roleNote = '') {
    return {
        label: String(label ?? '').trim(),
        phones: Array.isArray(phones)
            ? phones.map((phone) => ({
                phoneDisplay: String(phone?.phoneDisplay ?? '').trim(),
                phoneHref: String(phone?.phoneHref ?? '').trim()
            })).filter((phone) => phone.phoneDisplay)
            : [],
        registration: String(registration ?? '').trim(),
        hasContact: Array.isArray(phones) && phones.length > 0,
        roleCategory: String(roleCategory ?? '').trim(),
        roleNote: String(roleNote ?? '').trim()
    };
}

/**
 * Rozdziela nazwę kierowcy na dwa wiersze:
 * - pierwszy wiersz: nazwisko,
 * - drugi wiersz: pozostałe człony (najczęściej imię).
 *
 * @param {string} driverName
 * @returns {{ surname: string, givenNames: string }}
 */
function splitDriverNameForTile(driverName) {
    const normalized = normalizeDriverDisplayName(driverName);
    if (!normalized) return { surname: '', givenNames: '' };
    const [surname = '', ...rest] = normalized.split(' ');
    return {
        surname: surname.trim(),
        givenNames: rest.join(' ').trim()
    };
}

/**
 * Wyznacza docelową szerokość kafelka dla całej sekcji na podstawie
 * najdłuższego wiersza nazwy kierowcy w tej sekcji.
 *
 * @param {Array<{ label?: string }>} items
 * @returns {string}
 */
function estimateDriverSectionTileWidth(items) {
    const list = Array.isArray(items) ? items : [];
    let longestLineChars = 14;

    for (const item of list) {
        const { surname, givenNames } = splitDriverNameForTile(String(item?.label ?? ''));
        longestLineChars = Math.max(
            longestLineChars,
            String(surname || '').length,
            String(givenNames || surname || '').length
        );
    }

    const clampedChars = Math.max(14, Math.min(longestLineChars + 4, 34));
    return `calc(${clampedChars}ch + 2.5rem)`;
}

/**
 * Zwraca krótką etykietę roli do badge w panelu szczegółów.
 *
 * @param {string} roleCategory
 * @returns {string}
 */
function getDriverRoleBadgeLabel(roleCategory) {
    const title = getDriverRoleSectionTitle(roleCategory, 1);
    return String(title ?? '').trim();
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

/**
 * Finalizuje import plików po synchronizacji z Google Drive.
 * To wydzielony wariant wspólny dla ścieżki synchronizacji, po usunięciu importu lokalnego.
 *
 * @param {{ files?: string[], records?: number, errors?: number }} summary
 * @param {number} before
 * @returns {Promise<void>}
 */
async function finalizeImportedFiles(summary, before) {
    const after = Number(allData.length) || 0;
    const base = summary && typeof summary === 'object' ? summary : { files: [], records: 0, errors: 0 };
    base.records = Math.max(0, after - (Number(before) || 0));

    try { if (uploadProgress) uploadProgress.value = 100; } catch { }
    try { setUploadStatusText('Synchronizacja zakończona.'); } catch { }
    try { logAction('import', { files: base.files?.length || 0, records: base.records, errors: base.errors }, 'INFO'); } catch { }
    try { displayImportSummary(base); } catch { }
    try { fileCountSpan.textContent = String((await getRouteFileRecords()).length); } catch { }
    try { setSearchEnabled(after > 0); } catch { }

    const q = String(dataStore.getLastQuery() || '').trim();
    if (q.length >= 3 && Boolean(isSearchEnabled)) {
        try { performSearch(q); } catch { }
    }

    try { schedulePredictiveIndexRebuild({ reason: 'drive_sync_done' }); } catch { }
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
        getDriverContactsFileId: () => DRIVE_DRIVER_CONTACTS_FILE_ID,
        parseScheduleMetaStrictXlsx: (name) => ensureScheduleService().parseScheduleFileNameYearMonthStrictXlsx(name),
        toTitleCase,
        maxImportBytes: MAX_IMPORT_BYTES,
        listDbFiles: () => docsListFiles(),
        getDbFileRecord: (name) => docsGetFileRecord(name),
        deleteDbFiles: (names) => docsDeleteFiles(names),
        putDbBlob: (name, blob, meta) => docsPutBlob(name, blob, {
            driveModifiedAt: meta?.driveModifiedAt ?? null,
            sourceKind: String(meta?.sourceKind ?? '').trim() || 'route',
            topLevelFolderName: meta?.topLevelFolderName ?? '',
            routeCategory: mapTopLevelRouteFolderToCategory(meta?.topLevelFolderName)
        }),
        removeFileData,
        isScheduleFileName,
        invalidateScheduleFile,
        processScheduleFile,
        invalidateDriverContactsFile,
        processDriverContactsFile,
        processFile,
        loadedFiles,
        getAllDataLength: () => allData.length,
        finalizeImport: (summary, before) => finalizeImportedFiles(summary, before),
        logAction,
        escapeHtml,
        buildConnectingModalHtml: buildDriveConnectingModalHtml,
        buildNoChangesModalHtml: buildDriveNoChangesModalHtml,
        buildDeletionConfirmationModalHtml: buildDriveDeletionConfirmationModalHtml,
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
        initChangesModal: (files, token) => ensureDriveChangesModalController().init({
            files,
            token,
            onOpenDiff: (change, context) => openDriveXlsxDiffPreview(change, context)
        }),
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

/**
 * Normalizuje nazwę folderu z Google Drive do postaci porównywalnej.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTopLevelRouteFolderName(value) {
    return fuzzyNormalizeText(String(value ?? ''))
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

/**
 * Mapuje nazwę folderu pierwszego poziomu pod `ROUTES_FOLDER_ID` na kategorię trasy.
 *
 * @param {unknown} folderName
 * @returns {'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA'|''}
 */
function mapTopLevelRouteFolderToCategory(folderName) {
    const norm = normalizeTopLevelRouteFolderName(folderName);
    if (!norm) return '';

    if (norm === 'WIECZORKI') return 'WIECZOREK';
    if (norm === 'SOBOTY') return 'SOBOTA';
    if (norm === 'NIEDZIELE') return 'NIEDZIELA';

    if (norm === 'BALTIC MEDICA' || norm === 'DOSTAWY' || norm === 'DZIKA' || norm === 'WILANOW' || norm === 'WOLOMIN') {
        return 'STANDARD';
    }

    if (norm.includes('DOSTAWY') || norm.includes('DZIKA')) return 'STANDARD';
    return '';
}

/**
 * Odczytuje kategorię trasy z rekordu IndexedDB.
 * Priorytet:
 * 1. jawnie zapisane `routeCategory`,
 * 2. mapowanie z `topLevelFolderName`,
 * 3. fallback po nazwie pliku dla rekordów historycznych bez metadanych folderu.
 *
 * @param {{ name?: string, routeCategory?: string, topLevelFolderName?: string } | null | undefined} record
 * @returns {'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA'|''}
 */
function resolveStoredRouteCategory(record) {
    const rawCategory = String(record?.routeCategory ?? '').trim().toUpperCase();
    if (rawCategory === 'STANDARD' || rawCategory === 'WIECZOREK' || rawCategory === 'SOBOTA' || rawCategory === 'NIEDZIELA') {
        return rawCategory;
    }

    const folderCategory = mapTopLevelRouteFolderToCategory(record?.topLevelFolderName);
    if (folderCategory) return folderCategory;

    const legacy = getRouteCategoriesFromFileName(String(record?.name ?? ''));
    const category = String(Array.isArray(legacy) && legacy.length > 0 ? legacy[0] : '').trim().toUpperCase();
    if (category === 'WIECZOREK' || category === 'SOBOTA' || category === 'NIEDZIELA') return category;
    return category === 'STANDARD' ? 'STANDARD' : '';
}

/**
 * Aktualizuje pamięciowy indeks metadanych tras na podstawie rekordów z bazy.
 *
 * @param {Array<{ name?: string, routeCategory?: string, topLevelFolderName?: string }>} routeRecords
 */
function refreshRouteMetaIndex(routeRecords) {
    routeMetaByFileName.clear();
    const list = Array.isArray(routeRecords) ? routeRecords : [];
    for (const record of list) {
        const fileName = String(record?.name ?? '').trim();
        if (!fileName) continue;
        const category = resolveStoredRouteCategory(record);
        routeMetaByFileName.set(fileName, {
            category,
            topLevelFolderName: String(record?.topLevelFolderName ?? '').trim()
        });
    }
}

/**
 * Zwraca kategorie trasy dla pliku, preferując metadane zapisane z Google Drive.
 *
 * @param {string} fileName
 * @returns {string[]}
 */
function getRouteCategoriesForFile(fileName) {
    const safe = String(fileName ?? '').trim();
    if (!safe) return ['STANDARD'];
    const stored = routeMetaByFileName.get(safe);
    const category = String(stored?.category ?? '').trim().toUpperCase();
    if (category === 'STANDARD' || category === 'WIECZOREK' || category === 'SOBOTA' || category === 'NIEDZIELA') {
        return [category];
    }
    const fallback = getRouteCategoriesFromFileName(safe);
    return Array.isArray(fallback) && fallback.length > 0 ? fallback : ['STANDARD'];
}

/**
 * Pobiera rekordy plików tras z bazy, razem z metadanymi kategorii pochodzącymi z Google Drive.
 *
 * @returns {Promise<Array<{ name: string, size: number, updatedAt: number, driveModifiedAt: (number|null), routeCategory?: string, topLevelFolderName?: string }>>}
 */
async function getRouteFileRecords() {
    statusIndicator.textContent = 'Sprawdzanie plików...';
    const files = await docsListFiles();
    const routeRecords = Array.isArray(files)
        ? files.filter(f => {
            const name = String(f?.name ?? '').trim();
            const lower = name.toLowerCase();
            const isSpreadsheet = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
            const sourceKind = String(f?.sourceKind ?? '').trim();
            const isDriverContacts = sourceKind === DRIVER_CONTACTS_SOURCE_KIND;
            return Boolean(name) && isSpreadsheet && !isScheduleFileName(name) && !isDriverContacts;
        })
        : [];
    routeRecords.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'pl', { sensitivity: 'base' }));
    return routeRecords;
}

/**
 * Buduje katalog tras na potrzeby parsowania grafiku.
 * Kluczem jest znormalizowany kod trasy, a wartością kanoniczny kod i kategoria
 * wyliczona z folderu pierwszego poziomu w Google Drive.
 *
 * @returns {Promise<Map<string, { code: string, category: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }>>}
 */
async function buildRouteCatalogForSchedule() {
    const routeRecords = await getRouteFileRecords();
    refreshRouteMetaIndex(routeRecords);

    const catalog = new Map();
    for (const record of routeRecords) {
        const fileName = String(record?.name ?? '').trim();
        if (!fileName) continue;

        const code = normalizeRouteCodeForLookup(extractRouteCodeFromFileName(fileName));
        if (!code) continue;

        const category = resolveStoredRouteCategory(record);
        if (!category) continue;

        catalog.set(code, Object.freeze({ code, category }));
    }
    return catalog;
}

/**
 * Odczytuje skoroszyt z różnych źródeł danych.
 */
async function readWorkbook(source, fileName) {
    return await qeGetExcelProcessor().readWorkbook(source, fileName);
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
let xlsxDiffModalController = null;
let driveXlsxDiffPreviewSeq = 0;

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

/**
 * Zapewnia kontroler drugiego modala z podgladem roznic XLSX.
 *
 * @returns {{ openLoading: Function, showDiff: Function, showError: Function, close: Function }}
 */
function ensureXlsxDiffModalController() {
    if (xlsxDiffModalController) return xlsxDiffModalController;
    xlsxDiffModalController = createXlsxDiffModalController({
        modalController: ensureModalController(),
        formatFileName,
        escapeHtml,
        onClose: () => { driveXlsxDiffPreviewSeq += 1; }
    });
    return xlsxDiffModalController;
}

/**
 * Otwiera drugi modal z lazy-generowanym diffem XLSX dla wskazanego pliku.
 *
 * @param {{ name?: string, xlsxDiff?: any, xlsxDiffPromise?: Promise<any> }} change
 * @param {{ token?: string }} [opts]
 * @returns {Promise<void>}
 */
async function openDriveXlsxDiffPreview(change, { token } = {}) {
    const fileName = String(change?.name || '').trim();
    if (!fileName) return;

    const seq = ++driveXlsxDiffPreviewSeq;
    ensureXlsxDiffModalController().openLoading(fileName);

    try {
        const diff = change?.xlsxDiff || await resolveDriveXlsxDiff(change, token);
        if (seq !== driveXlsxDiffPreviewSeq) return;
        ensureXlsxDiffModalController().showDiff(fileName, diff);
    } catch (err) {
        if (seq !== driveXlsxDiffPreviewSeq) return;
        ensureXlsxDiffModalController().showError(fileName);
        logAction('sync', {
            phase: 'xlsx_diff_error',
            fileName,
            message: err?.message ? String(err.message) : 'Nie udało się wygenerować diffu XLSX'
        }, 'WARN');
    }
}

/**
 * Generuje i cache'uje diff XLSX dla zmodyfikowanego pliku z Google Drive.
 *
 * @param {{ id?: string, name?: string, xlsxDiff?: any, xlsxDiffPromise?: Promise<any> }} change
 * @param {string} token
 * @returns {Promise<any>}
 */
async function resolveDriveXlsxDiff(change, token) {
    if (change?.xlsxDiff) return change.xlsxDiff;
    if (change?.xlsxDiffPromise) return await change.xlsxDiffPromise;

    const fileName = String(change?.name || '').trim();
    const fileId = String(change?.id || '').trim();
    const safeToken = String(token || '').trim();
    if (!fileName) throw new Error('Brak nazwy pliku dla diffu XLSX.');
    if (!fileId) throw new Error(`Brak identyfikatora Google Drive dla pliku "${fileName}".`);
    if (!safeToken) throw new Error('Brak tokenu Google Drive dla podgladu diffu.');

    change.xlsxDiffPromise = (async () => {
        const localBlob = await docsGetBlob(fileName);
        if (!localBlob) throw new Error(`Brak lokalnej wersji pliku "${fileName}" w IndexedDB.`);

        const remoteBuffer = await qeGetDriveService().downloadFileArrayBuffer(fileId, safeToken);
        const diff = await buildSimpleXlsxDiff({
            fileName,
            oldSource: localBlob,
            newSource: remoteBuffer
        });
        change.xlsxDiff = diff;
        return diff;
    })().finally(() => {
        try { delete change.xlsxDiffPromise; } catch { change.xlsxDiffPromise = null; }
    });

    return await change.xlsxDiffPromise;
}

function buildDriveConnectingModalHtml(stageText) {
    const stage = escapeHtml(String(stageText || '').trim() || 'Łączenie z Google Drive...');
    return `<div class="qe-drive-connecting"><div class="qe-spinner" aria-hidden="true"></div><div class="qe-drive-connecting-title">${stage}</div><div class="qe-drive-connecting-sub">To może potrwać kilka sekund. Nie zamykaj aplikacji.</div><div class="qe-indeterminate" aria-hidden="true"><div class="qe-indeterminate-bar"></div></div></div>`;
}

function buildDriveNoChangesModalHtml() {
    return `<div class="qe-drive-modal qe-drive-modal--ok"><div class="qe-drive-summary"><strong>Dane aktualne.</strong> Nie wykryto zmian w folderze Google Drive od ostatniej synchronizacji.</div></div>`;
}

/**
 * Buduje modal potwierdzający lokalne usunięcie plików,
 * które nie istnieją już na Google Drive.
 *
 * @param {Array<{ name?: string }>} files
 * @returns {string}
 */
function buildDriveDeletionConfirmationModalHtml(files) {
    const list = Array.isArray(files) ? files : [];
    const items = list
        .map((file) => {
            const name = String(file?.name || '').trim();
            if (!name) return '';
            return `<li class="qe-drive-delete-item">${escapeHtml(formatFileName(name))}</li>`;
        })
        .filter(Boolean)
        .join('');

    const count = items ? list.length : 0;
    return `<div class="qe-drive-modal qe-drive-modal--warn"><div class="qe-drive-summary"><strong>Potwierdź lokalne usunięcie.</strong> Poniższe pliki nie istnieją już na Google Drive i zostaną skasowane z lokalnej bazy aplikacji:</div><ul class="qe-drive-delete-list">${items}</ul><div class="qe-drive-question">Usunąć lokalnie ${escapeHtml(count)} plik(ów) i kontynuować synchronizację?</div></div>`;
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
        const renderedMatchesData = Number(lastRenderedSearch?.dataRevision) === dataStore.getRevision();
        const lastMatchesQuery = String(dataStore.getLastQuery() || '').trim() === trimmed;
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
                getRouteCategoriesFromFileName: getRouteCategoriesForFile,
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
        setLastQuery: (q) => { dataStore.setLastQuery(q); },
        setMatchedResults: (results) => { dataStore.setMatchedResults(results); },
        setCurrentResults: (results) => {
            const list = Array.isArray(results) ? results : [];
            const sorted = sortSearchResultGroups(list, { mode: searchResultsSortMode, now: new Date(), formatRouteNameForResults });
            dataStore.setCurrentResults(sorted);
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
 * Usuwa dane powiązane z konkretnym plikiem.
 */
function removeFileData(fileName) {
    const safe = String(fileName || '');
    if (!safe) return;
    dataStore.removeDataForFile(safe);
    loadErrors = loadErrors.filter(e => e?.fileName !== safe);
    try { ensureSearchApplication().removePredictiveSource(safe); } catch { }
}

/**
 * Resetuje kluczowe dane aplikacji.
 */
function resetAppData() {
    dataStore.resetDataRuntimeState();
    loadErrors = [];
    try { ensureDriverContactsService().clearCache(); } catch { }
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
        dataStore.setLastRenderedSearch(query, dataStore.getRevision());
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
    const currentQuery = String(dataStore.getLastQuery() || '').trim();
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
        query: String(dataStore.getLastQuery() || '').trim(),
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
    trackVisibleView('preview');
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
        getRouteCategoriesFromFileName: getRouteCategoriesForFile,
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
        tableContainer: scheduleTableContainer,
        tableHeaderRow: scheduleTableHeader,
        tableBody: scheduleTableBody,
        monthSelect: scheduleMonthSelect,
        selectedDayEl: scheduleSelectedDay,
        subtitleEl: scheduleSubtitle,
        prevMonthBtn: schedulePrevMonthBtn,
        nextMonthBtn: scheduleNextMonthBtn,
        todayBtn: scheduleTodayBtn,
        driverFilterInput: scheduleDriverFilter,
        routeFilterInput: scheduleRouteFilter,
        routeFilterOptionsEl: scheduleRouteFilterOptions,
        clearFiltersBtn: scheduleClearFiltersBtn,
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
    dataStore.clearLastQuery();
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

/**
 * Normalizuje dane statusu uploadu do postaci prefiks + treść.
 * Pozwala utrzymać stały prefiks widoczny podczas animacji zmiennej części.
 * @param {string|{prefix?: string, content?: string}} nextText
 * @returns {{ prefix: string, content: string }}
 */
function normalizeUploadStatusPayload(nextText) {
    if (typeof nextText === 'object' && nextText !== null) {
        return {
            prefix: String(nextText.prefix ?? ''),
            content: String(nextText.content ?? '')
        };
    }

    return {
        prefix: '',
        content: String(nextText ?? '')
    };
}

/**
 * Zapewnia wewnętrzną strukturę statusu uploadu wymaganą do osobnej animacji treści.
 * @returns {{ prefixNode: HTMLSpanElement, contentNode: HTMLSpanElement } | null}
 */
function ensureUploadStatusNodes() {
    if (!uploadStatus) return null;

    let prefixNode = uploadStatus.querySelector('.qe-upload-status-prefix');
    let contentNode = uploadStatus.querySelector('.qe-upload-status-dynamic');

    if (prefixNode instanceof HTMLSpanElement && contentNode instanceof HTMLSpanElement) {
        return { prefixNode, contentNode };
    }

    uploadStatus.textContent = '';

    prefixNode = document.createElement('span');
    prefixNode.className = 'qe-upload-status-prefix';

    contentNode = document.createElement('span');
    contentNode.className = 'qe-upload-status-dynamic qe-text-swap-in';

    uploadStatus.append(prefixNode, contentNode);
    return { prefixNode, contentNode };
}

/**
 * Ustawia treść statusu uploadu z animacją tylko dla zmiennej części komunikatu.
 * @param {string|{prefix?: string, content?: string}} nextText
 * @param {{ animate?: boolean }} [options]
 */
function setUploadStatusText(nextText, { animate = true } = {}) {
    if (!uploadStatus) return;

    const nodes = ensureUploadStatusNodes();
    if (!nodes) return;

    const { prefixNode, contentNode } = nodes;
    const next = normalizeUploadStatusPayload(nextText);

    if (prefixNode.textContent === next.prefix && contentNode.textContent === next.content) return;

    if (uploadStatusSwapTimer) {
        window.clearTimeout(uploadStatusSwapTimer);
        uploadStatusSwapTimer = null;
    }

    if (!animate) {
        prefixNode.textContent = next.prefix;
        contentNode.textContent = next.content;
        contentNode.classList.remove('qe-text-swap-out');
        contentNode.classList.add('qe-text-swap-in');
        return;
    }

    prefixNode.textContent = next.prefix;
    contentNode.classList.remove('qe-text-swap-in');
    contentNode.classList.add('qe-text-swap-out');

    uploadStatusSwapTimer = window.setTimeout(() => {
        contentNode.textContent = next.content;
        contentNode.classList.remove('qe-text-swap-out');
        contentNode.classList.add('qe-text-swap-in');
        uploadStatusSwapTimer = null;
    }, 140);
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
 * Zapisuje stan grafiku przed opuszczeniem widoku oraz śledzi,
 * z jakiego ekranu otwarto aktualny widok.
 *
 * @param {'home'|'preview'|'routes'|'drivers'|'schedule'} nextView
 */
function trackVisibleView(nextView) {
    const next = String(nextView || '').trim();
    const prev = String(currentVisibleView || '').trim();

    if (prev === 'schedule' && next !== 'schedule' && scheduleController && typeof scheduleController.getViewState === 'function') {
        try { lastScheduleViewState = scheduleController.getViewState(); } catch { }
    }

    currentViewEnteredFrom = prev;
    currentVisibleView = next || prev || 'home';
}

/**
 * Określa, czy wejście do widoku grafiku powinno odtworzyć
 * poprzedni stan po wyjściu z grafiku.
 *
 * @returns {boolean}
 */
function shouldRestoreScheduleView() {
    return currentVisibleView === 'schedule' || currentViewEnteredFrom === 'schedule';
}

/**
 * Powraca do głównego widoku wyszukiwania.
 */
function goHome() {
    trackVisibleView('home');
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

/**
 * Kopiuje tekst do schowka, korzystając z nowoczesnego API lub fallbacku
 * opartego o tymczasowe pole tekstowe.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyTextToClipboard(text) {
    const safeText = String(text ?? '');
    if (!safeText) return false;

    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(safeText);
            return true;
        }
    } catch { }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = safeText;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const success = Boolean(document.execCommand?.('copy'));
        textarea.remove();
        return success;
    } catch {
        return false;
    }
}

/**
 * Czyści numer telefonu do postaci przeznaczonej do schowka.
 *
 * Zachowuje wyłącznie cyfry oraz ewentualny wiodący znak `+`.
 *
 * @param {string} phoneDisplay
 * @returns {string}
 */
function normalizePhoneForClipboard(phoneDisplay) {
    const raw = String(phoneDisplay ?? '').trim();
    if (!raw) return '';
    const hasLeadingPlus = raw.startsWith('+');
    const digitsOnly = raw.replace(/\D+/g, '');
    if (!digitsOnly) return hasLeadingPlus ? '+' : '';
    return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

/**
 * Wyznacza deterministyczną testową rejestrację dla kierowcy.
 *
 * Dzięki temu UI pozostaje stabilny między kolejnymi renderami, zanim
 * podłączymy docelowe źródło numerów rejestracyjnych.
 *
 * @param {string} driverName
 * @returns {string}
 */
function getDriverTestRegistration(driverName) {
    const key = String(driverName ?? '').trim().toLowerCase();
    if (!key) return DRIVER_TEST_REGISTRATIONS[0];

    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
        hash = ((hash * 31) + key.charCodeAt(i)) >>> 0;
    }
    return DRIVER_TEST_REGISTRATIONS[hash % DRIVER_TEST_REGISTRATIONS.length];
}

/**
 * Renderuje kafelki kierowców z rozwijanym panelem kontaktowym.
 *
 * Panel jest przygotowany pod dwa pola:
 * - numer telefonu,
 * - numer rejestracyjny.
 *
 * Dzięki temu w kolejnym etapie można łatwo podmienić testową rejestrację
 * na dane z osobnego pliku źródłowego bez przebudowy UI.
 *
 * @param {HTMLElement | null} containerEl
 * @param {Array<{ label?: string, phones?: Array<{ phoneDisplay?: string, phoneHref?: string }>, registration?: string, hasContact?: boolean }>} items
 * @param {{ emptyText?: string, groupByLetter?: boolean }} [opts]
 * @returns {void}
 */
function renderDriverTileGrid(containerEl, items, { emptyText = 'Brak danych.', groupByLetter = true } = {}) {
    if (!containerEl) return;
    const previousController = driverGridInteractionControllers.get(containerEl);
    if (previousController) {
        try { previousController.abort(); } catch { }
        driverGridInteractionControllers.delete(containerEl);
    }
    containerEl.classList.add('qe-driver-sections');
    containerEl.classList.toggle('qe-driver-sections--inline', !groupByLetter);
    clearElement(containerEl);

    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'status status--hint';
        empty.textContent = String(emptyText || 'Brak danych.');
        containerEl.appendChild(empty);
        return;
    }

    const interactionAbortController = new AbortController();
    driverGridInteractionControllers.set(containerEl, interactionAbortController);
    const { signal } = interactionAbortController;

    /** @type {HTMLElement | null} */
    let openedTile = null;

    const setPanelInteractivity = (panelEl, enabled) => {
        if (!(panelEl instanceof HTMLElement)) return;
        try {
            if ('inert' in panelEl) panelEl.inert = !enabled;
        } catch { }
        const focusables = panelEl.querySelectorAll('button, a[href], [tabindex]');
        for (const el of focusables) {
            if (!(el instanceof HTMLElement)) continue;
            if (!enabled) {
                if (!el.dataset.qePrevTabindex) el.dataset.qePrevTabindex = String(el.getAttribute('tabindex') ?? '');
                el.setAttribute('tabindex', '-1');
            } else {
                const prev = el.dataset.qePrevTabindex;
                if (prev === '') el.removeAttribute('tabindex');
                else if (prev) el.setAttribute('tabindex', prev);
                else el.removeAttribute('tabindex');
                delete el.dataset.qePrevTabindex;
            }
        }
    };

    const setTileOpenState = (tileEl, isOpen) => {
        if (!(tileEl instanceof HTMLElement)) return;
        const trigger = tileEl.querySelector('.qe-driver-tile__trigger');
        const panel = tileEl.querySelector('.qe-driver-tile__panel');
        if (trigger instanceof HTMLElement) {
            trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
        setPanelInteractivity(panel, isOpen);
        tileEl.classList.toggle('is-open', isOpen);
        if (!isOpen && openedTile === tileEl) openedTile = null;
        if (isOpen) openedTile = tileEl;
        if (!isOpen && activeDriverDetailsTile === tileEl) {
            activeDriverDetailsTile = null;
            activeDriverDetailsClose = null;
        }
        if (isOpen) {
            activeDriverDetailsTile = tileEl;
            activeDriverDetailsClose = () => setTileOpenState(tileEl, false);
        }
    };

    const setTileManualCloseState = (tileEl, isClosedByUser) => {
        if (!(tileEl instanceof HTMLElement)) return;
        tileEl.classList.toggle('is-manually-closed', Boolean(isClosedByUser));
    };

    const closeOpenedTile = () => {
        if (!openedTile) return;
        setTileOpenState(openedTile, false);
    };

    const sortedItems = list.slice().sort((a, b) => {
        const bySurname = buildDriverSurnameSortKey(String(a?.label ?? '')).localeCompare(buildDriverSurnameSortKey(String(b?.label ?? '')), 'pl', { sensitivity: 'base' });
        if (bySurname !== 0) return bySurname;
        return String(a?.label ?? '').localeCompare(String(b?.label ?? ''), 'pl', { sensitivity: 'base' });
    });

    let tileCounter = 0;
    const appendTilesToGrid = (gridEl, sectionItems) => {
        if (!(gridEl instanceof HTMLElement) || !Array.isArray(sectionItems) || sectionItems.length === 0) return null;
        gridEl.className = 'qe-tile-grid qe-driver-section__grid';
        gridEl.setAttribute('role', 'list');
        gridEl.style.setProperty('--qe-driver-section-tile-width', estimateDriverSectionTileWidth(sectionItems));

        for (const item of sectionItems) {
            const label = String(item?.label ?? '').trim();
            const phones = Array.isArray(item?.phones)
                ? item.phones.map((phone) => ({
                    phoneDisplay: String(phone?.phoneDisplay ?? '').trim(),
                    phoneHref: String(phone?.phoneHref ?? '').trim()
                })).filter((phone) => phone.phoneDisplay)
                : [];
            const registration = String(item?.registration ?? '').trim();
            const hasContact = Boolean(item?.hasContact) && phones.length > 0;

            const tile = document.createElement('div');
            tile.className = 'qe-driver-tile';
            tile.setAttribute('role', 'listitem');

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'qe-tile qe-driver-tile__trigger';
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-haspopup', 'dialog');
            trigger.setAttribute('aria-label', hasContact
                ? `${label} — pokaż numery telefonu i rejestrację`
                : `${label} — pokaż szczegóły kierowcy`);

            const title = document.createElement('span');
            title.className = 'qe-driver-tile__title';
            const { surname, givenNames } = splitDriverNameForTile(label);
            const surnameLine = document.createElement('span');
            surnameLine.className = 'qe-driver-tile__line qe-driver-tile__line--surname';
            surnameLine.textContent = surname || label;
            title.appendChild(surnameLine);
            if (givenNames) {
                const givenNamesLine = document.createElement('span');
                givenNamesLine.className = 'qe-driver-tile__line qe-driver-tile__line--given';
                givenNamesLine.textContent = givenNames;
                title.appendChild(givenNamesLine);
            }
            trigger.appendChild(title);

            const panel = document.createElement('div');
            panel.className = 'qe-driver-tile__panel';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-label', `Szczegóły kierowcy ${label}`);
            panel.id = `driver-contact-panel-${tileCounter}`;
            trigger.setAttribute('aria-controls', panel.id);
            setPanelInteractivity(panel, false);

            const roleNote = String(item?.roleNote ?? '').trim();
            const roleCategory = String(item?.roleCategory ?? '').trim();
            if (roleCategory && roleNote) {
                const roleBadge = document.createElement('div');
                roleBadge.className = 'qe-driver-tile__role-wrap';
                const roleBadgeLabel = document.createElement('span');
                roleBadgeLabel.className = 'qe-driver-tile__role-badge';
                roleBadgeLabel.textContent = getDriverRoleBadgeLabel(roleCategory) || roleNote.split(/\s+/)[0] || roleNote;
                roleBadge.appendChild(roleBadgeLabel);
                panel.appendChild(roleBadge);
            }

            const phoneRow = document.createElement('div');
            phoneRow.className = 'qe-driver-tile__row';
            const phoneLabel = document.createElement('span');
            phoneLabel.className = 'qe-driver-tile__row-label';
            phoneLabel.textContent = phones.length > 1 ? 'Telefony' : 'Telefon';
            phoneRow.appendChild(phoneLabel);

            const phoneList = document.createElement('div');
            phoneList.className = 'qe-driver-tile__phone-list';
            if (hasContact) {
                for (const phone of phones) {
                    const phoneEntry = document.createElement('div');
                    phoneEntry.className = 'qe-driver-tile__phone-entry';

                    const phoneValue = document.createElement('span');
                    phoneValue.className = 'qe-driver-tile__row-value';
                    phoneValue.textContent = phone.phoneDisplay;
                    phoneEntry.appendChild(phoneValue);

                    const phoneActions = document.createElement('div');
                    phoneActions.className = 'qe-driver-tile__actions qe-driver-tile__actions--inline';

                    const callAction = document.createElement('a');
                    callAction.className = 'qe-driver-tile__action qe-driver-tile__action--primary qe-driver-tile__action--icon';
                    callAction.href = phone.phoneHref || '#';
                    callAction.textContent = '☎';
                    callAction.setAttribute('aria-label', `Zadzwoń do kierowcy ${label}: ${phone.phoneDisplay}`);
                    callAction.title = 'Zadzwoń';

                    const copyAction = document.createElement('button');
                    copyAction.type = 'button';
                    copyAction.className = 'qe-driver-tile__action qe-driver-tile__action--icon';
                    copyAction.textContent = '⧉';
                    copyAction.setAttribute('aria-label', `Kopiuj numer telefonu kierowcy ${label}: ${phone.phoneDisplay}`);
                    copyAction.title = 'Kopiuj';
                    copyAction.addEventListener('click', async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const copiedPhone = normalizePhoneForClipboard(phone.phoneDisplay);
                        const copied = await copyTextToClipboard(copiedPhone);
                        const previousLabel = copyAction.textContent;
                        const previousTitle = copyAction.title;
                        copyAction.textContent = copied ? '✓' : '!';
                        copyAction.title = copied ? 'Skopiowano' : 'Błąd kopiowania';
                        window.setTimeout(() => {
                            copyAction.textContent = previousLabel;
                            copyAction.title = previousTitle;
                        }, 1400);
                    }, { signal });

                    phoneActions.appendChild(callAction);
                    phoneActions.appendChild(copyAction);
                    phoneEntry.appendChild(phoneActions);
                    phoneList.appendChild(phoneEntry);
                }
            } else {
                const emptyPhone = document.createElement('span');
                emptyPhone.className = 'qe-driver-tile__row-value is-muted';
                emptyPhone.textContent = 'Brak kontaktu';
                phoneList.appendChild(emptyPhone);
            }
            phoneRow.appendChild(phoneList);

            const registrationRow = document.createElement('div');
            registrationRow.className = 'qe-driver-tile__row';
            const registrationLabel = document.createElement('span');
            registrationLabel.className = 'qe-driver-tile__row-label';
            registrationLabel.textContent = 'Pojazd';
            const registrationValue = document.createElement('span');
            registrationValue.className = 'qe-driver-tile__row-value qe-driver-tile__plate';
            registrationValue.textContent = registration || '-';
            registrationRow.appendChild(registrationLabel);
            registrationRow.appendChild(registrationValue);

            panel.appendChild(phoneRow);
            panel.appendChild(registrationRow);

            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                const nextOpenState = !tile.classList.contains('is-open');
                if (nextOpenState && activeDriverDetailsTile && activeDriverDetailsTile !== tile) {
                    try { activeDriverDetailsClose?.(); } catch { }
                }
                if (nextOpenState) {
                    const openTiles = document.querySelectorAll('.qe-driver-tile.is-open');
                    for (const openTile of openTiles) {
                        if (!(openTile instanceof HTMLElement) || openTile === tile) continue;
                        const openTrigger = openTile.querySelector('.qe-driver-tile__trigger');
                        const openPanel = openTile.querySelector('.qe-driver-tile__panel');
                        if (openTrigger instanceof HTMLElement) {
                            openTrigger.setAttribute('aria-expanded', 'false');
                        }
                        setPanelInteractivity(openPanel, false);
                        openTile.classList.remove('is-open');
                        if (openedTile === openTile) openedTile = null;
                        if (activeDriverDetailsTile === openTile) {
                            activeDriverDetailsTile = null;
                            activeDriverDetailsClose = null;
                        }
                    }
                } else if (openedTile && openedTile !== tile) {
                    closeOpenedTile();
                }
                setTileOpenState(tile, nextOpenState);
                setTileManualCloseState(tile, false);
            }, { signal });

            tile.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                closeOpenedTile();
                setPanelInteractivity(panel, false);
                trigger.focus();
            }, { signal });

            tile.appendChild(trigger);
            tile.appendChild(panel);
            gridEl.appendChild(tile);
            tileCounter += 1;
        }
        return gridEl;
    };

    if (!groupByLetter) {
        const flatGrid = appendTilesToGrid(document.createElement('div'), sortedItems);
        if (flatGrid) containerEl.appendChild(flatGrid);
    } else {
        const sections = new Map();
        for (const item of sortedItems) {
            const letter = buildDriverSectionLetter(String(item?.label ?? ''));
            if (!sections.has(letter)) sections.set(letter, []);
            sections.get(letter).push(item);
        }

        const orderedSectionLetters = Array.from(sections.keys()).sort((a, b) => {
            if (a === '#') return 1;
            if (b === '#') return -1;
            return a.localeCompare(b, 'pl', { sensitivity: 'base' });
        });

        for (const sectionLetter of orderedSectionLetters) {
            const sectionItems = sections.get(sectionLetter);
            if (!Array.isArray(sectionItems) || sectionItems.length === 0) continue;

            const section = document.createElement('section');
            section.className = 'qe-driver-section';
            section.setAttribute('aria-label', `Sekcja kierowców ${sectionLetter}`);

            const sectionHeader = document.createElement('div');
            sectionHeader.className = 'qe-driver-section__header';
            const sectionBadge = document.createElement('span');
            sectionBadge.className = 'qe-driver-section__letter';
            sectionBadge.textContent = sectionLetter;
            sectionHeader.appendChild(sectionBadge);

            const sectionGrid = appendTilesToGrid(document.createElement('div'), sectionItems);
            if (!sectionGrid) continue;
            sectionGrid.className = 'qe-tile-grid qe-driver-section__grid';

            section.appendChild(sectionHeader);
            section.appendChild(sectionGrid);
            containerEl.appendChild(section);
        }
    }

    document.addEventListener('pointerdown', (event) => {
        if (!openedTile) return;
        if (openedTile.contains(event.target)) return;
        closeOpenedTile();
    }, { signal });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeOpenedTile();
    }, { signal });
}

async function renderRoutesView() {
    const routeRecords = await getRouteFileRecords();
    refreshRouteMetaIndex(routeRecords);
    const files = Array.isArray(routeRecords) ? routeRecords : [];

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

    for (const record of files) {
        const name = String(record?.name ?? '').trim();
        if (!name) continue;
        const cats = getRouteCategoriesForFile(name);
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
    await loadDriverContactsFiles({ fullReload: false });
    const roleSectionsContainer = ensureDriverRoleSectionsContainer();
    if (roleSectionsContainer) {
        cleanupDriverGridInteractions(roleSectionsContainer);
        clearElement(roleSectionsContainer);
    }
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

    const drivers = Array.from(names).sort((a, b) => {
        const bySurname = buildDriverSurnameSortKey(String(a)).localeCompare(buildDriverSurnameSortKey(String(b)), 'pl', { sensitivity: 'base' });
        if (bySurname !== 0) return bySurname;
        return String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' });
    });
    const excludedDriverKeys = new Set();

    if (roleSectionsContainer) {
        for (const roleConfig of DRIVER_ROLE_SECTION_CONFIG) {
            const roleContacts = getDriverContactsByRole(roleConfig.key);
            if (!Array.isArray(roleContacts) || roleContacts.length === 0) continue;

            for (const contact of roleContacts) {
                const keys = Array.isArray(contact?.lookupKeys) ? contact.lookupKeys : [];
                for (const key of keys) excludedDriverKeys.add(String(key ?? '').trim());
            }

            const roleSection = document.createElement('section');
            roleSection.className = 'qe-role-segment';
            roleSection.setAttribute('aria-label', `Sekcja ${getDriverRoleSectionTitle(roleConfig.key, roleContacts.length)}`);

            const roleTitle = document.createElement('h3');
            roleTitle.className = 'qe-view-subtitle qe-role-segment__title';
            roleTitle.textContent = getDriverRoleSectionTitle(roleConfig.key, roleContacts.length);

            const roleGrid = document.createElement('div');
            roleGrid.className = 'qe-driver-role-grid';
            roleGrid.setAttribute('role', 'list');
            roleGrid.setAttribute('aria-label', getDriverRoleSectionTitle(roleConfig.key, roleContacts.length));

            roleSection.appendChild(roleTitle);
            roleSection.appendChild(roleGrid);
            roleSectionsContainer.appendChild(roleSection);

            const roleTiles = roleContacts.map((contact) => buildDriverTileModel(
                contact?.driverName,
                contact?.phones,
                getDriverTestRegistration(String(contact?.driverName ?? '')),
                contact?.roleCategory,
                contact?.roleNote
            ));

            renderDriverTileGrid(roleGrid, roleTiles, { emptyText: '', groupByLetter: false });
        }
    }

    const tiles = drivers
        .filter((driverName) => {
            const contact = getDriverContactForName(driverName);
            const keys = Array.isArray(contact?.lookupKeys) ? contact.lookupKeys : [];
            return !keys.some((key) => excludedDriverKeys.has(String(key ?? '').trim()));
        })
        .map((driverName) => {
        const contact = getDriverContactForName(driverName);
        return buildDriverTileModel(driverName, contact?.phones, getDriverTestRegistration(driverName), contact?.roleCategory, contact?.roleNote);
    });
    renderDriverTileGrid(driversGrid, tiles, { emptyText: 'Brak kierowców w zaimportowanych plikach grafiku.' });
}

function showRoutesShell() {
    trackVisibleView('routes');
    if (searchView) searchView.classList.add('view-hidden');
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.add('view-hidden');
    if (driversView) driversView.classList.add('view-hidden');
    if (routesView) routesView.classList.remove('view-hidden');
    setPrimaryNavActive('routes');
}

function showDriversShell() {
    trackVisibleView('drivers');
    if (searchView) searchView.classList.add('view-hidden');
    if (filePreviewView) filePreviewView.classList.add('view-hidden');
    if (scheduleView) scheduleView.classList.add('view-hidden');
    if (routesView) routesView.classList.add('view-hidden');
    if (driversView) driversView.classList.remove('view-hidden');
    setPrimaryNavActive('drivers');
}

async function openRoutesView({ skipPush = false, source = '', transitionToken = 0 } = {}) {
    showRoutesShell();
    await renderRoutesView();
    if (transitionToken && transitionToken !== primaryNavTransitionToken) return;
    if (!skipPush) ensureNavigationService().pushRoutes();
    logClientEvent('navigate', { to: 'routes', source: String(source || '') });
}

async function openDriversView({ skipPush = false, source = '', transitionToken = 0 } = {}) {
    showDriversShell();
    await renderDriversView();
    if (transitionToken && transitionToken !== primaryNavTransitionToken) return;
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
    trackVisibleView('schedule');
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
async function openScheduleView({ ym, selectedIsoDate, skipPush = false, source = '', transitionToken = 0 } = {}) {
    const restoreScheduleState = shouldRestoreScheduleView();
    showScheduleShell();
    if (scheduleSubtitle) scheduleSubtitle.textContent = 'Ładowanie grafiku...';

    const scheduleFiles = await docsListFiles();
    const list = Array.isArray(scheduleFiles) ? scheduleFiles : [];
    const monthEntriesMap = new Map();
    for (const f of list) {
        const name = String(f?.name ?? '').trim();
        if (!name) continue;
        const meta = parseScheduleFileNameYearMonth(name);
        if (!meta?.key) continue;
        const existing = monthEntriesMap.get(meta.key);
        const candidate = {
            key: meta.key,
            label: String(meta.displayLabel || meta.key).trim(),
            fileName: name
        };
        if (!existing || String(candidate.fileName).localeCompare(String(existing.fileName), 'pl', { sensitivity: 'base' }) < 0) {
            monthEntriesMap.set(meta.key, candidate);
        }
    }
    const monthEntries = Array.from(monthEntriesMap.values())
        .sort((a, b) => String(a.key).localeCompare(String(b.key), 'pl', { sensitivity: 'base' }));
    const uniqueMonthKeys = monthEntries.map(item => item.key);

    const now = new Date();
    const nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const requestedYm = String(ym || '').trim();
    const restoredYm = restoreScheduleState ? String(lastScheduleViewState?.monthKey || '').trim() : '';
    const defaultYm = uniqueMonthKeys.includes(nowYm)
        ? nowYm
        : (uniqueMonthKeys.length > 0 ? uniqueMonthKeys[uniqueMonthKeys.length - 1] : '');
    const targetYm = uniqueMonthKeys.includes(restoredYm)
        ? restoredYm
        : (uniqueMonthKeys.includes(requestedYm) ? requestedYm : defaultYm);

    const routeRecords = await getRouteFileRecords();
    refreshRouteMetaIndex(routeRecords);
    dataStore.rebuildRouteFileIndex(routeRecords);

    const ctrl = ensureScheduleController();
    ctrl.setAvailableMonthsList(monthEntries);

    const iso = typeof selectedIsoDate === 'string' ? selectedIsoDate.trim() : '';
    if (restoreScheduleState && lastScheduleViewState && typeof ctrl.restoreViewState === 'function') {
        ctrl.restoreViewState(lastScheduleViewState, { fallbackMonthKey: targetYm });
    } else {
        if (typeof ctrl.resetViewState === 'function') ctrl.resetViewState();
        if (targetYm) ctrl.setMonthByKey(targetYm);
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ctrl.setSelectedDay(iso);
    }

    if (transitionToken && transitionToken !== primaryNavTransitionToken) return;

    const activeScheduleState = typeof ctrl.getViewState === 'function' ? ctrl.getViewState() : null;
    const resolvedYm = String(activeScheduleState?.monthKey || targetYm || '').trim();
    const resolvedIso = typeof activeScheduleState?.selectedIsoDate === 'string' ? activeScheduleState.selectedIsoDate.trim() : (iso || null);

    if (!skipPush && resolvedYm) {
        ensureNavigationService().pushSchedule({ ym: resolvedYm, selectedIsoDate: resolvedIso || null });
    }
    logClientEvent('navigate', { to: 'schedule', ym: resolvedYm || targetYm, source: String(source || '') });
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
            dataStore.removeLoadedFile(name);
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
