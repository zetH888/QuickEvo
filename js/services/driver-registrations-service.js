import { buildNormalizedDriverLookupKey, fuzzyNormalizeText, normalizeDriverDisplayName } from '../core/utils.js';

/**
 * @module driver-registrations-service
 *
 * @description
 * Serwis odpowiedzialny za wczytywanie numerów rejestracyjnych kierowców
 * z osobnego pliku XLSX synchronizowanego z Google Drive.
 *
 * Założenia źródła:
 * - plik jest pojedynczym źródłem prawdy,
 * - wykorzystywany jest wyłącznie ostatni arkusz skoroszytu,
 * - ostatni arkusz powinien reprezentować bieżący miesiąc i rok,
 * - układ kolumn odpowiada grafikowi kierowców:
 *   - kolumna A: `IMIE I NAZWISKO`,
 *   - kolejne kolumny: numery dni miesiąca,
 *   - komórki: numery rejestracyjne pojazdów.
 *
 * Jeśli komórka dla wskazanego dnia jest pusta, serwis zwraca ostatnią
 * wcześniejszą, znaną rejestrację tego kierowcy w tym samym miesiącu.
 *
 * @param {{
 *   listFiles: (() => Promise<any[]>) | null,
 *   getBlob: ((fileName: string) => Promise<Blob|null>) | null,
 *   readWorkbook: ((source: any, fileName: string) => Promise<any>) | null,
 *   sheetToMatrix: ((worksheet: any) => any[][]) | null,
 *   getNow?: (() => Date) | null,
 *   logAction?: ((scope: string, payload?: any, level?: string) => void) | null
 * }} cfg
 * @returns {{
 *   loadDriverRegistrationsFiles: (opts?: { fullReload?: boolean }) => Promise<void>,
 *   processDriverRegistrationsFile: (fileName: string) => Promise<void>,
 *   invalidateDriverRegistrationsFile: (fileName: string) => void,
 *   getRegistrationForDriverName: (driverName: string, opts?: { date?: Date }) => string,
 *   getRegistrationForDriverNameOnIsoDate: (driverName: string, isoDate: string) => string,
 *   buildDriverLookupKey: (value: unknown) => string,
 *   buildDriverLookupKeys: (value: unknown) => string[],
 *   clearCache: () => void
 * }}
 */
