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
 * - wszystkie arkusze skoroszytu reprezentują historię zmian,
 * - ostatni arkusz jest traktowany jako najnowszy punkt startowy,
 * - nazwy arkuszy mają format `<MIESIĄC> <ROK>`,
 * - układ kolumn odpowiada grafikowi kierowców:
 *   - kolumna A: `IMIE I NAZWISKO`,
 *   - kolejne kolumny: numery dni miesiąca,
 *   - komórki: numery rejestracyjne pojazdów.
 *
 * Dla wskazanego kierowcy i dnia serwis działa następująco:
 * - zaczyna od ostatniego arkusza skoroszytu,
 * - w ostatnim arkuszu szuka od wskazanego dnia wstecz do `1`,
 * - jeśli nic nie znajdzie, przechodzi do starszych arkuszy,
 * - w każdym starszym arkuszu szuka od końca miesiąca wstecz do `1`,
 * - zwraca pierwszą napotkaną niepustą rejestrację.
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
 *   getRegistrationInfoForDriverName: (driverName: string, opts?: { date?: Date }) => { registration: string, sourceIsoDate: string, sourceSheetName: string },
 *   getRegistrationInfoForDriverNameOnIsoDate: (driverName: string, isoDate: string) => { registration: string, sourceIsoDate: string, sourceSheetName: string },
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
    const MONTH_NAME_TO_NUMBER = Object.freeze(MONTH_NAMES_PL.reduce((acc, monthName, index) => {
        acc[monthName] = index + 1;
        return acc;
    }, {}));
    const SHEET_MONTH_PATTERN = new RegExp(`^(${MONTH_NAMES_PL.join('|')})\\s+(20\\d{2})$`);

    /**
     * Indeks:
     * - klucz: znormalizowana nazwa kierowcy,
     * - wartość: mapa arkuszy z gotowymi wpisami dziennymi.
     *
     * @type {Map<string, { driverName: string, lookupKeys: string[], bySheetIndex: Map<number, { sheetIndex: number, sheetName: string, monthKey: string, maxDays: number, dayRegistrations: Map<number, string>, sortedDaysDesc: number[] }> }>}
     */
    let registrationsByLookupKey = new Map();

    /** @type {Set<string>} */
    let loadedDriverRegistrationFiles = new Set();

    /**
     * Chronologiczna lista arkuszy od najstarszego do najnowszego.
     *
     * @type {Array<{ sheetIndex: number, sheetName: string, monthKey: string, year: number, month: number, maxDays: number }>}
     */
    let registrationSheetTimeline = [];

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
     * Buduje datę ISO (`YYYY-MM-DD`) z bezpiecznych części składowych.
     *
     * @param {number} year
     * @param {number} month
     * @param {number} day
     * @returns {string}
     */
    function buildIsoDate(year, month, day) {
        const y = Number(year);
        const m = Number(month);
        const d = Number(day);
        if (!Number.isInteger(y) || y < 2000 || y > 2100) return '';
        if (!Number.isInteger(m) || m < 1 || m > 12) return '';
        const maxDays = daysInMonth(y, m);
        if (!Number.isInteger(d) || d < 1 || d > maxDays) return '';
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
     * Preferuje ścisły format `<MIESIĄC> <ROK>`, ale zachowuje fallback,
     * aby nie wywrócić starszych plików o lekko innym zapisie.
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

        let month = 0;
        let year = 0;

        const strictMatch = normalizedSheetName.match(SHEET_MONTH_PATTERN);
        if (strictMatch) {
            month = Number(MONTH_NAME_TO_NUMBER[strictMatch[1]] || 0);
            year = Number(strictMatch[2]);
        }

        if (!month) {
            for (let index = 0; index < MONTH_NAMES_PL.length; index += 1) {
                if (normalizedSheetName.includes(MONTH_NAMES_PL[index])) {
                    month = index + 1;
                    break;
                }
            }
        }

        if (!year) {
            const yearMatch = normalizedSheetName.match(/\b(20\d{2})\b/);
            year = yearMatch ? Number(yearMatch[1]) : 0;
        }

        const safeYear = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : fallbackYear;
        const safeMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : fallbackMonth;
        const key = buildMonthKey(safeYear, safeMonth) || fallbackKey;
        const matchesCurrentMonth = safeYear === fallbackYear && safeMonth === fallbackMonth;

        return { year: safeYear, month: safeMonth, key, matchesCurrentMonth };
    }

    /**
     * Czyści cały cache rejestracji.
     *
     * @returns {void}
     */
    function clearCache() {
        registrationsByLookupKey = new Map();
        loadedDriverRegistrationFiles = new Set();
        registrationSheetTimeline = [];
    }

    /**
     * Dodaje lub scala rejestracje dla jednego kierowcy i konkretnego arkusza.
     *
     * @param {{
     *   driverName: string,
     *   lookupKeys: string[],
     *   sheetMeta: { sheetIndex: number, sheetName: string, monthKey: string, maxDays: number },
     *   dayRegistrations: Map<number, string>
     * }} entry
     * @returns {void}
     */
    function upsertRegistrations(entry) {
        const lookupKeys = Array.isArray(entry?.lookupKeys)
            ? entry.lookupKeys.map((key) => String(key ?? '').trim()).filter(Boolean)
            : [];
        const sheetIndex = Number(entry?.sheetMeta?.sheetIndex);
        const sheetName = String(entry?.sheetMeta?.sheetName ?? '').trim();
        const monthKey = String(entry?.sheetMeta?.monthKey ?? '').trim();
        const maxDays = Number(entry?.sheetMeta?.maxDays);
        const dayRegistrations = entry?.dayRegistrations instanceof Map ? entry.dayRegistrations : null;
        if (lookupKeys.length === 0 || !Number.isInteger(sheetIndex) || !sheetName || !monthKey || !Number.isInteger(maxDays) || !(dayRegistrations instanceof Map) || dayRegistrations.size === 0) {
            return;
        }

        for (const lookupKey of lookupKeys) {
            if (!registrationsByLookupKey.has(lookupKey)) {
                registrationsByLookupKey.set(lookupKey, {
                    driverName: String(entry?.driverName ?? '').trim(),
                    lookupKeys: lookupKeys.slice(),
                    bySheetIndex: new Map()
                });
            }

            const target = registrationsByLookupKey.get(lookupKey);
            if (!target) continue;
            if (!(target.bySheetIndex instanceof Map)) target.bySheetIndex = new Map();
            if (!target.bySheetIndex.has(sheetIndex)) {
                target.bySheetIndex.set(sheetIndex, {
                    sheetIndex,
                    sheetName,
                    monthKey,
                    maxDays,
                    dayRegistrations: new Map(),
                    sortedDaysDesc: []
                });
            }

            const targetSheetEntry = target.bySheetIndex.get(sheetIndex);
            if (!targetSheetEntry || !(targetSheetEntry.dayRegistrations instanceof Map)) continue;

            for (const [day, registration] of dayRegistrations.entries()) {
                const safeDay = Number(day);
                const safeRegistration = normalizeRegistrationValue(registration);
                if (!Number.isInteger(safeDay) || safeDay < 1 || safeDay > 31 || !safeRegistration) continue;
                targetSheetEntry.dayRegistrations.set(safeDay, safeRegistration);
            }

            targetSheetEntry.sortedDaysDesc = Array.from(targetSheetEntry.dayRegistrations.keys())
                .map((day) => Number(day))
                .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
                .sort((a, b) => b - a);
        }
    }

    /**
     * Zwraca pierwsze trafienie rejestracji z arkusza nie dalej niż do wskazanego dnia.
     *
     * @param {{ dayRegistrations: Map<number, string>, sortedDaysDesc: number[] } | null | undefined} sheetEntry
     * @param {number} maxDayInclusive
     * @returns {{ registration: string, day: number } | null}
     */
    function resolveRegistrationMatchFromSheetEntry(sheetEntry, maxDayInclusive) {
        const safeMaxDayInclusive = Number(maxDayInclusive);
        if (!sheetEntry || !Number.isInteger(safeMaxDayInclusive) || safeMaxDayInclusive < 1) return null;
        const daysDesc = Array.isArray(sheetEntry.sortedDaysDesc) ? sheetEntry.sortedDaysDesc : [];
        const dayRegistrations = sheetEntry.dayRegistrations instanceof Map ? sheetEntry.dayRegistrations : null;
        if (!(dayRegistrations instanceof Map) || daysDesc.length === 0) return null;

        for (const day of daysDesc) {
            if (!Number.isInteger(day) || day < 1 || day > safeMaxDayInclusive) continue;
            const registration = normalizeRegistrationValue(dayRegistrations.get(day));
            if (registration) return { registration, day };
        }

        return null;
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
        const sheetNames = Array.isArray(workbook?.SheetNames)
            ? workbook.SheetNames.map((name) => String(name ?? '').trim()).filter(Boolean)
            : [];
        const lastSheetName = sheetNames.length > 0 ? sheetNames[sheetNames.length - 1] : '';
        if (!lastSheetName) throw new Error('Plik rejestracji nie zawiera arkusza.');

        const lastSheetMonthMeta = parseSheetMonthMeta(lastSheetName);
        if (!lastSheetMonthMeta.matchesCurrentMonth) {
            try {
                cfg.logAction?.('driver_registrations', {
                    phase: 'last_sheet_not_current_month',
                    fileName: safeFileName,
                    sheetName: lastSheetName,
                    monthKey: lastSheetMonthMeta.key
                }, 'WARN');
            } catch { }
        }

        let parsedSheetCount = 0;
        for (const sheetName of sheetNames) {
            const worksheet = workbook?.Sheets?.[sheetName];
            const matrix = cfg.sheetToMatrix(worksheet);
            const headerRowIndex = findRegistrationsHeaderRowIndex(matrix);
            if (headerRowIndex < 0) {
                try {
                    cfg.logAction?.('driver_registrations', {
                        phase: 'sheet_skipped_invalid_header',
                        fileName: safeFileName,
                        sheetName
                    }, 'WARN');
                } catch { }
                continue;
            }

            const monthMeta = parseSheetMonthMeta(sheetName);
            const headerRow = matrix[headerRowIndex];
            const dayToCol = buildDayColumnMap(headerRow);
            const maxDays = daysInMonth(monthMeta.year, monthMeta.month);
            const sheetIndex = registrationSheetTimeline.length;
            const sheetMeta = {
                sheetIndex,
                sheetName,
                monthKey: monthMeta.key,
                year: monthMeta.year,
                month: monthMeta.month,
                maxDays
            };

            registrationSheetTimeline.push(sheetMeta);
            parsedSheetCount += 1;

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
                    sheetMeta,
                    dayRegistrations
                });
            }
        }

        if (parsedSheetCount === 0) {
            throw new Error('Nie znaleziono poprawnego arkusza rejestracji z nagłówkiem "IMIE I NAZWISKO".');
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
     * Zwraca szczegóły rejestracji dla zestawu kluczy kierowcy w konkretnym dniu.
     *
     * Strategia:
     * - ostatni arkusz: szukanie od wskazanego dnia wstecz,
     * - każdy starszy arkusz: szukanie od końca miesiąca wstecz,
     * - wynik: pierwsza napotkana niepusta komórka.
     *
     * @param {string[]} lookupKeys
     * @param {{ day: number, monthKey: string } | null} targetDate
     * @returns {{ registration: string, sourceIsoDate: string, sourceSheetName: string }}
     */
    function resolveRegistrationInfoForLookupKeys(lookupKeys, targetDate) {
        const keys = Array.isArray(lookupKeys)
            ? lookupKeys.map((key) => String(key ?? '').trim()).filter(Boolean)
            : [];
        if (keys.length === 0 || !targetDate?.monthKey || !Number.isInteger(targetDate?.day)) {
            return { registration: '', sourceIsoDate: '', sourceSheetName: '' };
        }
        if (!Array.isArray(registrationSheetTimeline) || registrationSheetTimeline.length === 0) {
            return { registration: '', sourceIsoDate: '', sourceSheetName: '' };
        }

        const latestSheetIndex = registrationSheetTimeline.length - 1;
        const buckets = [];
        const seen = new Set();
        for (const lookupKey of keys) {
            const bucket = registrationsByLookupKey.get(lookupKey);
            if (!bucket || seen.has(bucket)) continue;
            seen.add(bucket);
            buckets.push(bucket);
        }
        if (buckets.length === 0) return { registration: '', sourceIsoDate: '', sourceSheetName: '' };

        for (let sheetIndex = latestSheetIndex; sheetIndex >= 0; sheetIndex -= 1) {
            const sheetMeta = registrationSheetTimeline[sheetIndex];
            if (!sheetMeta) continue;

            const maxDayInclusive = sheetIndex === latestSheetIndex
                ? Math.min(targetDate.day, sheetMeta.maxDays)
                : sheetMeta.maxDays;
            if (!Number.isInteger(maxDayInclusive) || maxDayInclusive < 1) continue;

            for (const bucket of buckets) {
                const bySheetIndex = bucket?.bySheetIndex;
                const sheetEntry = bySheetIndex instanceof Map ? bySheetIndex.get(sheetIndex) : null;
                const match = resolveRegistrationMatchFromSheetEntry(sheetEntry, maxDayInclusive);
                if (!match) continue;
                return {
                    registration: match.registration,
                    sourceIsoDate: buildIsoDate(sheetMeta.year, sheetMeta.month, match.day),
                    sourceSheetName: String(sheetMeta.sheetName ?? '').trim()
                };
            }
        }

        return { registration: '', sourceIsoDate: '', sourceSheetName: '' };
    }

    /**
     * Zwraca szczegóły rejestracji kierowcy dla daty ISO `YYYY-MM-DD`.
     *
     * @param {string} driverName
     * @param {string} isoDate
     * @returns {{ registration: string, sourceIsoDate: string, sourceSheetName: string }}
     */
    function getRegistrationInfoForDriverNameOnIsoDate(driverName, isoDate) {
        const parsed = parseIsoDate(isoDate);
        if (!parsed) return { registration: '', sourceIsoDate: '', sourceSheetName: '' };
        const lookupKeys = buildDriverLookupKeys(driverName);
        return resolveRegistrationInfoForLookupKeys(lookupKeys, parsed);
    }

    /**
     * Zwraca rejestrację kierowcy dla daty ISO `YYYY-MM-DD`.
     *
     * @param {string} driverName
     * @param {string} isoDate
     * @returns {string}
     */
    function getRegistrationForDriverNameOnIsoDate(driverName, isoDate) {
        return String(getRegistrationInfoForDriverNameOnIsoDate(driverName, isoDate)?.registration ?? '').trim();
    }

    /**
     * Zwraca szczegóły rejestracji kierowcy dla podanej daty lub dla dnia bieżącego.
     *
     * @param {string} driverName
     * @param {{ date?: Date }} [opts]
     * @returns {{ registration: string, sourceIsoDate: string, sourceSheetName: string }}
     */
    function getRegistrationInfoForDriverName(driverName, { date } = {}) {
        const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : getNow();
        const isoDate = `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, '0')}-${String(safeDate.getDate()).padStart(2, '0')}`;
        return getRegistrationInfoForDriverNameOnIsoDate(driverName, isoDate);
    }

    /**
     * Zwraca rejestrację kierowcy dla podanej daty lub dla dnia bieżącego.
     *
     * @param {string} driverName
     * @param {{ date?: Date }} [opts]
     * @returns {string}
     */
    function getRegistrationForDriverName(driverName, { date } = {}) {
        return String(getRegistrationInfoForDriverName(driverName, { date })?.registration ?? '').trim();
    }

    return Object.freeze({
        loadDriverRegistrationsFiles,
        processDriverRegistrationsFile,
        invalidateDriverRegistrationsFile,
        getRegistrationInfoForDriverName,
        getRegistrationInfoForDriverNameOnIsoDate,
        getRegistrationForDriverName,
        getRegistrationForDriverNameOnIsoDate,
        buildDriverLookupKey,
        buildDriverLookupKeys,
        clearCache
    });
}
