function normalizeDriverDisplayName(value) {
    const raw = value === null || value === undefined ? '' : String(value);
    return raw.replace(/\s+/g, ' ').trim();
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

function daysInMonth(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m)) return 31;
    return new Date(y, m, 0).getDate();
}

/**
 * Parsuje datę w formacie ISO (YYYY-MM-DD) bez użycia `Date`, aby uniknąć problemów ze strefami czasowymi.
 *
 * @param {string} isoDate
 * @returns {{ year: number, month: number, day: number, key: string, iso: string } | null}
 */
function parseIsoDateStrict(isoDate) {
    const raw = String(isoDate ?? '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    const maxDays = daysInMonth(year, month);
    if (!Number.isInteger(day) || day < 1 || day > maxDays) return null;

    const iso = isoDateFromParts(year, month, day);
    const key = scheduleMonthKey(year, month);
    if (!iso || !key) return null;

    return { year, month, day, key, iso };
}

function getDefaultRouteScheduleConfig() {
    const cfg = globalThis.QE_RouteScheduleConfig;
    if (cfg && typeof cfg === 'object') return cfg;
    return {
        monthsPl: {},
        dayMarkers: [],
        normalizeScheduleToken: (t) => String(t ?? '').trim().toUpperCase()
    };
}

export function createScheduleService(cfg = {}) {
    const fuzzyNormalizeText = typeof cfg?.fuzzyNormalizeText === 'function' ? cfg.fuzzyNormalizeText : ((t) => String(t ?? '').toLowerCase());
    const readWorkbook = typeof cfg?.readWorkbook === 'function' ? cfg.readWorkbook : (async () => { throw new Error('Brak readWorkbook'); });
    const sheetToMatrix = typeof cfg?.sheetToMatrix === 'function' ? cfg.sheetToMatrix : (() => { throw new Error('Brak sheetToMatrix'); });
    const getBlob = typeof cfg?.getBlob === 'function' ? cfg.getBlob : (async () => null);
    const listFiles = typeof cfg?.listFiles === 'function' ? cfg.listFiles : (async () => []);
    const getRouteCatalog = typeof cfg?.getRouteCatalog === 'function' ? cfg.getRouteCatalog : (async () => new Map());
    const logAction = typeof cfg?.logAction === 'function' ? cfg.logAction : (() => { });
    const getRouteScheduleConfig = typeof cfg?.getRouteScheduleConfig === 'function' ? cfg.getRouteScheduleConfig : getDefaultRouteScheduleConfig;

    let scheduleCacheByMonth = new Map();
    let loadedScheduleFiles = new Set();

    /**
     * Normalizuje kod trasy do postaci używanej w cache (kompakt: bez spacji, ujednolicone myślniki).
     *
     * @param {unknown} value
     * @returns {string}
     */
    function normalizeScheduleRouteCodeForLookup(value) {
        return normalizeScheduleRouteCode(value)
            .replace(/\s+/g, '')
            .replace(/[–—]/g, '-')
            .trim()
            .toUpperCase();
    }

    /**
     * Pobiera wpis cache dla konkretnego miesiąca (YYYY-MM), jeśli został wczytany.
     *
     * @param {number} year
     * @param {number} month
     * @returns {{ key: string, year: number, month: number, fileName: string, byIsoDate: Map<string, Map<string, Set<string>>>, derived?: any } | null}
     */
    function getMonthCache(year, month) {
        const key = scheduleMonthKey(year, month);
        if (!key) return null;
        const cache = scheduleCacheByMonth.get(key);
        if (!cache || !(cache.byIsoDate instanceof Map)) return null;
        return cache;
    }

    /**
     * Tworzy lub zwraca indeks pochodny dla miesiąca (unikamy wielokrotnego sortowania i agregacji).
     *
     * Struktura:
     * - routesSorted: string[]
     * - dayRoutesSortedByIso: Map<string, string[]>
     *
     * @param {any} monthCache
     * @returns {{ routesSorted: string[], dayRoutesSortedByIso: Map<string, string[]> }}
     */
    function ensureMonthDerivedIndex(monthCache) {
        if (!monthCache || !(monthCache.byIsoDate instanceof Map)) {
            return { routesSorted: [], dayRoutesSortedByIso: new Map() };
        }

        if (monthCache.derived && monthCache.derived.routesSorted && monthCache.derived.dayRoutesSortedByIso) {
            return monthCache.derived;
        }

        const routes = new Set();
        const dayRoutesSortedByIso = new Map();

        for (const [iso, byRoute] of monthCache.byIsoDate.entries()) {
            if (!(byRoute instanceof Map)) continue;
            const routeList = Array.from(byRoute.keys()).filter(Boolean);
            routeList.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
            dayRoutesSortedByIso.set(iso, routeList);
            for (const r of routeList) routes.add(r);
        }

        const routesSorted = Array.from(routes);
        routesSorted.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));

        monthCache.derived = { routesSorted, dayRoutesSortedByIso };
        return monthCache.derived;
    }

    function normalizeScheduleRouteCode(value) {
        const c = getRouteScheduleConfig();
        const token = c.normalizeScheduleToken ? c.normalizeScheduleToken(value) : String(value ?? '').trim().toUpperCase();
        return String(token || '').trim().toUpperCase();
    }

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

        const c = getRouteScheduleConfig();
        const monthKey = String(fuzzyNormalizeText(monthRaw) || '').toUpperCase();
        const month = Number(c.monthsPl?.[monthKey]);
        if (!Number.isInteger(month) || month < 1 || month > 12) return null;

        return { year, month, key: scheduleMonthKey(year, month) };
    }

    function isScheduleFileName(fileName) {
        return Boolean(parseScheduleFileNameYearMonth(fileName));
    }

    /**
     * Wariant „ściśle .xlsx” dla wymagań grafiku pobieranego z Google Drive.
     *
     * @param {string} fileName
     * @returns {{ year: number, month: number, key: string } | null}
     */
    function parseScheduleFileNameYearMonthStrictXlsx(fileName) {
        const name = String(fileName || '').trim();
        if (!name) return null;
        if (!/\.xlsx$/i.test(name)) return null;
        return parseScheduleFileNameYearMonth(name);
    }

    /**
     * Sprawdza, czy nazwa pasuje do schematu „MIASTO MIESIĄC ROK.xlsx”.
     *
     * @param {string} fileName
     * @returns {boolean}
     */
    function isScheduleXlsxFileName(fileName) {
        return Boolean(parseScheduleFileNameYearMonthStrictXlsx(fileName));
    }

    /**
     * Wybiera nazwę pliku grafiku dla konkretnego miesiąca/roku.
     * Jeśli istnieje wiele dopasowań, zwraca deterministycznie pierwszy wg sortowania PL.
     *
     * @param {string[]} fileNames
     * @param {{ year: number, month: number, strictXlsx?: boolean }} opts
     * @returns {string}
     */
    function selectScheduleFileNameForYearMonth(fileNames, { year, month, strictXlsx = false } = {}) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';

        const list = Array.isArray(fileNames) ? fileNames.map(n => String(n ?? '').trim()).filter(Boolean) : [];
        const candidates = [];
        for (const name of list) {
            const meta = strictXlsx ? parseScheduleFileNameYearMonthStrictXlsx(name) : parseScheduleFileNameYearMonth(name);
            if (!meta) continue;
            if (meta.year === y && meta.month === m) candidates.push(name);
        }
        if (candidates.length === 0) return '';
        candidates.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        return candidates[0];
    }

    /**
     * Buduje zestawy pomocnicze do parsowania komórek grafiku.
     *
     * Kategorie tras nie pochodzą już z zamkniętej konfiguracji kodów, tylko z katalogu
     * tras dostępnych w IndexedDB (zasilanego metadanymi folderów z Google Drive).
     *
     * @param {Map<string, { code: string, category: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }>} routeCatalog
     * @returns {{ routeCatalog: Map<string, { code: string, category: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }>, markersSet: Set<string> }}
     */
    function buildScheduleTokenSets(routeCatalog) {
        const c = getRouteScheduleConfig();
        return {
            routeCatalog: routeCatalog instanceof Map ? routeCatalog : new Map(),
            markersSet: new Set((c.dayMarkers || []).map(s => normalizeScheduleRouteCode(s)))
        };
    }

    /**
     * Klasyfikuje pojedynczy token z grafiku (trasa lub marker).
     *
     * @param {string} token
     * @param {{ routeCatalog: Map<string, { code: string, category: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }>, markersSet: Set<string> }} sets
     * @returns {{ kind: 'route'|'marker', code: string, category?: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' } | null}
     */
    function classifyScheduleToken(token, sets) {
        const tok = String(token || '').trim();
        if (!tok) return null;
        if (sets.markersSet.has(tok)) return { kind: 'marker', code: tok };
        const routeMeta = sets.routeCatalog.get(normalizeScheduleRouteCodeForLookup(tok));
        if (routeMeta?.code && routeMeta?.category) {
            return { kind: 'route', code: routeMeta.code, category: routeMeta.category };
        }
        return null;
    }

    /**
     * Parsuje zawartość komórki grafiku do listy tokenów w zachowanej kolejności (trasy + markery).
     *
     * @param {unknown} cellValue
     * @param {{ routeCatalog: Map<string, { code: string, category: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }>, markersSet: Set<string> }} tokenSets
     * @returns {{ kind: 'route'|'marker', code: string, category?: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }[]}
     */
    function parseScheduleCellToTokens(cellValue, tokenSets) {
        const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
        const cleaned = raw.trim();
        if (!cleaned) return [];

        const sets = tokenSets && typeof tokenSets === 'object' ? tokenSets : buildScheduleTokenSets(new Map());
        const parts = cleaned.split('/').map(s => String(s ?? ''));

        const out = [];
        const seen = new Set();
        for (const p of parts) {
            const normalized = normalizeScheduleRouteCode(p)
                .replace(/\s+/g, '')
                .replace(/[–—]/g, '-')
                .replace(/S-?(\d+)/i, 'S-$1')
                .replace(/N-?(\d+)/i, 'N-$1')
                .trim()
                .toUpperCase();
            if (!normalized) continue;
            const meta = classifyScheduleToken(normalized, sets);
            if (!meta) continue;
            const key = `${meta.kind}:${meta.code}:${meta.category || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(Object.freeze(meta));
        }
        return out;
    }

    function parseScheduleCellToRoutes(cellValue, tokenSets) {
        const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
        const cleaned = raw.trim();
        if (!cleaned) return [];

        const sets = tokenSets && typeof tokenSets === 'object' ? tokenSets : buildScheduleTokenSets(new Map());
        const routeCatalog = sets.routeCatalog instanceof Map ? sets.routeCatalog : new Map();
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
            const routeMeta = routeCatalog.get(normalizeScheduleRouteCodeForLookup(tok));
            if (routeMeta?.code) {
                routes.push(routeMeta.code);
                continue;
            }
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

    function cacheScheduleAssignments({ year, month, key, fileName, byIsoDate, driverRows }) {
        if (!key) return;
        scheduleCacheByMonth.set(key, { key, year, month, fileName, byIsoDate, driverRows: Array.isArray(driverRows) ? driverRows : [] });
    }

    /**
     * Ładuje katalog tras dostępnych w bazie na potrzeby parsowania grafiku.
     *
     * @returns {Promise<Map<string, { code: string, category: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }>>}
     */
    async function loadRouteCatalogForSchedule() {
        try {
            const catalog = await getRouteCatalog();
            return catalog instanceof Map ? catalog : new Map();
        } catch (err) {
            logAction('schedule', { phase: 'route_catalog_failed', message: err?.message ? String(err.message) : 'Błąd katalogu tras' }, 'WARN');
            return new Map();
        }
    }

    async function parseScheduleSpreadsheet(source, fileName) {
        const meta = parseScheduleFileNameYearMonth(fileName);
        if (!meta) throw new Error('Nieprawidłowa nazwa pliku grafiku');
        const { year, month, key } = meta;

        const workbook = await readWorkbook(source, fileName);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const matrix = sheetToMatrix(worksheet);

        const headerIdx = findScheduleHeaderRowIndex(matrix);
        if (headerIdx < 0) throw new Error('Nie znaleziono wiersza nagłówka grafiku ("IMIE I NAZWISKO")');

        const headerRow = matrix[headerIdx];
        const dayToCol = buildScheduleDayColumnMap(headerRow);
        const maxDays = daysInMonth(year, month);
        const byIsoDate = new Map();
        const driverRows = [];
        const routeCatalog = await loadRouteCatalogForSchedule();
        const tokenSets = buildScheduleTokenSets(routeCatalog);

        for (let rowIdx = headerIdx + 1; rowIdx < matrix.length; rowIdx++) {
            const row = Array.isArray(matrix[rowIdx]) ? matrix[rowIdx] : [];
            const driverName = normalizeDriverDisplayName(row[0]);
            if (!driverName) continue;

            const driverRow = { driverName, byIsoDate: new Map() };
            for (let day = 1; day <= maxDays; day++) {
                const col = dayToCol.get(day);
                if (!Number.isInteger(col)) continue;
                const tokens = parseScheduleCellToTokens(row[col], tokenSets);
                if (tokens.length === 0) continue;

                const iso = isoDateFromParts(year, month, day);
                if (!iso) continue;
                driverRow.byIsoDate.set(iso, tokens);

                if (!byIsoDate.has(iso)) byIsoDate.set(iso, new Map());
                const byRoute = byIsoDate.get(iso);
                for (const tok of tokens) {
                    if (tok?.kind !== 'route') continue;
                    const routeCode = String(tok.code || '').trim();
                    if (!routeCode) continue;
                    if (!byRoute.has(routeCode)) byRoute.set(routeCode, new Set());
                    const drivers = byRoute.get(routeCode);
                    if (drivers instanceof Set) drivers.add(driverName);
                }
            }

            driverRows.push(Object.freeze(driverRow));
        }

        cacheScheduleAssignments({ year, month, key, fileName: String(fileName || ''), byIsoDate, driverRows });
        loadedScheduleFiles.add(String(fileName || '').trim());
    }

    async function processScheduleFile(fileName) {
        const name = String(fileName || '').trim();
        if (!name) return;
        const blob = await getBlob(name);
        if (!blob) throw new Error('Nie można odczytać pliku grafiku z bazy');
        await parseScheduleSpreadsheet(blob, name);
    }

    function invalidateScheduleFile(fileName) {
        const name = String(fileName || '').trim();
        if (!name) return;
        loadedScheduleFiles.delete(name);
        const meta = parseScheduleFileNameYearMonth(name);
        if (meta?.key) scheduleCacheByMonth.delete(meta.key);
    }

    async function loadScheduleFiles({ fullReload = false, showProgress = false, onStatusText, formatFileName } = {}) {
        try {
            const all = await listFiles();
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
                    if (showProgress && typeof onStatusText === 'function') {
                        const label = typeof formatFileName === 'function' ? formatFileName(name) : name;
                        onStatusText(`Wczytuję grafik: ${label}`);
                    }
                    await processScheduleFile(name);
                } catch (err) {
                    logAction('schedule', { fileName: name, message: err?.message ? String(err.message) : 'Błąd grafiku' }, 'WARN');
                }
            }
        } catch (err) {
            logAction('schedule', { phase: 'load_failed', message: err?.message ? String(err.message) : 'Błąd' }, 'WARN');
        }
    }

    function getDriverNamesForRouteOnDate(routeCode, date) {
        const d = date instanceof Date ? date : new Date();
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const cache = getMonthCache(year, month);
        if (!cache) return null;
        const iso = isoDateFromParts(year, month, day);
        const byRoute = cache.byIsoDate.get(iso);
        if (!byRoute) return null;
        const normalized = normalizeScheduleRouteCodeForLookup(routeCode);
        const drivers = byRoute.get(normalized);
        if (!(drivers instanceof Set) || drivers.size === 0) return null;
        const names = Array.from(drivers).map(normalizeDriverDisplayName).filter(Boolean);
        names.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        return names.length > 0 ? names : null;
    }

    /**
     * Zwraca listę dni miesiąca wraz z trasami występującymi danego dnia.
     * Domyślnie zwraca wszystkie dni miesiąca (także puste), aby UI mogło stabilnie renderować kalendarz.
     * Jeśli dany miesiąc nie został wczytany do cache, zwraca `null`.
     *
     * @param {number} year
     * @param {number} month
     * @param {{ includeEmptyDays?: boolean }} [opts]
     * @returns {{ isoDate: string, day: number, routes: string[] }[] | null}
     */
    function listMonthDays(year, month, opts = {}) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;

        const includeEmptyDays = opts?.includeEmptyDays !== false;
        const monthCache = getMonthCache(y, m);
        if (!monthCache) return null;
        const derived = ensureMonthDerivedIndex(monthCache);
        const maxDays = daysInMonth(y, m);

        const out = [];
        for (let day = 1; day <= maxDays; day++) {
            const iso = isoDateFromParts(y, m, day);
            if (!iso) continue;

            const routes = derived?.dayRoutesSortedByIso?.get(iso) ?? [];
            if (!includeEmptyDays && routes.length === 0) continue;

            out.push(Object.freeze({ isoDate: iso, day, routes: Object.freeze([...routes]) }));
        }

        return Object.freeze(out);
    }

    /**
     * Zwraca unikalną, posortowaną listę tras występujących w grafiku dla danego miesiąca.
     *
     * @param {number} year
     * @param {number} month
     * @returns {string[] | null}
     */
    function listMonthRoutes(year, month) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
        const monthCache = getMonthCache(y, m);
        if (!monthCache) return null;
        const derived = ensureMonthDerivedIndex(monthCache);
        return Object.freeze([...derived.routesSorted]);
    }

    /**
     * Zwraca trasy (posortowane) dla konkretnego dnia w formacie ISO (YYYY-MM-DD).
     *
     * @param {string} isoDate
     * @returns {string[] | null}
     */
    function listDayRoutes(isoDate) {
        const parsed = parseIsoDateStrict(isoDate);
        if (!parsed) return null;
        const monthCache = getMonthCache(parsed.year, parsed.month);
        if (!monthCache) return null;
        const derived = ensureMonthDerivedIndex(monthCache);
        const routes = derived.dayRoutesSortedByIso.get(parsed.iso) ?? [];
        return Object.freeze([...routes]);
    }

    /**
     * Zwraca listę przypisań (trasa -> kierowcy) dla konkretnego dnia w formacie ISO (YYYY-MM-DD).
     *
     * @param {string} isoDate
     * @returns {{ routeCode: string, driverNames: string[] }[] | null}
     */
    function listDayAssignments(isoDate) {
        const parsed = parseIsoDateStrict(isoDate);
        if (!parsed) return null;
        const monthCache = getMonthCache(parsed.year, parsed.month);
        if (!monthCache) return null;

        const byRoute = monthCache.byIsoDate.get(parsed.iso);
        if (!(byRoute instanceof Map) || byRoute.size === 0) return Object.freeze([]);

        const routes = Array.from(byRoute.keys()).filter(Boolean);
        routes.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));

        const out = [];
        for (const routeCode of routes) {
            const drivers = byRoute.get(routeCode);
            if (!(drivers instanceof Set) || drivers.size === 0) continue;
            const names = Array.from(drivers).map(normalizeDriverDisplayName).filter(Boolean);
            names.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
            out.push(Object.freeze({ routeCode, driverNames: Object.freeze(names) }));
        }

        return Object.freeze(out);
    }

    /**
     * Zwraca kierowców przypisanych do trasy w konkretnym dniu (YYYY-MM-DD).
     * To wariant preferowany dla API (nie zależy od `Date` i stref czasowych).
     *
     * @param {string} routeCode
     * @param {string} isoDate
     * @returns {string[] | null}
     */
    function getDriverNamesForRouteOnIsoDate(routeCode, isoDate) {
        const parsed = parseIsoDateStrict(isoDate);
        if (!parsed) return null;
        const monthCache = getMonthCache(parsed.year, parsed.month);
        if (!monthCache) return null;

        const byRoute = monthCache.byIsoDate.get(parsed.iso);
        if (!(byRoute instanceof Map)) return null;

        const normalized = normalizeScheduleRouteCodeForLookup(routeCode);
        const drivers = byRoute.get(normalized);
        if (!(drivers instanceof Set) || drivers.size === 0) return null;

        const names = Array.from(drivers).map(normalizeDriverDisplayName).filter(Boolean);
        names.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        return names.length > 0 ? Object.freeze(names) : null;
    }

    /**
     * Zwraca strukturę tabeli grafiku dla danego miesiąca:
     * - dni miesiąca jako lista ISO (`YYYY-MM-DD`) wraz z flagą weekendu,
     * - wiersze kierowców w kolejności z pliku grafiku,
     * - komórki zawierające tokeny w oryginalnej kolejności (trasy i markery).
     *
     * @param {number} year
     * @param {number} month
     * @returns {{
     *   year: number,
     *   month: number,
     *   days: { isoDate: string, day: number, weekday: number, isWeekend: boolean }[],
     *   rows: { driverName: string, cells: { isoDate: string, tokens: { kind: 'route'|'marker', code: string, category?: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }[] }[] }[]
     * } | null}
     */
    function getMonthScheduleTable(year, month) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
        const monthCache = getMonthCache(y, m);
        if (!monthCache) return null;

        const maxDays = daysInMonth(y, m);
        const days = [];
        for (let day = 1; day <= maxDays; day++) {
            const iso = isoDateFromParts(y, m, day);
            if (!iso) continue;
            const weekday = new Date(y, m - 1, day).getDay();
            const isWeekend = weekday === 0 || weekday === 6;
            days.push(Object.freeze({ isoDate: iso, day, weekday, isWeekend }));
        }

        const driverRows = Array.isArray(monthCache.driverRows) ? monthCache.driverRows : [];
        const rows = [];
        for (const dr of driverRows) {
            const driverName = String(dr?.driverName ?? '').trim();
            if (!driverName) continue;
            const byIso = dr?.byIsoDate instanceof Map ? dr.byIsoDate : new Map();
            const cells = [];
            for (const d of days) {
                const list = byIso.get(d.isoDate);
                const tokens = Array.isArray(list) ? list : [];
                cells.push(Object.freeze({ isoDate: d.isoDate, tokens: Object.freeze(tokens.slice()) }));
            }
            rows.push(Object.freeze({ driverName, cells: Object.freeze(cells) }));
        }

        return Object.freeze({ year: y, month: m, days: Object.freeze(days), rows: Object.freeze(rows) });
    }

    function clearCache() {
        scheduleCacheByMonth = new Map();
        loadedScheduleFiles = new Set();
    }

    return Object.freeze({
        parseScheduleFileNameYearMonth,
        parseScheduleFileNameYearMonthStrictXlsx,
        isScheduleFileName,
        isScheduleXlsxFileName,
        selectScheduleFileNameForYearMonth,
        parseScheduleSpreadsheet,
        processScheduleFile,
        loadScheduleFiles,
        invalidateScheduleFile,
        getDriverNamesForRouteOnDate,
        listMonthDays,
        listMonthRoutes,
        listDayRoutes,
        listDayAssignments,
        getDriverNamesForRouteOnIsoDate,
        getMonthScheduleTable,
        clearCache
    });
}
