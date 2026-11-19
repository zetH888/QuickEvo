import { normalizeDriverDisplayName } from '../core/utils.js';

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

function parseIsoDateStrict(isoDate) {
    const raw = String(isoDate ?? '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;

    const iso = isoDateFromParts(year, month, day);
    const key = scheduleMonthKey(year, month);
    return iso && key ? { year, month, day, key, iso } : null;
}

function getDefaultRouteScheduleConfig() {
    return globalThis.QE_RouteScheduleConfig && typeof globalThis.QE_RouteScheduleConfig === 'object'
        ? globalThis.QE_RouteScheduleConfig
        : {
            monthsPl: {},
            standard: [],
            wieczorek: [],
            sobota: [],
            niedziela: [],
            dayMarkers: [],
            normalizeScheduleToken: (token) => String(token ?? '').trim().toUpperCase()
        };
}

export function createScheduleService(cfg = {}) {
    const fuzzyNormalizeText = typeof cfg?.fuzzyNormalizeText === 'function'
        ? cfg.fuzzyNormalizeText
        : ((text) => String(text ?? '').toLowerCase());
    const readWorkbook = typeof cfg?.readWorkbook === 'function'
        ? cfg.readWorkbook
        : (async () => { throw new Error('Brak readWorkbook'); });
    const sheetToMatrix = typeof cfg?.sheetToMatrix === 'function'
        ? cfg.sheetToMatrix
        : (() => { throw new Error('Brak sheetToMatrix'); });
    const getBlob = typeof cfg?.getBlob === 'function' ? cfg.getBlob : (async () => null);
    const listFiles = typeof cfg?.listFiles === 'function' ? cfg.listFiles : (async () => []);
    const getRouteCatalog = typeof cfg?.getRouteCatalog === 'function' ? cfg.getRouteCatalog : (async () => new Map());
    const logAction = typeof cfg?.logAction === 'function' ? cfg.logAction : (() => {});
    const getRouteScheduleConfig = typeof cfg?.getRouteScheduleConfig === 'function'
        ? cfg.getRouteScheduleConfig
        : getDefaultRouteScheduleConfig;

    let scheduleCacheByMonth = new Map();
    let loadedScheduleFiles = new Set();

    function normalizeScheduleRouteCode(value) {
        const config = getRouteScheduleConfig();
        const token = config.normalizeScheduleToken
            ? config.normalizeScheduleToken(value)
            : String(value ?? '').trim().toUpperCase();
        return String(token || '').trim().toUpperCase();
    }

    function normalizeScheduleRouteCodeForLookup(value) {
        return normalizeScheduleRouteCode(value)
            .replace(/\s+/g, '')
            .replace(/[–—]/g, '-')
            .trim()
            .toUpperCase();
    }

    function getMonthCache(year, month) {
        const key = scheduleMonthKey(year, month);
        if (!key) return null;
        const cache = scheduleCacheByMonth.get(key);
        return cache && cache.byIsoDate instanceof Map ? cache : null;
    }

    function ensureMonthDerivedIndex(monthCache) {
        if (!monthCache || !(monthCache.byIsoDate instanceof Map)) {
            return { routesSorted: [], dayRoutesSortedByIso: new Map() };
        }
        if (monthCache.derived?.routesSorted && monthCache.derived?.dayRoutesSortedByIso) {
            return monthCache.derived;
        }

        const routes = new Set();
        const dayRoutesSortedByIso = new Map();

        for (const [iso, byRoute] of monthCache.byIsoDate.entries()) {
            if (!(byRoute instanceof Map)) continue;
            const routeList = Array.from(byRoute.keys()).filter(Boolean);
            routeList.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
            dayRoutesSortedByIso.set(iso, routeList);
            for (const route of routeList) routes.add(route);
        }

        const routesSorted = Array.from(routes);
        routesSorted.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        monthCache.derived = { routesSorted, dayRoutesSortedByIso };
        return monthCache.derived;
    }

    function parseScheduleFileNameYearMonth(fileName) {
        const name = String(fileName || '').trim();
        if (!name) return null;

        const extMatch = name.toLowerCase().match(/\.(xlsx|xls|csv)$/);
        if (!extMatch) return null;

        const base = name.replace(/\.(xlsx|xls|csv)$/i, '').trim();
        const parts = base.split(/\s+/g).filter(Boolean);
        if (parts.length < 3) return null;

        const year = Number(parts[parts.length - 1]);
        const monthRaw = parts[parts.length - 2];
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;

        const config = getRouteScheduleConfig();
        const monthKey = String(fuzzyNormalizeText(monthRaw) || '').toUpperCase();
        const month = Number(config.monthsPl?.[monthKey]);
        if (!Number.isInteger(month) || month < 1 || month > 12) return null;

        const displayLabel = `${String(monthRaw || '').toUpperCase()} ${String(parts[parts.length - 1] || '').trim()}`;
        return { year, month, key: scheduleMonthKey(year, month), displayLabel, fileName: name };
    }

    function parseScheduleFileNameYearMonthStrictXlsx(fileName) {
        const name = String(fileName || '').trim();
        if (!name || !/\.xlsx$/i.test(name)) return null;
        return parseScheduleFileNameYearMonth(name);
    }

    function isScheduleFileName(fileName) {
        return Boolean(parseScheduleFileNameYearMonth(fileName));
    }

    function isScheduleXlsxFileName(fileName) {
        return Boolean(parseScheduleFileNameYearMonthStrictXlsx(fileName));
    }

    function selectScheduleFileNameForYearMonth(fileNames, { year, month, strictXlsx = false } = {}) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';

        const candidates = [];
        const list = Array.isArray(fileNames) ? fileNames : [];
        for (const fileName of list) {
            const name = String(fileName ?? '').trim();
            if (!name) continue;
            const meta = strictXlsx
                ? parseScheduleFileNameYearMonthStrictXlsx(name)
                : parseScheduleFileNameYearMonth(name);
            if (meta?.year === y && meta?.month === m) candidates.push(name);
        }

        candidates.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        return candidates[0] || '';
    }

    function buildScheduleTokenSets(routeCatalog) {
        const config = getRouteScheduleConfig();
        const markerDisplayCodes = new Map();
        const markersSet = new Set();

        for (const marker of (config.dayMarkers || [])) {
            const normalizedMarker = normalizeScheduleRouteCode(marker);
            if (!normalizedMarker) continue;
            markersSet.add(normalizedMarker);
            markerDisplayCodes.set(normalizedMarker, String(marker ?? '').trim() || normalizedMarker);
        }

        const fallbackRouteCategories = new Map();
        const registerFallbackRoutes = (codes, category) => {
            for (const code of (Array.isArray(codes) ? codes : [])) {
                const normalizedCode = normalizeScheduleRouteCodeForLookup(code);
                if (normalizedCode && !fallbackRouteCategories.has(normalizedCode)) {
                    fallbackRouteCategories.set(normalizedCode, category);
                }
            }
        };

        registerFallbackRoutes(config.standard, 'STANDARD');
        registerFallbackRoutes(config.wieczorek, 'WIECZOREK');
        registerFallbackRoutes(config.sobota, 'SOBOTA');
        registerFallbackRoutes(config.niedziela, 'NIEDZIELA');

        return {
            routeCatalog: routeCatalog instanceof Map ? routeCatalog : new Map(),
            markersSet,
            markerDisplayCodes,
            fallbackRouteCategories
        };
    }

    function inferFallbackRouteCategory(token, sets) {
        const normalized = normalizeScheduleRouteCodeForLookup(token);
        const fallback = sets?.fallbackRouteCategories instanceof Map
            ? sets.fallbackRouteCategories
            : new Map();
        const fromConfig = fallback.get(normalized);
        if (fromConfig) return fromConfig;
        if (/^S-\d+$/.test(normalized)) return 'SOBOTA';
        if (/^N-\d+$/.test(normalized)) return 'NIEDZIELA';
        return 'STANDARD';
    }

    function classifyScheduleToken(token, sets) {
        const value = String(token || '').trim();
        if (!value) return null;

        if (sets.markersSet.has(value)) {
            return {
                kind: 'marker',
                code: sets.markerDisplayCodes?.get(value) || value
            };
        }

        const routeMeta = sets.routeCatalog.get(normalizeScheduleRouteCodeForLookup(value));
        if (routeMeta?.code && routeMeta?.category) {
            return { kind: 'route', code: routeMeta.code, category: routeMeta.category };
        }

        return {
            kind: 'route',
            code: value,
            category: inferFallbackRouteCategory(value, sets)
        };
    }

    function extractScheduleCellCandidates(cellValue) {
        const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
        const cleaned = normalizeScheduleRouteCode(raw)
            .replace(/[–—]/g, '-')
            .replace(/\s*-\s*/g, '-')
            .replace(/\s*\/\s*/g, '/')
            .trim();
        if (!cleaned) return [];

        // Slash is the route separator. It is never used inside a route code.
        // Ł1 remains one alphanumeric candidate; Ł/1 produces Ł and 1.
        const segments = cleaned.split('/').filter((segment) => String(segment).trim());
        const candidates = [];

        for (const segment of segments) {
            const compact = String(segment).trim()
                .replace(/\s+/g, ' ')
                .replace(/\s*-\s*/g, '-');

            const matches = compact.match(
                /\*[A-ZĄĆĘŁŃÓŚŹŻ]+|[A-ZĄĆĘŁŃÓŚŹŻ]+\d+|[A-ZĄĆĘŁŃÓŚŹŻ]+-\d+|[A-ZĄĆĘŁŃÓŚŹŻ]+|\d+/gu
            ) || [];

            for (const match of matches) {
                const token = normalizeScheduleRouteCode(match);
                if (token) candidates.push(token);
            }
        }

        return candidates;
    }

    function parseScheduleCellToTokens(cellValue, tokenSets) {
        const sets = tokenSets && typeof tokenSets === 'object'
            ? tokenSets
            : buildScheduleTokenSets(new Map());
        const parts = extractScheduleCellCandidates(cellValue);

        const out = [];
        const seen = new Set();

        for (const part of parts) {
            const normalized = normalizeScheduleRouteCode(part)
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
        return Array.from(new Set(
            parseScheduleCellToTokens(cellValue, tokenSets)
                .filter((token) => token?.kind === 'route')
                .map((token) => String(token?.code ?? '').trim())
                .filter(Boolean)
        ));
    }

    function findScheduleHeaderAndDriverCol(matrix) {
        const rows = Array.isArray(matrix) ? matrix : [];
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
            for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
                const normalized = fuzzyNormalizeText(String(row[columnIndex] ?? ''));
                if (normalized.includes('imie') && (normalized.includes('nazw') || normalized.includes('nazwisko'))) {
                    return { headerRowIdx: rowIndex, driverColIdx: columnIndex };
                }
            }
        }
        return null;
    }

    function buildScheduleDayColumnMap(headerRow, driverColIdx = 0) {
        const row = Array.isArray(headerRow) ? headerRow : [];
        const map = new Map();
        const startColumn = Math.max(1, Number(driverColIdx || 0) + 1);

        for (let column = startColumn; column < row.length; column++) {
            const day = Number(String(row[column] ?? '').trim());
            if (Number.isInteger(day) && day >= 1 && day <= 31 && !map.has(day)) {
                map.set(day, column);
            }
        }
        return map;
    }

    async function loadRouteCatalogForSchedule() {
        try {
            const catalog = await getRouteCatalog();
            return catalog instanceof Map ? catalog : new Map();
        } catch (error) {
            logAction('schedule', {
                phase: 'route_catalog_failed',
                message: error?.message ? String(error.message) : 'Błąd katalogu tras'
            }, 'WARN');
            return new Map();
        }
    }

    async function parseScheduleSpreadsheet(source, fileName) {
        const meta = parseScheduleFileNameYearMonth(fileName);
        if (!meta) throw new Error('Nieprawidłowa nazwa pliku grafiku');

        const workbook = await readWorkbook(source, fileName);
        const firstSheetName = workbook.SheetNames[0];
        const matrix = sheetToMatrix(workbook.Sheets[firstSheetName]);
        const headerInfo = findScheduleHeaderAndDriverCol(matrix);
        if (!headerInfo) throw new Error('Nie znaleziono wiersza nagłówka grafiku ("IMIE I NAZWISKO")');

        const dayToColumn = buildScheduleDayColumnMap(
            matrix[headerInfo.headerRowIdx],
            headerInfo.driverColIdx
        );
        const routeCatalog = await loadRouteCatalogForSchedule();
        const tokenSets = buildScheduleTokenSets(routeCatalog);
        const byIsoDate = new Map();
        const driverRows = [];
        const maxDays = daysInMonth(meta.year, meta.month);

        for (let rowIndex = headerInfo.headerRowIdx + 1; rowIndex < matrix.length; rowIndex++) {
            const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
            const driverName = normalizeDriverDisplayName(row[headerInfo.driverColIdx]);
            if (!driverName) continue;

            const driverRow = { driverName, byIsoDate: new Map() };

            for (let day = 1; day <= maxDays; day++) {
                const column = dayToColumn.get(day);
                if (!Number.isInteger(column)) continue;

                const tokens = parseScheduleCellToTokens(row[column], tokenSets);
                if (tokens.length === 0) continue;

                const iso = isoDateFromParts(meta.year, meta.month, day);
                if (!iso) continue;
                driverRow.byIsoDate.set(iso, tokens);

                if (!byIsoDate.has(iso)) byIsoDate.set(iso, new Map());
                const byRoute = byIsoDate.get(iso);

                for (const token of tokens) {
                    if (token?.kind !== 'route') continue;
                    const routeCode = String(token.code || '').trim();
                    if (!routeCode) continue;
                    if (!byRoute.has(routeCode)) byRoute.set(routeCode, new Set());
                    byRoute.get(routeCode).add(driverName);
                }
            }

            driverRows.push(Object.freeze(driverRow));
        }

        scheduleCacheByMonth.set(meta.key, {
            key: meta.key,
            year: meta.year,
            month: meta.month,
            fileName: String(fileName || ''),
            byIsoDate,
            driverRows
        });
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
        const all = await listFiles();
        const scheduleFiles = Array.isArray(all)
            ? all.map((record) => String(record?.name ?? '')).filter((name) => isScheduleFileName(name))
            : [];

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
            } catch (error) {
                logAction('schedule', {
                    fileName: name,
                    message: error?.message ? String(error.message) : 'Błąd grafiku'
                }, 'WARN');
            }
        }
    }

    function getDriverNamesForRouteOnDate(routeCode, date) {
        const targetDate = date instanceof Date ? date : new Date();
        const cache = getMonthCache(targetDate.getFullYear(), targetDate.getMonth() + 1);
        if (!cache) return null;

        const iso = isoDateFromParts(targetDate.getFullYear(), targetDate.getMonth() + 1, targetDate.getDate());
        const byRoute = cache.byIsoDate.get(iso);
        if (!(byRoute instanceof Map)) return null;

        const normalized = normalizeScheduleRouteCodeForLookup(routeCode);
        const drivers = byRoute.get(normalized);
        if (!(drivers instanceof Set) || drivers.size === 0) return null;

        const names = Array.from(drivers).map(normalizeDriverDisplayName).filter(Boolean);
        names.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        return names.length > 0 ? names : null;
    }

    function getDriverNamesForRouteOnIsoDate(routeCode, isoDate) {
        const parsed = parseIsoDateStrict(isoDate);
        if (!parsed) return null;
        const cache = getMonthCache(parsed.year, parsed.month);
        if (!cache) return null;

        const byRoute = cache.byIsoDate.get(parsed.iso);
        if (!(byRoute instanceof Map)) return null;

        const normalized = normalizeScheduleRouteCodeForLookup(routeCode);
        const drivers = byRoute.get(normalized);
        if (!(drivers instanceof Set) || drivers.size === 0) return null;

        const names = Array.from(drivers).map(normalizeDriverDisplayName).filter(Boolean);
        names.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        return names.length > 0 ? Object.freeze(names) : null;
    }

    function listMonthRoutes(year, month) {
        const cache = getMonthCache(year, month);
        if (!cache) return null;
        return Object.freeze([...ensureMonthDerivedIndex(cache).routesSorted]);
    }

    function listDayRoutes(isoDate) {
        const parsed = parseIsoDateStrict(isoDate);
        if (!parsed) return null;
        const cache = getMonthCache(parsed.year, parsed.month);
        if (!cache) return null;
        const routes = ensureMonthDerivedIndex(cache).dayRoutesSortedByIso.get(parsed.iso) || [];
        return Object.freeze([...routes]);
    }

    function listMonthDays(year, month, opts = {}) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;

        const cache = getMonthCache(y, m);
        if (!cache) return null;
        const includeEmptyDays = opts?.includeEmptyDays !== false;
        const derived = ensureMonthDerivedIndex(cache);
        const out = [];

        for (let day = 1; day <= daysInMonth(y, m); day++) {
            const iso = isoDateFromParts(y, m, day);
            if (!iso) continue;
            const routes = derived.dayRoutesSortedByIso.get(iso) || [];
            if (!includeEmptyDays && routes.length === 0) continue;
            out.push(Object.freeze({ isoDate: iso, day, routes: Object.freeze([...routes]) }));
        }
        return Object.freeze(out);
    }

    function listDayAssignments(isoDate) {
        const parsed = parseIsoDateStrict(isoDate);
        if (!parsed) return null;
        const cache = getMonthCache(parsed.year, parsed.month);
        if (!cache) return null;

        const byRoute = cache.byIsoDate.get(parsed.iso);
        if (!(byRoute instanceof Map) || byRoute.size === 0) return Object.freeze([]);

        const out = [];
        const routes = Array.from(byRoute.keys()).filter(Boolean);
        routes.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));

        for (const routeCode of routes) {
            const drivers = byRoute.get(routeCode);
            if (!(drivers instanceof Set) || drivers.size === 0) continue;
            const names = Array.from(drivers).map(normalizeDriverDisplayName).filter(Boolean);
            names.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
            out.push(Object.freeze({ routeCode, driverNames: Object.freeze(names) }));
        }
        return Object.freeze(out);
    }

    function getMonthScheduleTable(year, month) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;

        const cache = getMonthCache(y, m);
        if (!cache) return null;

        const days = [];
        for (let day = 1; day <= daysInMonth(y, m); day++) {
            const iso = isoDateFromParts(y, m, day);
            if (!iso) continue;
            const weekday = new Date(y, m - 1, day).getDay();
            days.push(Object.freeze({
                isoDate: iso,
                day,
                weekday,
                isWeekend: weekday === 0 || weekday === 6
            }));
        }

        const rows = [];
        for (const driverRow of (Array.isArray(cache.driverRows) ? cache.driverRows : [])) {
            const driverName = String(driverRow?.driverName ?? '').trim();
            if (!driverName) continue;

            const byIso = driverRow?.byIsoDate instanceof Map ? driverRow.byIsoDate : new Map();
            const cells = days.map((day) => Object.freeze({
                isoDate: day.isoDate,
                tokens: Object.freeze((Array.isArray(byIso.get(day.isoDate))
                    ? byIso.get(day.isoDate)
                    : []).slice())
            }));
            rows.push(Object.freeze({ driverName, cells: Object.freeze(cells) }));
        }

        return Object.freeze({
            year: y,
            month: m,
            fileName: String(cache.fileName || ''),
            days: Object.freeze(days),
            rows: Object.freeze(rows)
        });
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
        parseScheduleCellToRoutes,
        parseScheduleCellToTokens,
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
