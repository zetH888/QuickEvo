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

function getDefaultRouteScheduleConfig() {
    const cfg = globalThis.QE_RouteScheduleConfig;
    if (cfg && typeof cfg === 'object') return cfg;
    return {
        monthsPl: {},
        standard: [],
        wieczorek: [],
        sobota: [],
        niedziela: [],
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
    const logAction = typeof cfg?.logAction === 'function' ? cfg.logAction : (() => { });
    const getRouteScheduleConfig = typeof cfg?.getRouteScheduleConfig === 'function' ? cfg.getRouteScheduleConfig : getDefaultRouteScheduleConfig;

    let scheduleCacheByMonth = new Map();
    let loadedScheduleFiles = new Set();

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

    function buildScheduleTokenSets() {
        const c = getRouteScheduleConfig();
        return {
            standardSet: new Set((c.standard || []).map(s => normalizeScheduleRouteCode(s))),
            wieczorekSet: new Set((c.wieczorek || []).map(s => normalizeScheduleRouteCode(s))),
            sobotaSet: new Set((c.sobota || []).map(s => normalizeScheduleRouteCode(s))),
            niedzielaSet: new Set((c.niedziela || []).map(s => normalizeScheduleRouteCode(s))),
            markersSet: new Set((c.dayMarkers || []).map(s => normalizeScheduleRouteCode(s)))
        };
    }

    function parseScheduleCellToRoutes(cellValue, tokenSets) {
        const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
        const cleaned = raw.trim();
        if (!cleaned) return [];

        const sets = tokenSets && typeof tokenSets === 'object' ? tokenSets : buildScheduleTokenSets();
        const standardSet = sets.standardSet;
        const wieczorekSet = sets.wieczorekSet;
        const sobotaSet = sets.sobotaSet;
        const niedzielaSet = sets.niedzielaSet;
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
            if (standardSet.has(tok) || wieczorekSet.has(tok) || sobotaSet.has(tok) || niedzielaSet.has(tok)) {
                routes.push(tok);
                continue;
            }
            if (/^S-\d+$/i.test(tok) && sobotaSet.has(tok.toUpperCase())) { routes.push(tok.toUpperCase()); continue; }
            if (/^N-\d+$/i.test(tok) && niedzielaSet.has(tok.toUpperCase())) { routes.push(tok.toUpperCase()); continue; }
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

    function cacheScheduleAssignments({ year, month, key, fileName, byIsoDate }) {
        if (!key) return;
        scheduleCacheByMonth.set(key, { key, year, month, fileName, byIsoDate });
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
        const tokenSets = buildScheduleTokenSets();

        for (let rowIdx = headerIdx + 1; rowIdx < matrix.length; rowIdx++) {
            const row = Array.isArray(matrix[rowIdx]) ? matrix[rowIdx] : [];
            const driverName = normalizeDriverDisplayName(row[0]);
            if (!driverName) continue;

            for (let day = 1; day <= maxDays; day++) {
                const col = dayToCol.get(day);
                if (!Number.isInteger(col)) continue;
                const routes = parseScheduleCellToRoutes(row[col], tokenSets);
                if (routes.length === 0) continue;

                const iso = isoDateFromParts(year, month, day);
                if (!iso) continue;
                if (!byIsoDate.has(iso)) byIsoDate.set(iso, new Map());
                const byRoute = byIsoDate.get(iso);
                for (const routeCode of routes) {
                    if (!routeCode) continue;
                    if (!byRoute.has(routeCode)) byRoute.set(routeCode, new Set());
                    const drivers = byRoute.get(routeCode);
                    if (drivers instanceof Set) drivers.add(driverName);
                }
            }
        }

        cacheScheduleAssignments({ year, month, key, fileName: String(fileName || ''), byIsoDate });
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
        const key = scheduleMonthKey(year, month);
        if (!key) return null;
        const cache = scheduleCacheByMonth.get(key);
        if (!cache || !cache.byIsoDate) return null;
        const iso = isoDateFromParts(year, month, day);
        const byRoute = cache.byIsoDate.get(iso);
        if (!byRoute) return null;
        const normalized = normalizeScheduleRouteCode(routeCode).replace(/\s+/g, '');
        const drivers = byRoute.get(normalized);
        if (!(drivers instanceof Set) || drivers.size === 0) return null;
        const names = Array.from(drivers).map(normalizeDriverDisplayName).filter(Boolean);
        names.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        return names.length > 0 ? names : null;
    }

    function clearCache() {
        scheduleCacheByMonth = new Map();
        loadedScheduleFiles = new Set();
    }

    return Object.freeze({
        parseScheduleFileNameYearMonth,
        isScheduleFileName,
        parseScheduleSpreadsheet,
        processScheduleFile,
        loadScheduleFiles,
        invalidateScheduleFile,
        getDriverNamesForRouteOnDate,
        clearCache
    });
}

