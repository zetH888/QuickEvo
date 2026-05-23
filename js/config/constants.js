export const ROUTE_CATEGORIES_ORDER = Object.freeze(['STANDARD', 'WIECZOREK', 'SOBOTA', 'NIEDZIELA']);
export const ROUTE_CATEGORY_STORAGE_PREFIX = 'qe:routeCategoryCollapsed:';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Zestawy tokenów do wykrywania wierszy związanych z laboratorium.
 *
 * Założenie biznesowe: badge „laboratorium” ma być nadawany tylko wtedy, gdy wymagane tokeny
 * występują w nazwie placówki (kolumna z nazwą), a nie w innych polach (np. „uwagi”).
 *
 * Format: lista list tokenów/fraz. Tokenizacja wykonywana jest w search-engine (normalizacja + split).
 *
 * @type {ReadonlyArray<ReadonlyArray<string>>}
 */
export const KEY_LAB_TOKEN_SETS = Object.freeze([
    Object.freeze(['dzika', 'laboratorium']),
    Object.freeze(['dzika', 'lm']),
    Object.freeze(['dzika', 'lab']),
    Object.freeze(['dzika', 'lab.']),
    Object.freeze(['piaseczno', 'laboratorium']),
    Object.freeze(['piaseczno', 'lab']),
    Object.freeze(['piaseczno', 'lab.']),
    Object.freeze(['lodz', 'laboratorium']),
    Object.freeze(['lodz', 'lab']),
    Object.freeze(['lodz', 'lab.']),
    Object.freeze(['wolomin', 'laboratorium']),
    Object.freeze(['wolomin', 'lab']),
    Object.freeze(['wolomin', 'lab.']),
    Object.freeze(['wilanow', 'laboratorium']),
    Object.freeze(['wilanow', 'lab']),
    Object.freeze(['wilanow', 'lab.']),
    Object.freeze(['szpital', 'medicover'])
]);

export const WELCOME_LOGO_ENTER_DELAY_MS = 420;
export const WELCOME_SEQUENCE_UNLOCK_AFTER_MS = 1750;
export const WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS = 650;
export const BOOT_WATCHDOG_MS = 8000;

export const LOADING_TITLE_INTERVAL_MIN_MS = 500;
export const LOADING_TITLE_INTERVAL_MAX_MS = 800;
export const LOADING_TITLE_FADE_OUT_MS = 200;
export const LOADING_TITLE_FADE_IN_MS = 300;

export const LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH = 97;
export const LOADING_PROGRESS_MICROSTOP_MIN_MS = 200;
export const LOADING_PROGRESS_MICROSTOP_MAX_MS = 500;
export const LOADING_PROGRESS_JUMP_MIN = 1;
export const LOADING_PROGRESS_JUMP_MAX = 5;

export const LOADING_TITLE_MESSAGES = Object.freeze({
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
});

/**
 * Słownik znaczeń skrótów/markerów pojawiających się w grafiku (np. urlopy, dyżury).
 * Mapowanie jest celowo konfigurowalne, aby można je było aktualizować bez zmian w logice parsowania.
 */
export const SCHEDULE_MARKER_MEANINGS = Object.freeze({
    Z: 'Urlop',
    'UŻ': 'Urlop na żądanie',
    UZ: 'Urlop na żądanie',
    DK: 'Sobotni dyżur koordynatora',
    '*D': 'Dyżur poranny',
    '*P': 'Dyżur popołudniowy'
});
