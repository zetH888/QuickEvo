/**
 * @module schedule-controller
 *
 * @description
 * Logiczny komponent `ScheduleGrid` odpowiedzialny za render grafiku kierowców
 * w formie tabeli inspirowanej arkuszem Excel, z nowoczesnym toolbar'em,
 * filtrowaniem, sticky headerem i sticky kolumną kierowców.
 */

/**
 * Parsuje `YYYY-MM` do części liczbowych.
 *
 * @param {unknown} ym
 * @returns {{ year: number, month: number, key: string } | null}
 */
function parseYearMonth(ym) {
    const raw = String(ym ?? '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

/**
 * Buduje datę ISO `YYYY-MM-DD`.
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
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Normalizuje wartość tekstową do porównań filtrów.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeFilterValue(value) {
    return String(value ?? '')
        .trim()
        .toLocaleLowerCase('pl-PL')
        .replace(/\s+/g, ' ');
}

/**
 * Sprawdza, czy string ma format ISO `YYYY-MM-DD`.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function coerceIsoDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    return raw;
}

/**
 * Tworzy stabilny identyfikator kierowcy na potrzeby zaznaczenia wiersza.
 *
 * @param {unknown} driverName
 * @returns {string}
 */
function buildDriverId(driverName) {
    return normalizeFilterValue(driverName).replace(/\s+/g, '-');
}

/**
 * Sprawdza, czy aktywny jest kompaktowy układ mobilny grafiku.
 *
 * @returns {boolean}
 */
function isCompactScheduleLayout() {
    try {
        return Boolean(globalThis.matchMedia?.('(max-width: 768px)')?.matches);
    } catch {
        return false;
    }
}

/**
 * Skraca nazwę kierowcy do formatu mobilnego `Nazwisko I.`.
 *
 * @param {unknown} driverName
 * @returns {string}
 */
function formatCompactDriverName(driverName) {
    const safeName = String(driverName ?? '').replace(/\s+/g, ' ').trim();
    if (!safeName) return '';

    const tokens = safeName.split(' ').filter(Boolean);
    if (tokens.length <= 1) return safeName;

    const surname = String(tokens[0] || '').trim();
    const firstGiven = String(tokens[1] || '').trim();
    if (!surname || !firstGiven) return safeName;
    return `${surname} ${firstGiven.charAt(0).toLocaleUpperCase('pl-PL')}.`;
}

/**
 * Formatuje label dnia do headera i statusu toolbaru.
 *
 * @param {Intl.DateTimeFormat} dtfWeekday
 * @param {string} isoDate
 * @returns {{ weekday: string, date: string, fullLabel: string }}
 */
function formatDayHeaderParts(dtfWeekday, isoDate) {
    const iso = coerceIsoDate(isoDate);
    if (!iso) return { weekday: '', date: '', fullLabel: 'Wybrano: brak' };
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const day = Number(iso.slice(8, 10));
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return { weekday: '', date: '', fullLabel: 'Wybrano: brak' };
    }
    const dateObj = new Date(year, month - 1, day);
    const weekday = dtfWeekday.format(dateObj);
    const date = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
    return {
        weekday,
        date,
        fullLabel: `Wybrano: ${weekday} ${date}`
    };
}

/**
 * Sprawdza, czy przekazane `ym` odpowiada dzisiejszemu miesiącowi.
 *
 * @param {string} ym
 * @returns {boolean}
 */
function isCurrentMonthKey(ym) {
    const meta = parseYearMonth(ym);
    if (!meta) return false;
    const now = new Date();
    return meta.year === now.getFullYear() && meta.month === (now.getMonth() + 1);
}

/**
 * Tworzy logiczny komponent `ScheduleGrid`.
 *
 * @param {Object} cfg
 * @param {HTMLElement|null} cfg.scheduleView
 * @param {HTMLElement|null} cfg.tableContainer
 * @param {HTMLTableRowElement|null} cfg.tableHeaderRow
 * @param {HTMLTableSectionElement|null} cfg.tableBody
 * @param {HTMLSelectElement|null} cfg.monthSelect
 * @param {HTMLButtonElement|null} cfg.monthTriggerBtn
 * @param {HTMLElement|null} cfg.monthTriggerLabelEl
 * @param {HTMLButtonElement|null} cfg.monthToggleBtn
 * @param {HTMLElement|null} cfg.monthOptionsEl
 * @param {HTMLInputElement|null} cfg.driverFilterInput
 * @param {HTMLButtonElement|null} cfg.driverFilterToggleBtn
 * @param {HTMLElement|null} cfg.driverFilterOptionsEl
 * @param {HTMLInputElement|null} cfg.routeFilterInput
 * @param {HTMLButtonElement|null} cfg.routeFilterToggleBtn
 * @param {HTMLElement|null} cfg.routeFilterOptionsEl
 * @param {HTMLElement|null} cfg.selectedDayEl
 * @param {HTMLElement|null} cfg.subtitleEl
 * @param {HTMLButtonElement|null} cfg.prevMonthBtn
 * @param {HTMLButtonElement|null} cfg.nextMonthBtn
 * @param {HTMLButtonElement|null} cfg.todayBtn
 * @param {HTMLButtonElement|null} cfg.fullscreenBtn
 * @param {HTMLButtonElement|null} cfg.clearFiltersBtn
 * @param {(year: number, month: number) => ({
 *   year: number,
 *   month: number,
 *   days: { isoDate: string, day: number, weekday: number, isWeekend: boolean }[],
 *   rows: { driverName: string, cells: { isoDate: string, tokens: { kind: 'route'|'marker', code: string, category?: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }[] }[] }[]
 * } | null)} cfg.getMonthScheduleTable
 * @param {Record<string, string>} cfg.markerMeanings
 * @param {(routeCode: string) => boolean} cfg.isRouteAvailable
 * @param {(opts: { routeCode: string, isoDate: string }) => void} cfg.onOpenRoute
 */
function createScheduleGrid(cfg = {}) {
    const scheduleView = cfg?.scheduleView || null;
    const tableContainer = cfg?.tableContainer || null;
    const tableHeaderRow = cfg?.tableHeaderRow || null;
    const tableBody = cfg?.tableBody || null;
    const monthSelect = cfg?.monthSelect || null;
    const monthTriggerBtn = cfg?.monthTriggerBtn || null;
    const monthTriggerLabelEl = cfg?.monthTriggerLabelEl || null;
    const monthToggleBtn = cfg?.monthToggleBtn || null;
    const monthOptionsEl = cfg?.monthOptionsEl || null;
    const driverFilterInput = cfg?.driverFilterInput || null;
    const driverFilterToggleBtn = cfg?.driverFilterToggleBtn || null;
    const driverFilterOptionsEl = cfg?.driverFilterOptionsEl || null;
    const routeFilterInput = cfg?.routeFilterInput || null;
    const routeFilterToggleBtn = cfg?.routeFilterToggleBtn || null;
    const routeFilterOptionsEl = cfg?.routeFilterOptionsEl || null;
    const selectedDayEl = cfg?.selectedDayEl || null;
    const subtitleEl = cfg?.subtitleEl || null;
    const prevDayBtn = cfg?.prevMonthBtn || null;
    const nextDayBtn = cfg?.nextMonthBtn || null;
    const todayBtn = cfg?.todayBtn || null;
    const fullscreenBtn = cfg?.fullscreenBtn || null;
    const clearFiltersBtn = cfg?.clearFiltersBtn || null;

    const getMonthScheduleTable = typeof cfg?.getMonthScheduleTable === 'function' ? cfg.getMonthScheduleTable : (() => null);
    const markerMeanings = cfg?.markerMeanings && typeof cfg.markerMeanings === 'object' ? cfg.markerMeanings : {};
    const isRouteAvailable = typeof cfg?.isRouteAvailable === 'function' ? cfg.isRouteAvailable : (() => false);
    const onOpenRoute = typeof cfg?.onOpenRoute === 'function' ? cfg.onOpenRoute : (() => { });

    const dtfWeekday = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' });
    let lastCompactLayout = isCompactScheduleLayout();

    const state = {
        current: { year: 0, month: 0, key: '' },
        availableMonths: [],
        selectedDayIndex: -1,
        selectedIsoDate: null,
        selectedDriverId: '',
        selectedDriverName: '',
        selectedScheduleFile: '',
        driverFilter: '',
        routeFilter: '',
        routeFilterMode: 'contains',
        openDropdown: '',
        monthTable: null,
        viewModel: null
    };

    /**
     * Czyści zawartość tabeli.
     */
    function clearTable() {
        tableHeaderRow?.replaceChildren?.();
        tableBody?.replaceChildren?.();
    }

    /**
     * Sprawdza, czy widok grafiku jest aktualnie widoczny.
     *
     * @returns {boolean}
     */
    function isVisible() {
        return Boolean(scheduleView && !scheduleView.classList.contains('view-hidden'));
    }

    /**
     * Zwraca aktualny element będący w trybie pełnego ekranu.
     *
     * @returns {Element|null}
     */
    function getActiveFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    /**
     * Sprawdza, czy bieżąca przeglądarka obsługuje fullscreen dla widoku grafiku.
     *
     * @returns {boolean}
     */
    function isFullscreenSupported() {
        return Boolean(
            scheduleView
            && (
                typeof scheduleView.requestFullscreen === 'function'
                || typeof scheduleView.webkitRequestFullscreen === 'function'
            )
            && (
                typeof document.exitFullscreen === 'function'
                || typeof document.webkitExitFullscreen === 'function'
            )
        );
    }

    /**
     * Sprawdza, czy to właśnie widok grafiku jest w trybie pełnego ekranu.
     *
     * @returns {boolean}
     */
    function isScheduleFullscreenActive() {
        return getActiveFullscreenElement() === scheduleView;
    }

    /**
     * Synchronizuje label i atrybuty przycisku pełnego ekranu.
     */
    function syncFullscreenButtonState() {
        if (!fullscreenBtn) return;
        const supported = isFullscreenSupported();
        const active = supported && isScheduleFullscreenActive();
        fullscreenBtn.disabled = !supported;
        fullscreenBtn.classList.toggle('is-active', active);
        fullscreenBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        fullscreenBtn.setAttribute(
            'aria-label',
            active ? 'Wyłącz pełny ekran grafiku' : 'Włącz pełny ekran grafiku'
        );
        fullscreenBtn.title = active ? 'Wyłącz pełny ekran grafiku' : 'Włącz pełny ekran grafiku';
    }

    /**
     * Kończy tryb pełnego ekranu dla widoku grafiku, jeśli jest aktywny.
     *
     * @returns {Promise<void>}
     */
    async function exitScheduleFullscreen() {
        if (!isScheduleFullscreenActive()) {
            syncFullscreenButtonState();
            return;
        }

        try {
            if (typeof document.exitFullscreen === 'function') {
                await document.exitFullscreen();
            } else if (typeof document.webkitExitFullscreen === 'function') {
                document.webkitExitFullscreen();
            }
        } catch {
            syncFullscreenButtonState();
        }
    }

    /**
     * Przełącza pełny ekran dla całego widoku grafiku.
     *
     * @returns {Promise<void>}
     */
    async function toggleScheduleFullscreen() {
        if (!scheduleView || !isFullscreenSupported()) return;
        try {
            if (isScheduleFullscreenActive()) {
                await exitScheduleFullscreen();
            } else if (typeof scheduleView.requestFullscreen === 'function') {
                await scheduleView.requestFullscreen();
            } else if (typeof scheduleView.webkitRequestFullscreen === 'function') {
                scheduleView.webkitRequestFullscreen();
            }
        } catch {
            syncFullscreenButtonState();
        }
    }

    /**
     * Synchronizuje wartości pól filtrów z aktualnym stanem.
     */
    function syncFilterInputs() {
        if (driverFilterInput && driverFilterInput.value !== state.driverFilter) {
            driverFilterInput.value = state.driverFilter;
        }
        if (routeFilterInput && routeFilterInput.value !== state.routeFilter) {
            routeFilterInput.value = state.routeFilter;
        }
    }

    /**
     * Zwraca wspolne elementy wybranego dropdownu toolbaru.
     *
     * @param {'month'|'driver'|'route'} type
     * @returns {{ triggerEl: HTMLElement|null, toggleBtn: HTMLButtonElement|null, menuEl: HTMLElement|null, containerEl: HTMLElement|null }}
     */
    function getDropdownParts(type) {
        if (type === 'month') {
            return {
                triggerEl: monthTriggerBtn,
                toggleBtn: monthToggleBtn,
                menuEl: monthOptionsEl,
                containerEl: getFilterDropdownContainer(monthTriggerBtn)
            };
        }
        if (type === 'driver') {
            return {
                triggerEl: driverFilterInput,
                toggleBtn: driverFilterToggleBtn,
                menuEl: driverFilterOptionsEl,
                containerEl: getFilterDropdownContainer(driverFilterInput)
            };
        }
        return {
            triggerEl: routeFilterInput,
            toggleBtn: routeFilterToggleBtn,
            menuEl: routeFilterOptionsEl,
            containerEl: getFilterDropdownContainer(routeFilterInput)
        };
    }

    /**
     * Zwraca kontener dropdownu skojarzony z polem filtra.
     *
     * @param {HTMLElement|null} inputEl
     * @returns {HTMLElement|null}
     */
    function getFilterDropdownContainer(inputEl) {
        return inputEl instanceof HTMLElement ? inputEl.closest('.schedule-filter-dropdown') : null;
    }

    /**
     * Ustawia stan otwarcia dla wybranego dropdownu filtra.
     *
     * @param {'month'|'driver'|'route'} type
     * @param {boolean} isOpen
     */
    function setFilterDropdownExpandedState(type, isOpen) {
        const safeIsOpen = Boolean(isOpen);
        const { triggerEl, toggleBtn, menuEl, containerEl } = getDropdownParts(type);
        if (triggerEl) triggerEl.setAttribute('aria-expanded', String(safeIsOpen));
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(safeIsOpen));
        if (menuEl instanceof HTMLElement) {
            menuEl.hidden = !safeIsOpen;
            menuEl.classList.toggle('is-open', safeIsOpen);
        }
        if (containerEl) {
            containerEl.classList.toggle('is-open', safeIsOpen);
        }
    }

    /**
     * Zamyka wszystkie dropdowny filtrów.
     */
    function closeFilterDropdowns() {
        state.openDropdown = '';
        setFilterDropdownExpandedState('month', false);
        setFilterDropdownExpandedState('driver', false);
        setFilterDropdownExpandedState('route', false);
    }

    /**
     * Otwiera wybrany dropdown i zamyka pozostałe.
     *
     * @param {'month'|'driver'|'route'} type
     * @param {boolean} [forceOpen]
     */
    function toggleFilterDropdown(type, forceOpen) {
        const nextValue = typeof forceOpen === 'boolean'
            ? (forceOpen ? type : '')
            : (state.openDropdown === type ? '' : type);
        state.openDropdown = nextValue;
        setFilterDropdownExpandedState('month', nextValue === 'month');
        setFilterDropdownExpandedState('driver', nextValue === 'driver');
        setFilterDropdownExpandedState('route', nextValue === 'route');
    }

    /**
     * Zwraca etykietę sekcji dla kategorii trasy lub kodu specjalnego.
     *
     * @param {'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA'|'MARKER'} category
     * @returns {string}
     */
    function getFilterSectionLabel(category) {
        switch (category) {
            case 'WIECZOREK':
                return 'Wieczorki';
            case 'SOBOTA':
                return 'Soboty';
            case 'NIEDZIELA':
                return 'Niedziele';
            case 'MARKER':
                return 'Kody specjalne';
            case 'STANDARD':
            default:
                return 'Standard';
        }
    }

    /**
     * Porządkuje kody tras/symboli w menu w sposób przyjazny dla operatora.
     *
     * @param {string} left
     * @param {string} right
     * @returns {number}
     */
    function compareFilterCodes(left, right) {
        return String(left || '').localeCompare(String(right || ''), 'pl', {
            numeric: true,
            sensitivity: 'base'
        });
    }

    /**
     * Sprawdza, czy kod z komórki spełnia aktywny warunek filtra trasy.
     *
     * Tryb:
     * - `contains` jest używany podczas ręcznego wpisywania tekstu,
     * - `exact` jest używany po wyborze gotowego badge z dropdownu.
     *
     * @param {string} code
     * @param {string} routeNeedle
     * @returns {boolean}
     */
    function matchesRouteFilter(code, routeNeedle) {
        const normalizedCode = normalizeFilterValue(code);
        if (!routeNeedle) return true;
        if (state.routeFilterMode === 'exact') return normalizedCode === routeNeedle;
        return normalizedCode.includes(routeNeedle);
    }

    /**
     * Buduje sekcje dla dropdownu tras i kodów specjalnych na podstawie aktualnego modelu widoku.
     *
     * @returns {Array<{ key: string, label: string, items: Array<{ kind: 'route'|'marker', code: string, category: string, meaning: string }> }>}
     */
    function buildRouteDropdownSections() {
        const rows = Array.isArray(state?.viewModel?.rows) ? state.viewModel.rows : [];
        const routeNeedle = normalizeFilterValue(state.routeFilter);
        const grouped = new Map([
            ['STANDARD', []],
            ['WIECZOREK', []],
            ['SOBOTA', []],
            ['NIEDZIELA', []],
            ['MARKER', []]
        ]);
        const seen = new Set();

        for (const row of rows) {
            const cells = Array.isArray(row?.cells) ? row.cells : [];
            for (const cell of cells) {
                const tokens = Array.isArray(cell?.tokens) ? cell.tokens : [];
                for (const token of tokens) {
                    const kind = token?.kind === 'marker' ? 'marker' : 'route';
                    const code = String(token?.code ?? '').trim();
                    if (!code) continue;
                    const meaning = kind === 'marker'
                        ? String(
                            markerMeanings?.[code]
                            ?? markerMeanings?.[String(code || '').toUpperCase()]
                            ?? markerMeanings?.[String(code || '').toLowerCase()]
                            ?? markerMeanings?.[`${String(code || '').slice(0, 1).toUpperCase()}${String(code || '').slice(1).toLowerCase()}`]
                            ?? ''
                        ).trim()
                        : '';
                    const haystack = `${code} ${meaning}`.trim();
                    if (routeNeedle && !normalizeFilterValue(haystack).includes(routeNeedle)) continue;
                    const normalizedKey = `${kind}:${normalizeFilterValue(code)}`;
                    if (seen.has(normalizedKey)) continue;
                    seen.add(normalizedKey);

                    if (kind === 'marker') {
                        grouped.get('MARKER')?.push({
                            kind,
                            code,
                            category: 'MARKER',
                            meaning
                        });
                        continue;
                    }

                    const category = String(token?.category || 'STANDARD').trim() || 'STANDARD';
                    if (!grouped.has(category)) grouped.set(category, []);
                    grouped.get(category)?.push({
                        kind,
                        code,
                        category,
                        meaning: ''
                    });
                }
            }
        }

        const order = ['STANDARD', 'WIECZOREK', 'SOBOTA', 'NIEDZIELA', 'MARKER'];
        return order
            .map((category) => {
                const items = Array.isArray(grouped.get(category)) ? grouped.get(category) : [];
                items.sort((left, right) => compareFilterCodes(left.code, right.code));
                return {
                    key: category,
                    label: getFilterSectionLabel(/** @type {'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA'|'MARKER'} */ (category)),
                    items
                };
            })
            .filter(section => section.items.length > 0);
    }

    /**
     * Buduje listę kierowców widocznych dla aktualnego kontekstu filtrów.
     *
     * @returns {Array<{ driverId: string, driverName: string }>}
     */
    function buildDriverDropdownItems() {
        const rows = Array.isArray(state?.viewModel?.rows) ? state.viewModel.rows : [];
        const needle = normalizeFilterValue(state.driverFilter);
        const out = [];
        const seen = new Set();

        for (const row of rows) {
            const driverName = String(row?.driverName ?? '').trim();
            const driverId = String(row?.driverId ?? '').trim() || buildDriverId(driverName);
            if (!driverName || seen.has(driverId)) continue;
            if (needle && !normalizeFilterValue(driverName).includes(needle)) continue;
            seen.add(driverId);
            out.push({ driverId, driverName });
        }

        out.sort((left, right) => left.driverName.localeCompare(right.driverName, 'pl', { sensitivity: 'base' }));
        return out;
    }

    /**
     * Zwraca dane aktualnie wybranego miesiąca, jeśli istnieją na liście opcji.
     *
     * @returns {{ key: string, label: string } | null}
     */
    function getCurrentMonthItem() {
        return state.availableMonths.find(item => String(item?.key || '') === state.current.key) || null;
    }

    /**
     * Synchronizuje etykietę widoczną na triggerze wyboru miesiąca.
     */
    function syncMonthTriggerLabel() {
        if (!(monthTriggerLabelEl instanceof HTMLElement)) return;
        const currentMonth = getCurrentMonthItem();
        monthTriggerLabelEl.textContent = String(
            currentMonth?.label
            || state.selectedScheduleFile
            || 'Wybierz miesiąc'
        ).trim();
    }

    /**
     * Renderuje menu wyboru miesięcy grafiku w tym samym stylu co pozostałe dropdowny.
     */
    function renderMonthFilterDropdown() {
        if (!(monthOptionsEl instanceof HTMLElement)) return;
        monthOptionsEl.replaceChildren();

        if (state.availableMonths.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'schedule-filter-empty';
            empty.textContent = 'Brak dostępnych grafików.';
            monthOptionsEl.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'schedule-filter-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'Dostępne miesiące grafiku');

        for (const item of state.availableMonths) {
            const key = String(item?.key || '').trim();
            const labelText = String(item?.label || key).trim() || key;
            if (!key) continue;

            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'schedule-filter-option schedule-filter-option--month';
            option.dataset.filterType = 'month';
            option.dataset.value = key;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(key === state.current.key));

            const label = document.createElement('span');
            label.className = 'schedule-filter-option-text';
            label.textContent = labelText;
            option.appendChild(label);

            const meta = document.createElement('span');
            meta.className = 'schedule-filter-option-meta';
            meta.textContent = key;
            option.appendChild(meta);

            list.appendChild(option);
        }

        monthOptionsEl.appendChild(list);
    }

    /**
     * Renderuje menu wyboru kierowców pod polem filtra.
     */
    function renderDriverFilterDropdown() {
        if (!(driverFilterOptionsEl instanceof HTMLElement)) return;
        driverFilterOptionsEl.replaceChildren();

        const items = buildDriverDropdownItems();
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'schedule-filter-empty';
            empty.textContent = 'Brak kierowców do wyświetlenia.';
            driverFilterOptionsEl.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'schedule-filter-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'Dostępni kierowcy');

        for (const item of items) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'schedule-filter-option schedule-filter-option--driver';
            option.dataset.filterType = 'driver';
            option.dataset.value = item.driverName;
            option.dataset.driverId = item.driverId;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(normalizeFilterValue(state.driverFilter) === normalizeFilterValue(item.driverName)));

            const label = document.createElement('span');
            label.className = 'schedule-filter-option-text';
            label.textContent = item.driverName;
            option.appendChild(label);
            list.appendChild(option);
        }

        driverFilterOptionsEl.appendChild(list);
    }

    /**
     * Renderuje menu wyboru tras i kodów specjalnych.
     */
    function renderRouteFilterDropdown() {
        if (!(routeFilterOptionsEl instanceof HTMLElement)) return;
        routeFilterOptionsEl.replaceChildren();

        const sections = buildRouteDropdownSections();
        if (sections.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'schedule-filter-empty';
            empty.textContent = 'Brak tras lub kodów dla bieżącego widoku.';
            routeFilterOptionsEl.appendChild(empty);
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'schedule-filter-list schedule-filter-list--sections';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', 'Trasy i kody specjalne');

        for (const section of sections) {
            const sectionEl = document.createElement('section');
            sectionEl.className = 'schedule-filter-section';

            const title = document.createElement('div');
            title.className = 'schedule-filter-section-title';
            title.textContent = section.label;
            sectionEl.appendChild(title);

            const itemsWrap = document.createElement('div');
            itemsWrap.className = 'schedule-filter-badges';

            for (const item of section.items) {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = 'schedule-filter-option schedule-filter-option--route';
                option.dataset.filterType = 'route';
                option.dataset.value = item.code;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(normalizeFilterValue(state.routeFilter) === normalizeFilterValue(item.code)));

                const badge = document.createElement('span');
                badge.className = item.kind === 'marker'
                    ? 'route-badge route-badge--marker'
                    : ['route-badge', item.category ? `route-badge--${item.category}` : ''].filter(Boolean).join(' ');
                badge.textContent = item.code;
                option.title = item.kind === 'marker' && item.meaning ? `${item.code}: ${item.meaning}` : item.code;
                option.appendChild(badge);

                if (item.kind === 'marker' && item.meaning) {
                    const meta = document.createElement('span');
                    meta.className = 'schedule-filter-option-meta';
                    meta.textContent = item.meaning;
                    option.appendChild(meta);
                }

                itemsWrap.appendChild(option);
            }

            sectionEl.appendChild(itemsWrap);
            menu.appendChild(sectionEl);
        }

        routeFilterOptionsEl.appendChild(menu);
    }

    /**
     * Synchronizuje zawartość i stan obu custom dropdownów.
     */
    function renderFilterDropdowns() {
        syncMonthTriggerLabel();
        renderMonthFilterDropdown();
        renderDriverFilterDropdown();
        renderRouteFilterDropdown();
        setFilterDropdownExpandedState('month', state.openDropdown === 'month');
        setFilterDropdownExpandedState('driver', state.openDropdown === 'driver');
        setFilterDropdownExpandedState('route', state.openDropdown === 'route');
    }

    /**
     * Ustawia tekst pomocniczy pod tytułem widoku.
     *
     * @param {string} text
     */
    function setSubtitle(text) {
        if (!subtitleEl) return;
        subtitleEl.textContent = String(text ?? '');
    }

    /**
     * Ustawia tekst prezentujący wybrany dzień.
     *
     * @param {string} text
     */
    function setSelectedDayLabel(text) {
        if (!selectedDayEl) return;
        selectedDayEl.textContent = String(text ?? '');
    }

    /**
     * Zwraca listę dni obecnie dostępnych w aktywnym modelu widoku.
     *
     * @returns {Array<{ isoDate: string, day: number, weekday: number, isWeekend: boolean, isToday: boolean }>}
     */
    function getVisibleDays() {
        return Array.isArray(state?.viewModel?.days) ? state.viewModel.days : [];
    }

    /**
     * Zwraca datę ISO dzisiejszego dnia, jeśli istnieje dla wybranego miesiąca.
     *
     * @returns {string}
     */
    function getTodayIsoForCurrentSchedule() {
        if (!state.current.key || !isCurrentMonthKey(state.current.key)) return '';
        const now = new Date();
        const iso = buildIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
        const days = Array.isArray(state?.monthTable?.days) ? state.monthTable.days : [];
        return days.some(day => String(day?.isoDate || '') === iso) ? iso : '';
    }

    /**
     * Rozwiązuje domyślnie zaznaczony dzień dla nowo wybranego miesiąca.
     *
     * @param {string} preferredIso
     * @returns {string}
     */
    function resolveDefaultSelectedDay(preferredIso = '') {
        const days = Array.isArray(state?.monthTable?.days) ? state.monthTable.days : [];
        const preferred = coerceIsoDate(preferredIso);
        if (preferred && days.some(day => String(day?.isoDate || '') === preferred)) return preferred;
        const todayIso = getTodayIsoForCurrentSchedule();
        if (todayIso) return todayIso;
        return days.length > 0 ? String(days[0]?.isoDate || '') : '';
    }

    /**
     * Buduje listę opcji dla selecta miesięcy.
     */
    function buildMonthSelectOptions() {
        if (!monthSelect) return;
        monthSelect.replaceChildren();

        for (const item of state.availableMonths) {
            const meta = parseYearMonth(item?.key);
            if (!meta) continue;
            const opt = document.createElement('option');
            opt.value = meta.key;
            opt.textContent = String(item?.label || '').trim() || meta.key;
            opt.selected = meta.key === state.current.key;
            monthSelect.appendChild(opt);
        }

        syncMonthTriggerLabel();
    }

    /**
     * Nakłada filtry widoku na aktualny model miesiąca.
     *
     * @returns {{
     *   days: Array<{ isoDate: string, day: number, weekday: number, isWeekend: boolean, isToday: boolean }>,
     *   rows: Array<{
     *     driverName: string,
     *     driverId: string,
     *     isSelectedDriver: boolean,
     *     cells: Array<{
     *       isoDate: string,
     *       isWeekend: boolean,
     *       isToday: boolean,
     *       isSelectedDay: boolean,
     *       isIntersection: boolean,
     *       isRouteMatch: boolean,
     *       isDimmedByRouteFilter: boolean,
     *       tokens: any[],
     *       title: string
     *     }>
     *   }>,
     *   totalDrivers: number,
     *   visibleDrivers: number
     * }}
     */
    function applyScheduleFilters() {
        const monthTable = state.monthTable;
        const emptyView = { days: [], rows: [], totalDrivers: 0, visibleDrivers: 0 };
        if (!monthTable || !Array.isArray(monthTable.days) || !Array.isArray(monthTable.rows)) return emptyView;

        const driverNeedle = normalizeFilterValue(state.driverFilter);
        const routeNeedle = normalizeFilterValue(state.routeFilter);
        const todayIso = getTodayIsoForCurrentSchedule();

        const days = monthTable.days.map(day => ({
            isoDate: String(day?.isoDate || ''),
            day: Number(day?.day || 0),
            weekday: Number(day?.weekday || 0),
            isWeekend: Boolean(day?.isWeekend),
            isToday: String(day?.isoDate || '') === todayIso
        }));

        const rows = [];
        for (const rawRow of monthTable.rows) {
            const driverName = String(rawRow?.driverName ?? '').trim();
            const driverId = buildDriverId(driverName);
            if (!driverName) continue;

            if (driverNeedle && !normalizeFilterValue(driverName).includes(driverNeedle)) {
                continue;
            }

            const rawCells = Array.isArray(rawRow?.cells) ? rawRow.cells : [];
            const cells = rawCells.map((cell, index) => {
                const isoDate = String(cell?.isoDate || days[index]?.isoDate || '');
                const tokens = Array.isArray(cell?.tokens) ? cell.tokens.filter(Boolean) : [];
                const tokenCodes = tokens.map(token => String(token?.code ?? '').trim()).filter(Boolean);
                const routeMatch = !routeNeedle || tokenCodes.some(code => matchesRouteFilter(code, routeNeedle));
                const title = tokenCodes.join(' / ');
                const isSelectedDay = state.selectedIsoDate === isoDate;
                const isSelectedDriver = state.selectedDriverId && state.selectedDriverId === driverId;

                return {
                    isoDate,
                    isWeekend: Boolean(days[index]?.isWeekend),
                    isToday: Boolean(days[index]?.isToday),
                    isSelectedDay,
                    isIntersection: isSelectedDay && isSelectedDriver,
                    isRouteMatch: routeMatch,
                    isDimmedByRouteFilter: Boolean(routeNeedle) && !routeMatch,
                    tokens,
                    title
                };
            });

            const rowMatchesRoute = !routeNeedle || cells.some(cell => cell.isRouteMatch);
            if (!rowMatchesRoute) continue;

            rows.push({
                driverName,
                driverId,
                isSelectedDriver: state.selectedDriverId === driverId,
                cells
            });
        }

        return {
            days,
            rows,
            totalDrivers: monthTable.rows.length,
            visibleDrivers: rows.length
        };
    }

    /**
     * Dba o spójność zaznaczeń po zmianie filtrów lub miesiąca.
     */
    function syncSelectionState() {
        const visibleDays = getVisibleDays();
        if (!visibleDays.length) {
            state.selectedIsoDate = null;
            state.selectedDayIndex = -1;
        } else if (!visibleDays.some(day => day.isoDate === state.selectedIsoDate)) {
            state.selectedIsoDate = resolveDefaultSelectedDay();
            state.selectedDayIndex = visibleDays.findIndex(day => day.isoDate === state.selectedIsoDate);
        } else {
            state.selectedDayIndex = visibleDays.findIndex(day => day.isoDate === state.selectedIsoDate);
        }

        const visibleRows = Array.isArray(state?.viewModel?.rows) ? state.viewModel.rows : [];
        if (state.selectedDriverId && !visibleRows.some(row => row.driverId === state.selectedDriverId)) {
            state.selectedDriverId = '';
            state.selectedDriverName = '';
        }
    }

    /**
     * Aktualizuje teksty pomocnicze w toolbarze.
     */
    function renderScheduleToolbar() {
        syncFilterInputs();
        renderFilterDropdowns();
        updateDayNavButtons();

        const parts = formatDayHeaderParts(dtfWeekday, state.selectedIsoDate || '');
        setSelectedDayLabel(parts.fullLabel);

        const visibleDrivers = Number(state?.viewModel?.visibleDrivers || 0);
        const totalDrivers = Number(state?.viewModel?.totalDrivers || 0);
        if (!state.monthTable) {
            setSubtitle('Brak danych grafiku dla wybranego miesiąca.');
            return;
        }

        if (visibleDrivers === 0) {
            setSubtitle('Brak wyników dla wybranych filtrów. Wyczyść filtry, aby zobaczyć cały grafik.');
            return;
        }

        setSubtitle(`Pokazano ${visibleDrivers} z ${totalDrivers} kierowców`);
    }

    /**
     * Ustawia stan disabled dla przycisków nawigacji dziennej i akcji `Dziś`.
     */
    function updateDayNavButtons() {
        const days = getVisibleDays();
        if (prevDayBtn) prevDayBtn.disabled = state.selectedDayIndex <= 0 || days.length === 0;
        if (nextDayBtn) nextDayBtn.disabled = state.selectedDayIndex < 0 || state.selectedDayIndex >= (days.length - 1);

        if (todayBtn) {
            const currentMonthExists = state.availableMonths.some(item => String(item?.key || '') === buildIsoDate(new Date().getFullYear(), new Date().getMonth() + 1, 1).slice(0, 7));
            todayBtn.disabled = !currentMonthExists;
        }
    }

    /**
     * Renderuje pusty stan tabeli.
     *
     * @param {string} primaryText
     * @param {string} secondaryText
     * @param {number} colSpan
     */
    function renderEmptyState(primaryText, secondaryText, colSpan) {
        if (!tableBody) return;
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = Math.max(1, Number(colSpan) || 1);
        td.className = 'schedule-empty-state';
        td.innerHTML = `<strong>${String(primaryText || '')}</strong><span>${String(secondaryText || '')}</span>`;
        tr.appendChild(td);
        tableBody.appendChild(tr);
    }

    /**
     * Renderuje tokeny w komórce grafiku.
     *
     * @param {HTMLElement} cellEl
     * @param {string} isoDate
     * @param {string} cellTitle
     * @param {Array<{ kind: 'route'|'marker', code: string, category?: string }>} tokens
     */
    function renderCellTokens(cellEl, isoDate, cellTitle, tokens) {
        const list = Array.isArray(tokens) ? tokens : [];
        if (list.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'schedule-empty';
            empty.textContent = '—';
            cellEl.appendChild(empty);
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'schedule-cell-inner';

        for (let index = 0; index < list.length; index += 1) {
            const token = list[index];
            const kind = token?.kind === 'marker' ? 'marker' : 'route';
            const code = String(token?.code ?? '').trim();
            if (!code) continue;

            if (kind === 'marker') {
                const marker = document.createElement('span');
                marker.className = 'route-badge route-badge--marker';
                marker.textContent = code;
                marker.dataset.markerCode = code.toUpperCase();
                const meaning = String(
                    markerMeanings?.[code]
                    ?? markerMeanings?.[String(code || '').toUpperCase()]
                    ?? markerMeanings?.[String(code || '').toLowerCase()]
                    ?? markerMeanings?.[`${String(code || '').slice(0, 1).toUpperCase()}${String(code || '').slice(1).toLowerCase()}`]
                    ?? ''
                ).trim();
                marker.title = meaning ? `${code}: ${meaning}` : code;
                marker.setAttribute('aria-label', meaning ? `${code}: ${meaning}` : code);
                wrap.appendChild(marker);
                continue;
            }

            const routeAvailable = isRouteAvailable(code);
            const badge = document.createElement('button');
            const category = String(token?.category ?? '').trim();
            badge.type = 'button';
            badge.className = [
                'route-badge',
                category ? `route-badge--${category}` : '',
                !routeAvailable ? 'is-unavailable' : ''
            ].filter(Boolean).join(' ');
            badge.textContent = code;
            badge.title = routeAvailable ? code : `${code} (brak pliku trasy)`;
            badge.dataset.action = 'open-route';
            badge.dataset.isoDate = isoDate;
            badge.dataset.routeCode = code;
            badge.dataset.routeAvailable = routeAvailable ? 'true' : 'false';
            badge.setAttribute('aria-disabled', routeAvailable ? 'false' : 'true');
            badge.setAttribute(
                'aria-label',
                routeAvailable
                    ? `Otwórz trasę ${code} dla dnia ${isoDate}`
                    : `Trasa ${code} nie jest dostępna w bazie`
            );
            wrap.appendChild(badge);
        }

        cellEl.appendChild(wrap);
    }

    /**
     * Renderuje aktualny model widoku grafiku.
     */
    function renderScheduleGrid() {
        clearTable();

        const view = state.viewModel;
        const dayCount = Array.isArray(view?.days) ? view.days.length : 0;

        if (tableHeaderRow) {
            const driverHeader = document.createElement('th');
            driverHeader.className = 'driver-header';
            driverHeader.scope = 'col';
            driverHeader.textContent = 'Kierowca \\ Dzień';
            tableHeaderRow.appendChild(driverHeader);

            const days = Array.isArray(view?.days) ? view.days : [];
            for (const day of days) {
                const parts = formatDayHeaderParts(dtfWeekday, day.isoDate);
                const th = document.createElement('th');
                th.className = 'schedule-day-header';
                th.dataset.isoDate = day.isoDate;
                th.classList.toggle('is-weekend', Boolean(day.isWeekend));
                th.classList.toggle('is-selected-day', state.selectedIsoDate === day.isoDate);
                th.classList.toggle('is-today', Boolean(day.isToday));

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'schedule-day-header-btn';
                btn.dataset.action = 'select-day';
                btn.dataset.isoDate = day.isoDate;
                btn.innerHTML = `<span class="schedule-day-number">${String(day.day || '')}</span><span class="schedule-day-weekday">${parts.weekday}</span>`;
                btn.title = `Wybierz dzień ${parts.date}`;
                th.appendChild(btn);
                tableHeaderRow.appendChild(th);
            }
        }

        if (!state.monthTable) {
            renderEmptyState(
                'Brak danych grafiku dla wybranego miesiąca.',
                'Nie znaleziono wczytanego pliku grafiku dla tego miesiąca.',
                1
            );
            return;
        }

        if (!view || !Array.isArray(view.rows) || view.rows.length === 0) {
            renderEmptyState(
                'Brak wyników dla wybranych filtrów.',
                'Wyczyść filtry, aby zobaczyć cały grafik.',
                dayCount + 1
            );
            return;
        }

        const bodyFragment = document.createDocumentFragment();
        for (const row of view.rows) {
            const tr = document.createElement('tr');
            tr.className = 'schedule-row';
            tr.classList.toggle('is-selected-driver', Boolean(row.isSelectedDriver));
            tr.dataset.driverId = row.driverId;

            const driverCell = document.createElement('td');
            driverCell.className = 'driver-cell';
            driverCell.dataset.action = 'select-driver';
            driverCell.dataset.driverId = row.driverId;
            driverCell.dataset.driverName = row.driverName;
            driverCell.setAttribute('role', 'button');
            driverCell.setAttribute('tabindex', '0');
            driverCell.setAttribute('aria-pressed', row.isSelectedDriver ? 'true' : 'false');
            driverCell.title = row.driverName;
            driverCell.textContent = isCompactScheduleLayout() ? formatCompactDriverName(row.driverName) : row.driverName;
            tr.appendChild(driverCell);

            for (const cell of row.cells) {
                const td = document.createElement('td');
                td.className = 'schedule-cell';
                td.dataset.isoDate = cell.isoDate;
                td.classList.toggle('is-weekend', Boolean(cell.isWeekend));
                td.classList.toggle('is-selected-day', Boolean(cell.isSelectedDay));
                td.classList.toggle('is-selected-driver', Boolean(row.isSelectedDriver));
                td.classList.toggle('is-selection-intersection', Boolean(cell.isIntersection));
                td.classList.toggle('is-route-dimmed', Boolean(cell.isDimmedByRouteFilter));
                td.classList.toggle('is-today', Boolean(cell.isToday));
                td.title = cell.title || '';
                renderCellTokens(td, cell.isoDate, cell.title, cell.tokens);
                tr.appendChild(td);
            }

            bodyFragment.appendChild(tr);
        }

        tableBody?.appendChild?.(bodyFragment);
    }

    /**
     * Przewija tabelę do aktualnie zaznaczonej kolumny dnia.
     *
     * @param {ScrollBehavior} [behavior='smooth']
     */
    function scrollToSelectedDay(behavior = 'smooth') {
        const iso = coerceIsoDate(state.selectedIsoDate);
        if (!iso) return;
        const safeIso = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(iso) : iso;
        const headerCell = tableHeaderRow?.querySelector?.(`[data-iso-date="${safeIso}"]`);
        if (!(headerCell instanceof HTMLElement)) return;

        window.requestAnimationFrame(() => {
            headerCell.scrollIntoView({
                block: 'nearest',
                inline: 'center',
                behavior
            });
        });
    }

    /**
     * Renderuje cały widok grafiku na podstawie aktualnego stanu.
     *
     * @param {{ scrollToDay?: boolean, scrollBehavior?: ScrollBehavior, preserveScroll?: boolean }} [options]
     */
    function refreshView(options = {}) {
        const shouldPreserveScroll = Boolean(options.preserveScroll);
        const preservedScrollLeft = shouldPreserveScroll && tableContainer instanceof HTMLElement
            ? Math.max(0, Number(tableContainer.scrollLeft) || 0)
            : 0;
        const preservedScrollTop = shouldPreserveScroll && tableContainer instanceof HTMLElement
            ? Math.max(0, Number(tableContainer.scrollTop) || 0)
            : 0;
        state.viewModel = applyScheduleFilters();
        syncSelectionState();
        state.viewModel = applyScheduleFilters();
        syncSelectionState();
        renderScheduleToolbar();
        renderScheduleGrid();

        if (shouldPreserveScroll && tableContainer instanceof HTMLElement) {
            window.requestAnimationFrame(() => {
                tableContainer.scrollLeft = preservedScrollLeft;
                tableContainer.scrollTop = preservedScrollTop;
            });
        }

        if (options.scrollToDay) {
            scrollToSelectedDay(options.scrollBehavior || 'smooth');
        }
    }

    /**
     * Ustawia wybrany dzień, jeśli istnieje w aktualnym miesiącu.
     *
     * @param {string} isoDate
     * @param {{ shouldScroll?: boolean }} [options]
     */
    function setSelectedDay(isoDate, options = {}) {
        const iso = coerceIsoDate(isoDate);
        const days = Array.isArray(state?.monthTable?.days) ? state.monthTable.days : [];
        if (!iso || !days.some(day => String(day?.isoDate || '') === iso)) return;
        state.selectedIsoDate = iso;
        state.selectedDayIndex = days.findIndex(day => String(day?.isoDate || '') === iso);
        refreshView({ scrollToDay: options.shouldScroll !== false });
    }

    /**
     * Ustawia zaznaczony wiersz kierowcy.
     *
     * @param {string} driverId
     * @param {string} driverName
     */
    function setSelectedDriver(driverId, driverName) {
        const nextId = String(driverId || '').trim();
        if (!nextId) {
            state.selectedDriverId = '';
            state.selectedDriverName = '';
            refreshView({ scrollToDay: false, preserveScroll: true });
            return;
        }

        if (state.selectedDriverId === nextId) {
            state.selectedDriverId = '';
            state.selectedDriverName = '';
            refreshView({ scrollToDay: false, preserveScroll: true });
            return;
        }

        state.selectedDriverId = nextId;
        state.selectedDriverName = String(driverName || '').trim();
        refreshView({ scrollToDay: false, preserveScroll: true });
    }

    /**
     * Czyści oba filtry toolbaru.
     */
    function clearScheduleFilters() {
        state.driverFilter = '';
        state.routeFilter = '';
        state.routeFilterMode = 'contains';
        closeFilterDropdowns();
        refreshView({ scrollToDay: false });
    }

    /**
     * Czyści zaznaczenia, filtry oraz pozycję scrolla komponentu.
     */
    function resetViewState() {
        state.selectedDayIndex = -1;
        state.selectedIsoDate = null;
        state.selectedDriverId = '';
        state.selectedDriverName = '';
        state.driverFilter = '';
        state.routeFilter = '';
        state.routeFilterMode = 'contains';
        closeFilterDropdowns();
        syncFilterInputs();
        if (tableContainer instanceof HTMLElement) {
            tableContainer.scrollLeft = 0;
            tableContainer.scrollTop = 0;
        }
    }

    /**
     * Zwraca aktualny stan UI grafiku do późniejszego odtworzenia.
     *
     * @returns {{
     *   monthKey: string,
     *   selectedIsoDate: string|null,
     *   selectedDriverId: string,
     *   selectedDriverName: string,
     *   driverFilter: string,
     *   routeFilter: string,
     *   routeFilterMode: 'contains'|'exact',
     *   scrollLeft: number,
     *   scrollTop: number
     * }}
     */
    function getViewState() {
        return Object.freeze({
            monthKey: String(state.current.key || ''),
            selectedIsoDate: state.selectedIsoDate || null,
            selectedDriverId: String(state.selectedDriverId || ''),
            selectedDriverName: String(state.selectedDriverName || ''),
            driverFilter: String(state.driverFilter || ''),
            routeFilter: String(state.routeFilter || ''),
            routeFilterMode: state.routeFilterMode === 'exact' ? 'exact' : 'contains',
            scrollLeft: tableContainer instanceof HTMLElement ? Math.max(0, Number(tableContainer.scrollLeft) || 0) : 0,
            scrollTop: tableContainer instanceof HTMLElement ? Math.max(0, Number(tableContainer.scrollTop) || 0) : 0
        });
    }

    /**
     * Odtwarza zapisany stan UI grafiku.
     *
     * @param {any} snapshot
     * @param {{ fallbackMonthKey?: string }} [options]
     */
    function restoreViewState(snapshot, options = {}) {
        const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
        const requestedMonthKey = String(safeSnapshot?.monthKey || '').trim();
        const fallbackMonthKey = String(options?.fallbackMonthKey || '').trim();
        const targetMonthKey = state.availableMonths.some(item => String(item?.key || '') === requestedMonthKey)
            ? requestedMonthKey
            : fallbackMonthKey;

        state.driverFilter = String(safeSnapshot?.driverFilter || '').trim();
        state.routeFilter = String(safeSnapshot?.routeFilter || '').trim();
        state.routeFilterMode = safeSnapshot?.routeFilterMode === 'exact' ? 'exact' : 'contains';
        state.selectedDriverId = String(safeSnapshot?.selectedDriverId || '').trim();
        state.selectedDriverName = String(safeSnapshot?.selectedDriverName || '').trim();
        closeFilterDropdowns();
        syncFilterInputs();

        if (targetMonthKey) {
            setMonthByKey(targetMonthKey, {
                selectedIsoDate: String(safeSnapshot?.selectedIsoDate || '').trim(),
                scrollBehavior: 'auto'
            });
        } else {
            refreshView({ scrollToDay: false });
        }

        const scrollLeft = Math.max(0, Number(safeSnapshot?.scrollLeft) || 0);
        const scrollTop = Math.max(0, Number(safeSnapshot?.scrollTop) || 0);
        if (tableContainer instanceof HTMLElement) {
            window.requestAnimationFrame(() => {
                tableContainer.scrollLeft = scrollLeft;
                tableContainer.scrollTop = scrollTop;
            });
        }
    }

    /**
     * Zwraca sąsiedni dzień względem aktualnego zaznaczenia.
     *
     * @param {number} direction
     * @returns {string}
     */
    function getAdjacentDayIso(direction) {
        const days = getVisibleDays();
        if (!days.length) return '';
        const baseIndex = state.selectedDayIndex >= 0 ? state.selectedDayIndex : 0;
        const nextIndex = baseIndex + (direction < 0 ? -1 : 1);
        if (nextIndex < 0 || nextIndex >= days.length) return '';
        return String(days[nextIndex]?.isoDate || '');
    }

    /**
     * Wybiera miesiąc po kluczu `YYYY-MM`.
     *
     * @param {string} ym
     * @param {{ selectedIsoDate?: string, scrollBehavior?: ScrollBehavior }} [options]
     */
    function setMonthByKey(ym, options = {}) {
        const meta = parseYearMonth(ym);
        if (!meta) return;

        state.current = { year: meta.year, month: meta.month, key: meta.key };
        state.selectedScheduleFile = meta.key;
        state.monthTable = getMonthScheduleTable(meta.year, meta.month);
        state.selectedScheduleFile = String(state?.monthTable?.fileName || meta.key);
        buildMonthSelectOptions();
        if (!state.monthTable) {
            state.selectedIsoDate = null;
            state.selectedDayIndex = -1;
            refreshView({ scrollToDay: false });
            return;
        }

        state.selectedIsoDate = resolveDefaultSelectedDay(options.selectedIsoDate || '');
        state.selectedDayIndex = Array.isArray(state.monthTable.days)
            ? state.monthTable.days.findIndex(day => String(day?.isoDate || '') === state.selectedIsoDate)
            : -1;

        refreshView({ scrollToDay: true, scrollBehavior: options.scrollBehavior || 'auto' });
    }

    /**
     * Renderuje miesiąc na podstawie części liczbowych.
     *
     * @param {{ year?: number, month?: number, selectedIsoDate?: string }} opts
     */
    function renderMonthDays(opts = {}) {
        const year = Number(opts?.year);
        const month = Number(opts?.month);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return;
        setMonthByKey(`${year}-${String(month).padStart(2, '0')}`, { selectedIsoDate: String(opts?.selectedIsoDate || '') });
    }

    /**
     * Ustawia listę dostępnych miesięcy grafiku.
     *
     * @param {string[]} list
     */
    function setAvailableMonthsList(list) {
        const src = Array.isArray(list) ? list : [];
        const normalized = [];
        for (const item of src) {
            const rawKey = typeof item === 'string' ? item : item?.key;
            const meta = parseYearMonth(rawKey);
            if (!meta) continue;
            const rawLabel = typeof item === 'string' ? '' : String(item?.label || '').trim();
            normalized.push({
                key: meta.key,
                label: rawLabel || meta.key
            });
        }
        normalized.sort((a, b) => String(a.key).localeCompare(String(b.key), 'pl', { sensitivity: 'base' }));
        const unique = new Map();
        for (const item of normalized) {
            if (!unique.has(item.key)) unique.set(item.key, Object.freeze(item));
        }
        state.availableMonths = Array.from(unique.values());
        buildMonthSelectOptions();
        updateDayNavButtons();
    }

    /**
     * Przechodzi do dzisiejszego dnia, jeśli istnieje w dostępnych danych.
     */
    function goToday() {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const todayIso = buildIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
        if (!state.availableMonths.some(item => String(item?.key || '') === monthKey)) return;

        if (state.current.key !== monthKey) {
            setMonthByKey(monthKey, { selectedIsoDate: todayIso, scrollBehavior: 'smooth' });
            return;
        }

        setSelectedDay(todayIso, { shouldScroll: true });
    }

    /**
     * Obsługuje kliknięcia w nagłówku i treści tabeli.
     *
     * @param {MouseEvent} event
     */
    function handleTableClick(event) {
        const target = event?.target;
        if (!(target instanceof Element)) return;

        const actionEl = target.closest('[data-action]');
        if (actionEl instanceof HTMLElement) {
            const action = String(actionEl.dataset.action || '');

            if (action === 'open-route') {
                event.stopPropagation();
                const routeCode = String(actionEl.dataset.routeCode || '').trim();
                const isoDate = String(actionEl.dataset.isoDate || '').trim();
                const routeAvailable = String(actionEl.dataset.routeAvailable || '').trim() !== 'false';
                if (!routeAvailable) return;
                if (!routeCode || !isoDate) return;
                onOpenRoute({ routeCode, isoDate });
                return;
            }

            if (action === 'select-day') {
                const isoDate = String(actionEl.dataset.isoDate || '').trim();
                if (isoDate) setSelectedDay(isoDate, { shouldScroll: true });
                return;
            }

            if (action === 'select-driver') {
                const driverId = String(actionEl.dataset.driverId || '').trim();
                const driverName = String(actionEl.dataset.driverName || '').trim();
                setSelectedDriver(driverId, driverName);
                return;
            }
        }

        if (target.closest('.route-badge')) return;

        const cell = target.closest('td[data-iso-date]');
        if (cell instanceof HTMLElement) {
            const isoDate = String(cell.dataset.isoDate || '').trim();
            if (isoDate) setSelectedDay(isoDate, { shouldScroll: true });
        }
    }

    /**
     * Obsługuje klawiaturę dla interaktywnej komórki kierowcy.
     *
     * @param {KeyboardEvent} event
     */
    function handleDriverKeydown(event) {
        const target = event?.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains('driver-cell')) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        const driverId = String(target.dataset.driverId || '').trim();
        const driverName = String(target.dataset.driverName || '').trim();
        setSelectedDriver(driverId, driverName);
    }

    /**
     * Obsługuje wybór opcji z custom dropdownów filtrów.
     *
     * @param {MouseEvent} event
     */
    function handleFilterOptionClick(event) {
        const target = event?.target;
        if (!(target instanceof Element)) return;
        const option = target.closest('.schedule-filter-option');
        if (!(option instanceof HTMLButtonElement)) return;

        const filterType = String(option.dataset.filterType || '').trim();
        const value = String(option.dataset.value || '').trim();
        if (!value) return;

        event.preventDefault();
        closeFilterDropdowns();

        if (filterType === 'driver') {
            state.driverFilter = value;
            refreshView({ scrollToDay: false });
            return;
        }

        if (filterType === 'month') {
            setMonthByKey(value);
            return;
        }

        if (filterType === 'route') {
            state.routeFilter = value;
            state.routeFilterMode = 'exact';
            refreshView({ scrollToDay: false });
        }
    }

    /**
     * Otwiera dropdown filtra po wejściu w pole lub po kliknięciu toggle.
     *
     * @param {'month'|'driver'|'route'} type
     */
    function openFilterDropdown(type) {
        toggleFilterDropdown(type, true);
    }

    /**
     * Obsługuje klawiaturę dla pól filtrów z custom dropdownami.
     *
     * @param {'driver'|'route'} type
     * @param {KeyboardEvent} event
     */
    function handleFilterInputKeydown(type, event) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            openFilterDropdown(type);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeFilterDropdowns();
        }
    }

    /**
     * Obsługuje klawiaturę dla niestandardowego dropdownu miesiąca.
     *
     * @param {KeyboardEvent} event
     */
    function handleMonthTriggerKeydown(event) {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openFilterDropdown('month');
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeFilterDropdowns();
        }
    }

    /**
     * Podpina wszystkie handlery UI.
     */
    function attach() {
        tableHeaderRow?.addEventListener?.('click', handleTableClick);
        tableBody?.addEventListener?.('click', handleTableClick);
        tableBody?.addEventListener?.('keydown', handleDriverKeydown);
        syncFullscreenButtonState();

        monthSelect?.addEventListener?.('change', () => {
            const key = String(monthSelect.value || '').trim();
            if (key) {
                closeFilterDropdowns();
                setMonthByKey(key);
            }
        });

        monthTriggerBtn?.addEventListener?.('click', () => {
            const shouldOpen = state.openDropdown !== 'month';
            toggleFilterDropdown('month');
            if (shouldOpen) monthTriggerBtn.focus();
        });

        monthTriggerBtn?.addEventListener?.('keydown', (event) => {
            handleMonthTriggerKeydown(event);
        });

        monthToggleBtn?.addEventListener?.('click', () => {
            const shouldOpen = state.openDropdown !== 'month';
            toggleFilterDropdown('month');
            if (shouldOpen) monthTriggerBtn?.focus();
        });

        monthToggleBtn?.addEventListener?.('keydown', (event) => {
            handleMonthTriggerKeydown(event);
        });

        prevDayBtn?.addEventListener?.('click', () => {
            const isoDate = getAdjacentDayIso(-1);
            if (isoDate) setSelectedDay(isoDate, { shouldScroll: true });
        });

        nextDayBtn?.addEventListener?.('click', () => {
            const isoDate = getAdjacentDayIso(1);
            if (isoDate) setSelectedDay(isoDate, { shouldScroll: true });
        });

        todayBtn?.addEventListener?.('click', () => {
            goToday();
        });

        fullscreenBtn?.addEventListener?.('click', () => {
            toggleScheduleFullscreen().catch(() => {
                syncFullscreenButtonState();
            });
        });

        driverFilterInput?.addEventListener?.('input', () => {
            state.driverFilter = String(driverFilterInput.value || '').trim();
            openFilterDropdown('driver');
            refreshView({ scrollToDay: false });
        });

        driverFilterInput?.addEventListener?.('focus', () => {
            openFilterDropdown('driver');
        });

        driverFilterInput?.addEventListener?.('click', () => {
            openFilterDropdown('driver');
        });

        driverFilterInput?.addEventListener?.('keydown', (event) => {
            handleFilterInputKeydown('driver', event);
        });

        driverFilterToggleBtn?.addEventListener?.('click', () => {
            const shouldOpen = state.openDropdown !== 'driver';
            toggleFilterDropdown('driver');
            if (shouldOpen) driverFilterInput?.focus();
        });

        routeFilterInput?.addEventListener?.('input', () => {
            state.routeFilter = String(routeFilterInput.value || '').trim();
            state.routeFilterMode = 'contains';
            openFilterDropdown('route');
            refreshView({ scrollToDay: false });
        });

        routeFilterInput?.addEventListener?.('focus', () => {
            openFilterDropdown('route');
        });

        routeFilterInput?.addEventListener?.('click', () => {
            openFilterDropdown('route');
        });

        routeFilterInput?.addEventListener?.('keydown', (event) => {
            handleFilterInputKeydown('route', event);
        });

        routeFilterToggleBtn?.addEventListener?.('click', () => {
            const shouldOpen = state.openDropdown !== 'route';
            toggleFilterDropdown('route');
            if (shouldOpen) routeFilterInput?.focus();
        });

        monthOptionsEl?.addEventListener?.('click', handleFilterOptionClick);
        driverFilterOptionsEl?.addEventListener?.('click', handleFilterOptionClick);
        routeFilterOptionsEl?.addEventListener?.('click', handleFilterOptionClick);

        clearFiltersBtn?.addEventListener?.('click', () => {
            clearScheduleFilters();
        });

        document.addEventListener('pointerdown', (event) => {
            const target = event?.target;
            if (!(target instanceof Element)) return;
            const insideMonth = target.closest('#schedule-month-dropdown');
            const insideDriver = target.closest('#schedule-driver-filter-dropdown');
            const insideRoute = target.closest('#schedule-route-filter-dropdown');
            if (insideMonth || insideDriver || insideRoute) return;
            closeFilterDropdowns();
        });

        document.addEventListener('fullscreenchange', () => {
            syncFullscreenButtonState();
        });

        document.addEventListener('webkitfullscreenchange', () => {
            syncFullscreenButtonState();
        });

        window.addEventListener('resize', () => {
            const nextCompactLayout = isCompactScheduleLayout();
            if (nextCompactLayout === lastCompactLayout) return;
            lastCompactLayout = nextCompactLayout;
            refreshView({ scrollToDay: false, preserveScroll: true });
        });
    }

    attach();
    refreshView({ scrollToDay: false });

    return Object.freeze({
        isVisible,
        getViewState,
        resetViewState,
        restoreViewState,
        setAvailableMonthsList,
        setMonthByKey,
        renderMonthDays,
        setSelectedDay,
        setSelectedDriver,
        goToday,
        scrollToSelectedDay,
        exitScheduleFullscreen
    });
}

/**
 * Fasada zgodności wstecznej.
 *
 * @param {Object} cfg
 * @returns {ReturnType<typeof createScheduleGrid>}
 */
export function createScheduleController(cfg = {}) {
    return createScheduleGrid(cfg);
}