export function createDriverRegistrationsService(cfg = {}) {
    const SOURCE_KIND = 'driver_registrations';
    const MONTH_NAMES_PL = Object.freeze([
        'styczen',
        'luty',
        'marzec',
        'kwiecien',
        'maj',
        'czerwiec',
        'lipiec',
        'sierpien',
        'wrzesien',
        'pazdziernik',
        'listopad',
        'grudzien'
    ]);

    /**
     * Indeks:
     * - klucz: znormalizowana nazwa kierowcy,
     * - wartość: mapa miesięcy -> mapa dni -> rejestracja.
     *
     * @type {Map<string, { driverName: string, lookupKeys: string[], byMonthKey: Map<string, Map<number, string>> }>}
     */
    let registrationsByLookupKey = new Map();

    /** @type {Set<string>} */
    let loadedDriverRegistrationFiles = new Set();

    /**
     * Buduje klucz porównawczy kierowcy odporny na warianty zapisu.
     *
     * @param {unknown} value
     * @returns {string}
     */
    function buildDriverLookupKey(value) {
        return buildNormalizedDriverLookupKey(value);
    }

    /**
     * Generuje bezpieczne warianty dopasowania tej samej osoby.
     *
     * @param {unknown} value
     * @returns {string[]}
     */
    function buildDriverLookupKeys(value) {
        const baseKey = buildDriverLookupKey(value);
        if (!baseKey) return [];

        const tokens = baseKey.split(' ').map((token) => token.trim()).filter(Boolean);
        if (tokens.length <= 1) return [baseKey];

        const variants = new Set([baseKey, tokens.slice().reverse().join(' ')]);

        const permute = (arr, startIndex) => {
            if (startIndex >= arr.length - 1) {
                variants.add(arr.join(' '));
                return;
            }

            const usedAtDepth = new Set();
            for (let i = startIndex; i < arr.length; i += 1) {
                const token = arr[i];
                if (usedAtDepth.has(token)) continue;
                usedAtDepth.add(token);
                [arr[startIndex], arr[i]] = [arr[i], arr[startIndex]];
                permute(arr, startIndex + 1);
                [arr[startIndex], arr[i]] = [arr[i], arr[startIndex]];
            }
        };

        if (tokens.length <= 4) permute(tokens.slice(), 0);
        return Array.from(variants).filter(Boolean);
    }

    /**
     * Zwraca bieżącą datę z możliwością wstrzyknięcia w testach.
     *
     * @returns {Date}
     */
    function getNow() {
        try {
            const date = cfg.getNow?.();
            if (date instanceof Date && !Number.isNaN(date.getTime())) return date;
        } catch { }
        return new Date();
    }

    /**
     * Buduje klucz miesiąca `YYYY-MM`.
     *
     * @param {number} year
     * @param {number} month
     * @returns {string}
     */
    function buildMonthKey(year, month) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';
        return `${y}-${String(m).padStart(2, '0')}`;
    }

    /**
     * Wylicza liczbę dni w miesiącu.
     *
     * @param {number} year
     * @param {number} month
     * @returns {number}
     */
    function daysInMonth(year, month) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return 31;
        return new Date(y, m, 0).getDate();
    }

    /**
     * Normalizuje numer rejestracyjny do postaci czytelnej w UI.
     *
     * @param {unknown} value
     * @returns {string}
     */
    function normalizeRegistrationValue(value) {
        const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        return raw.replace(/\.0+$/g, '').toUpperCase();
    }

    /**
     * Rozpoznaje wiersz nagłówka identyczny jak w grafiku kierowców.
     *
     * @param {any[][]} matrix
     * @returns {number}
     */
    function findRegistrationsHeaderRowIndex(matrix) {
        const rows = Array.isArray(matrix) ? matrix : [];
        for (let i = 0; i < rows.length; i += 1) {
            const row = Array.isArray(rows[i]) ? rows[i] : [];
            const first = row[0] === null || row[0] === undefined ? '' : String(row[0]);
            const normalized = fuzzyNormalizeText(first);
            if (normalized.includes('imie') && (normalized.includes('nazw') || normalized.includes('nazwisko'))) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Buduje mapę `dzień -> indeks kolumny`.
     *
     * @param {any[]} headerRow
     * @returns {Map<number, number>}
     */
    function buildDayColumnMap(headerRow) {
        const row = Array.isArray(headerRow) ? headerRow : [];
        const map = new Map();
        for (let col = 1; col < row.length; col += 1) {
            const value = Number(String(row[col] ?? '').trim());
            if (Number.isInteger(value) && value >= 1 && value <= 31 && !map.has(value)) {
                map.set(value, col);
            }
        }
        return map;
    }

    /**
     * Próbuje wyciągnąć miesiąc i rok z nazwy arkusza.
     * Jeśli to się nie uda, fallbackiem jest bieżąca data.
     *
     * @param {string} sheetName
     * @returns {{ year: number, month: number, key: string, matchesCurrentMonth: boolean }}
     */
    function parseSheetMonthMeta(sheetName) {
        const safeSheetName = String(sheetName ?? '').trim();
        const normalizedSheetName = fuzzyNormalizeText(safeSheetName);
        const now = getNow();
        const fallbackYear = now.getFullYear();
        const fallbackMonth = now.getMonth() + 1;
        const fallbackKey = buildMonthKey(fallbackYear, fallbackMonth);

        let matchedMonth = 0;
        for (let index = 0; index < MONTH_NAMES_PL.length; index += 1) {
            if (normalizedSheetName.includes(MONTH_NAMES_PL[index])) {
                matchedMonth = index + 1;
                break;
            }
        }

        const yearMatch = normalizedSheetName.match(/\b(20\d{2})\b/);
        const matchedYear = yearMatch ? Number(yearMatch[1]) : 0;
        const year = Number.isInteger(matchedYear) && matchedYear >= 2000 && matchedYear <= 2100 ? matchedYear : fallbackYear;
        const month = Number.isInteger(matchedMonth) && matchedMonth >= 1 && matchedMonth <= 12 ? matchedMonth : fallbackMonth;
        const key = buildMonthKey(year, month) || fallbackKey;
        const matchesCurrentMonth = year === fallbackYear && month === fallbackMonth;

        return { year, month, key, matchesCurrentMonth };
    }

    /**
     * Czyści cały cache rejestracji.
     *
     * @returns {void}
     */
    function clearCache() {
        registrationsByLookupKey = new Map();
        loadedDriverRegistrationFiles = new Set();
    }

    /**
     * Dodaje lub scala rejestracje dla jednego kierowcy i miesiąca.
     *
     * @param {{ driverName: string, lookupKeys: string[], monthKey: string, dayRegistrations: Map<number, string> }} entry
     * @returns {void}
     */
    function upsertRegistrations(entry) {
        const lookupKeys = Array.isArray(entry?.lookupKeys) ? entry.lookupKeys.map((key) => String(key ?? '').trim()).filter(Boolean) : [];
        const monthKey = String(entry?.monthKey ?? '').trim();
        const dayRegistrations = entry?.dayRegistrations instanceof Map ? entry.dayRegistrations : null;
        if (lookupKeys.length === 0 || !monthKey || !(dayRegistrations instanceof Map)) return;

        for (const lookupKey of lookupKeys) {
            if (!registrationsByLookupKey.has(lookupKey)) {
                registrationsByLookupKey.set(lookupKey, {
                    driverName: String(entry?.driverName ?? '').trim(),
                    lookupKeys: lookupKeys.slice(),
                    byMonthKey: new Map()
                });
            }

            const target = registrationsByLookupKey.get(lookupKey);
            if (!target) continue;
            if (!(target.byMonthKey instanceof Map)) target.byMonthKey = new Map();
            if (!target.byMonthKey.has(monthKey)) target.byMonthKey.set(monthKey, new Map());

            const targetMonthMap = target.byMonthKey.get(monthKey);
            if (!(targetMonthMap instanceof Map)) continue;

            for (const [day, registration] of dayRegistrations.entries()) {
                const safeDay = Number(day);
                const safeRegistration = normalizeRegistrationValue(registration);
                if (!Number.isInteger(safeDay) || safeDay < 1 || safeDay > 31 || !safeRegistration) continue;
                targetMonthMap.set(safeDay, safeRegistration);
            }
        }
    }

    /**
     * Parsuje wskazany skoroszyt rejestracji.
     *
     * @param {any} source
     * @param {string} fileName
     * @returns {Promise<void>}
     */
    async function parseDriverRegistrationsSpreadsheet(source, fileName) {
        const safeFileName = String(fileName ?? '').trim();
        if (!safeFileName) throw new Error('Brak nazwy pliku rejestracji kierowców.');
        if (typeof cfg.readWorkbook !== 'function' || typeof cfg.sheetToMatrix !== 'function') {
            throw new Error('Brak zależności readWorkbook/sheetToMatrix w driver-registrations-service.');
        }

        const workbook = await cfg.readWorkbook(source, safeFileName);
        const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames.map((name) => String(name ?? '').trim()).filter(Boolean) : [];
        const lastSheetName = sheetNames.length > 0 ? sheetNames[sheetNames.length - 1] : '';
        if (!lastSheetName) throw new Error('Plik rejestracji nie zawiera arkusza.');

        const worksheet = workbook?.Sheets?.[lastSheetName];
        const matrix = cfg.sheetToMatrix(worksheet);
        const headerRowIndex = findRegistrationsHeaderRowIndex(matrix);
        if (headerRowIndex < 0) {
            throw new Error('Nie znaleziono wiersza nagłówka rejestracji ("IMIE I NAZWISKO").');
        }

        const monthMeta = parseSheetMonthMeta(lastSheetName);
        if (!monthMeta.matchesCurrentMonth) {
            try {
                cfg.logAction?.('driver_registrations', {
                    phase: 'last_sheet_not_current_month',
                    fileName: safeFileName,
                    sheetName: lastSheetName,
                    monthKey: monthMeta.key
                }, 'WARN');
            } catch { }
        }

        const headerRow = matrix[headerRowIndex];
        const dayToCol = buildDayColumnMap(headerRow);
        const maxDays = daysInMonth(monthMeta.year, monthMeta.month);

        for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
            const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
            const driverName = normalizeDriverDisplayName(row[0]);
            if (!driverName) continue;

            const lookupKeys = buildDriverLookupKeys(driverName);
            if (lookupKeys.length === 0) continue;

            const dayRegistrations = new Map();
            for (let day = 1; day <= maxDays; day += 1) {
                const col = dayToCol.get(day);
                if (!Number.isInteger(col)) continue;
                const registration = normalizeRegistrationValue(row[col]);
                if (!registration) continue;
                dayRegistrations.set(day, registration);
            }

            upsertRegistrations({
                driverName,
                lookupKeys,
                monthKey: monthMeta.key,
                dayRegistrations
            });
        }
    }

    /**
     * Przetwarza pojedynczy plik rejestracji zapisany lokalnie.
     *
     * @param {string} fileName
     * @returns {Promise<void>}
     */
    async function processDriverRegistrationsFile(fileName) {
        const safeFileName = String(fileName ?? '').trim();
        if (!safeFileName) return;

        const source = typeof cfg.getBlob === 'function' ? await cfg.getBlob(safeFileName) : null;
        if (!source) throw new Error(`Brak pliku rejestracji kierowców: ${safeFileName}`);

        await parseDriverRegistrationsSpreadsheet(source, safeFileName);
        loadedDriverRegistrationFiles.add(safeFileName);
    }

    /**
     * Wczytuje wszystkie pliki rejestracji dostępne w lokalnej bazie.
     *
     * @param {{ fullReload?: boolean }} [opts]
     * @returns {Promise<void>}
     */
    async function loadDriverRegistrationsFiles({ fullReload = false } = {}) {
        try {
            const allFiles = await cfg.listFiles?.();
            const registrationsFiles = Array.isArray(allFiles)
                ? allFiles
                    .filter((file) => String(file?.sourceKind ?? '').trim() === SOURCE_KIND)
                    .map((file) => String(file?.name ?? '').trim())
                    .filter(Boolean)
                : [];

            if (registrationsFiles.length === 0) return;

            if (fullReload) clearCache();

            for (const fileName of registrationsFiles) {
                if (!fullReload && loadedDriverRegistrationFiles.has(fileName)) continue;
                try {
                    await processDriverRegistrationsFile(fileName);
                } catch (err) {
                    try {
                        cfg.logAction?.('driver_registrations', {
                            phase: 'load_failed',
                            fileName,
                            message: err?.message ? String(err.message) : 'Błąd wczytywania rejestracji'
                        }, 'WARN');
                    } catch { }
                }
            }
        } catch (err) {
            try {
                cfg.logAction?.('driver_registrations', {
                    phase: 'list_failed',
                    message: err?.message ? String(err.message) : 'Błąd listowania plików rejestracji'
                }, 'WARN');
            } catch { }
        }
    }

    /**
     * Unieważnia cache pojedynczego pliku.
     * Ponieważ źródło jest pojedyncze i małe, najbezpieczniej czyścimy cały indeks.
     *
     * @param {string} fileName
     * @returns {void}
     */
    function invalidateDriverRegistrationsFile(fileName) {
        const safeFileName = String(fileName ?? '').trim();
        if (!safeFileName) return;
        clearCache();
    }

    /**
     * Parsuje datę ISO `YYYY-MM-DD`.
     *
     * @param {string} isoDate
     * @returns {{ year: number, month: number, day: number, monthKey: string } | null}
     */
    function parseIsoDate(isoDate) {
        const raw = String(isoDate ?? '').trim();
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
        if (!Number.isInteger(month) || month < 1 || month > 12) return null;
        if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;

        const monthKey = buildMonthKey(year, month);
        if (!monthKey) return null;
        return { year, month, day, monthKey };
    }

    /**
     * Zwraca rejestrację dla zestawu kluczy kierowcy w konkretnym dniu.
     *
     * Jeśli komórka dla danego dnia jest pusta, serwis szuka wstecz
     * ostatniej znanej rejestracji w tym samym miesiącu.
     *
     * @param {string[]} lookupKeys
     * @param {{ day: number, monthKey: string } | null} targetDate
     * @returns {string}
     */
    function resolveRegistrationForLookupKeys(lookupKeys, targetDate) {
        const keys = Array.isArray(lookupKeys) ? lookupKeys.map((key) => String(key ?? '').trim()).filter(Boolean) : [];
        if (keys.length === 0 || !targetDate?.monthKey || !Number.isInteger(targetDate?.day)) return '';

        for (const lookupKey of keys) {
            const bucket = registrationsByLookupKey.get(lookupKey);
            const byMonthKey = bucket?.byMonthKey;
            const monthMap = byMonthKey instanceof Map ? byMonthKey.get(targetDate.monthKey) : null;
            if (!(monthMap instanceof Map) || monthMap.size === 0) continue;

            for (let day = targetDate.day; day >= 1; day -= 1) {
                const registration = normalizeRegistrationValue(monthMap.get(day));
                if (registration) return registration;
            }
        }

        return '';
    }

    /**
     * Zwraca rejestrację kierowcy dla daty ISO `YYYY-MM-DD`.
     *
     * @param {string} driverName
     * @param {string} isoDate
     * @returns {string}
     */
    function getRegistrationForDriverNameOnIsoDate(driverName, isoDate) {
        const parsed = parseIsoDate(isoDate);
        if (!parsed) return '';
        const lookupKeys = buildDriverLookupKeys(driverName);
        return resolveRegistrationForLookupKeys(lookupKeys, parsed);
    }

    /**
     * Zwraca rejestrację kierowcy dla podanej daty lub dla dnia bieżącego.
     *
     * @param {string} driverName
     * @param {{ date?: Date }} [opts]
     * @returns {string}
     */
    function getRegistrationForDriverName(driverName, { date } = {}) {
        const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : getNow();
        const isoDate = `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, '0')}-${String(safeDate.getDate()).padStart(2, '0')}`;
        return getRegistrationForDriverNameOnIsoDate(driverName, isoDate);
    }

    return Object.freeze({
        loadDriverRegistrationsFiles,
        processDriverRegistrationsFile,
        invalidateDriverRegistrationsFile,
        getRegistrationForDriverName,
        getRegistrationForDriverNameOnIsoDate,
        buildDriverLookupKey,
        buildDriverLookupKeys,
        clearCache
    });
}
