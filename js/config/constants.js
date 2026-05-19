export const ROUTE_CATEGORIES_ORDER = Object.freeze(['STANDARD', 'WIECZOREK', 'SOBOTA', 'NIEDZIELA']);
export const ROUTE_CATEGORY_STORAGE_PREFIX = 'qe:routeCategoryCollapsed:';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

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
