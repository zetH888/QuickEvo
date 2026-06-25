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
 * @param {HTMLInputElement|null} cfg.driverFilterInput
 * @param {HTMLInputElement|null} cfg.routeFilterInput
 * @param {HTMLElement|null} cfg.routeFilterOptionsEl
 * @param {HTMLElement|null} cfg.selectedDayEl
 * @param {HTMLElement|null} cfg.subtitleEl
 * @param {HTMLButtonElement|null} cfg.prevMonthBtn
 * @param {HTMLButtonElement|null} cfg.nextMonthBtn
 * @param {HTMLButtonElement|null} cfg.todayBtn
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
    const driverFilterInput = cfg?.driverFilterInput || null;
    const routeFilterInput = cfg?.routeFilterInput || null;
    const routeFilterOptionsEl = cfg?.routeFilterOptionsEl || null;
    const selectedDayEl = cfg?.selectedDayEl || null;
    const subtitleEl = cfg?.subtitleEl || null;
    const prevDayBtn = cfg?.prevMonthBtn || null;
    const nextDayBtn = cfg?.nextMonthBtn || null;
    const todayBtn = cfg?.todayBtn || null;
    const clearFiltersBtn = cfg?.clearFiltersBtn || null;

    const getMonthScheduleTable = typeof cfg?.getMonthScheduleTable === 'function' ? cfg.getMonthScheduleTable : (() => null);
    const markerMeanings = cfg?.markerMeanings && typeof cfg.markerMeanings === 'object' ? cfg.markerMeanings : {};
    const isRouteAvailable = typeof cfg?.isRouteAvailable === 'function' ? cfg.isRouteAvailable : (() => false);
    const onOpenRoute = typeof cfg?.onOpenRoute === 'function' ? cfg.onOpenRoute : (() => { });

    const dtfWeekday = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' });

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
    }

    /**
     * Aktualizuje listę podpowiedzi dla filtra trasy/symbolu.
     */
    function updateRouteFilterOptions() {
        if (!routeFilterOptionsEl) return;
        routeFilterOptionsEl.replaceChildren();

        const uniqueCodes = new Set();
        const rows = Array.isArray(state?.monthTable?.rows) ? state.monthTable.rows : [];
        for (const row of rows) {
            const cells = Array.isArray(row?.cells) ? row.cells : [];
            for (const cell of cells) {
                const tokens = Array.isArray(cell?.tokens) ? cell.tokens : [];
                for (const token of tokens) {
                    const code = String(token?.code ?? '').trim();
                    if (code) uniqueCodes.add(code);
                }
            }
        }

        const sortedCodes = Array.from(uniqueCodes);
        sortedCodes.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));

        for (const code of sortedCodes) {
            const opt = document.createElement('option');
            opt.value = code;
            routeFilterOptionsEl.appendChild(opt);
        }
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
                const routeMatch = !routeNeedle || tokenCodes.some(code => normalizeFilterValue(code).includes(routeNeedle));
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

            if (index > 0) {
                const separator = document.createElement('span');
                separator.className = 'schedule-token-separator';
                separator.textContent = '/';
                wrap.appendChild(separator);
            }

            if (kind === 'marker') {
                const marker = document.createElement('span');
                marker.className = 'route-badge route-badge--marker';
                marker.textContent = code;
                const meaning = String(
                    markerMeanings?.[code]
                    ?? markerMeanings?.[String(code || '').toUpperCase()]
                    ?? markerMeanings?.[String(code || '').toLowerCase()]
                    ?? markerMeanings?.[`${String(code || '').slice(0, 1).toUpperCase()}${String(code || '').slice(1).toLowerCase()}`]
                    ?? ''
                ).trim();
                marker.title = meaning || code;
                marker.setAttribute('aria-label', meaning ? `${code}: ${meaning}` : code);
                wrap.appendChild(marker);
                continue;
            }

            const routeAvailable = isRouteAvailable(code);
            const badge = document.createElement('button');
            const category = String(token?.category ?? '').trim();
            badge.type = 'button';
            badge.className = ['route-badge', category ? `route-badge--${category}` : ''].filter(Boolean).join(' ');
            badge.textContent = code;
            badge.title = cellTitle || code;
            badge.dataset.action = 'open-route';
            badge.dataset.isoDate = isoDate;
            badge.dataset.routeCode = code;
            badge.disabled = !routeAvailable;
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
            driverCell.textContent = row.driverName;
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
     * @param {{ scrollToDay?: boolean, scrollBehavior?: ScrollBehavior }} [options]
     */
    function refreshView(options = {}) {
        state.viewModel = applyScheduleFilters();
        syncSelectionState();
        state.viewModel = applyScheduleFilters();
        syncSelectionState();
        renderScheduleToolbar();
        renderScheduleGrid();

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
            refreshView({ scrollToDay: false });
            return;
        }

        if (state.selectedDriverId === nextId) {
            state.selectedDriverId = '';
            state.selectedDriverName = '';
            refreshView({ scrollToDay: false });
            return;
        }

        state.selectedDriverId = nextId;
        state.selectedDriverName = String(driverName || '').trim();
        refreshView({ scrollToDay: false });
    }

    /**
     * Czyści oba filtry toolbaru.
     */
    function clearScheduleFilters() {
        state.driverFilter = '';
        state.routeFilter = '';
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
        state.selectedDriverId = String(safeSnapshot?.selectedDriverId || '').trim();
        state.selectedDriverName = String(safeSnapshot?.selectedDriverName || '').trim();
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
        updateRouteFilterOptions();

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
     * Podpina wszystkie handlery UI.
     */
    function attach() {
        tableHeaderRow?.addEventListener?.('click', handleTableClick);
        tableBody?.addEventListener?.('click', handleTableClick);
        tableBody?.addEventListener?.('keydown', handleDriverKeydown);

        monthSelect?.addEventListener?.('change', () => {
            const key = String(monthSelect.value || '').trim();
            if (key) setMonthByKey(key);
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

        driverFilterInput?.addEventListener?.('input', () => {
            state.driverFilter = String(driverFilterInput.value || '').trim();
            refreshView({ scrollToDay: false });
        });

        routeFilterInput?.addEventListener?.('input', () => {
            state.routeFilter = String(routeFilterInput.value || '').trim();
            refreshView({ scrollToDay: false });
        });

        clearFiltersBtn?.addEventListener?.('click', () => {
            clearScheduleFilters();
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
        scrollToSelectedDay
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
