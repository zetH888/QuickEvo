/**
 * @module schedule-controller
 *
 * @description
 * Kontroler widoku grafiku do swobodnego przeglądania harmonogramu pracy.
 *
 * Widok jest renderowany jako tabela zbliżona do oryginalnego arkusza:
 * - nagłówek: „Kierowca” + kolumny dni (numer dnia / skrót dnia tygodnia),
 * - wiersze: kierowcy w kolejności z pliku grafiku,
 * - komórki: tokeny w kolejności z komórki (trasy i markery), tokeny tras są klikalne.
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
 * Buduje `YYYY-MM-DD` z części liczbowych.
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
 * Sprawdza, czy string ma format ISO `YYYY-MM-DD`.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function coerceIsoDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    return raw;
}

/**
 * Tworzy kontroler widoku grafiku.
 *
 * @param {Object} cfg
 * @param {HTMLElement|null} cfg.scheduleView
 * @param {HTMLTableRowElement|null} cfg.tableHeaderRow
 * @param {HTMLTableSectionElement|null} cfg.tableBody
 * @param {HTMLSelectElement|null} cfg.monthSelect
 * @param {HTMLElement|null} cfg.subtitleEl
 * @param {HTMLButtonElement|null} cfg.prevMonthBtn
 * @param {HTMLButtonElement|null} cfg.nextMonthBtn
 * @param {HTMLButtonElement|null} cfg.todayBtn
 * @param {(year: number, month: number) => ({
 *   year: number,
 *   month: number,
 *   days: { isoDate: string, day: number, weekday: number, isWeekend: boolean }[],
 *   rows: { driverName: string, cells: { isoDate: string, tokens: { kind: 'route'|'marker', code: string, category?: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }[] }[] }[]
 * } | null)} cfg.getMonthScheduleTable
 * @param {Record<string, string>} cfg.markerMeanings
 * @param {(routeCode: string) => boolean} cfg.isRouteAvailable
 * @param {(opts: { routeCode: string, isoDate: string }) => void} cfg.onOpenRoute
 * @param {(key: string, value: string) => void} cfg.storageSet
 * @param {(key: string) => (string|null)} cfg.storageGet
 */
export function createScheduleController(cfg = {}) {
    const scheduleView = cfg?.scheduleView || null;
    const tableHeaderRow = cfg?.tableHeaderRow || null;
    const tableBody = cfg?.tableBody || null;
    const monthSelect = cfg?.monthSelect || null;
    const subtitleEl = cfg?.subtitleEl || null;
    const prevMonthBtn = cfg?.prevMonthBtn || null;
    const nextMonthBtn = cfg?.nextMonthBtn || null;
    const todayBtn = cfg?.todayBtn || null;

    const getMonthScheduleTable = typeof cfg?.getMonthScheduleTable === 'function' ? cfg.getMonthScheduleTable : (() => null);
    const markerMeanings = cfg?.markerMeanings && typeof cfg.markerMeanings === 'object' ? cfg.markerMeanings : {};
    const isRouteAvailable = typeof cfg?.isRouteAvailable === 'function' ? cfg.isRouteAvailable : (() => false);
    const onOpenRoute = typeof cfg?.onOpenRoute === 'function' ? cfg.onOpenRoute : (() => { });
    const storageSet = typeof cfg?.storageSet === 'function' ? cfg.storageSet : (() => { });
    const storageGet = typeof cfg?.storageGet === 'function' ? cfg.storageGet : (() => null);

    const dtfWeekday = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' });
    const dtfMonthLabel = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });

    let current = { year: 0, month: 0, key: '' };
    let selectedIsoDate = null;
    let availableMonths = [];
    let lastMonthTable = null;

    const SELECTED_DAY_STORAGE_PREFIX = 'qe_schedule_selected_iso_';

    function isVisible() {
        return Boolean(scheduleView && !scheduleView.classList.contains('view-hidden'));
    }

    function setSubtitle(text) {
        if (!subtitleEl) return;
        subtitleEl.textContent = String(text ?? '');
    }

    function clearTable() {
        tableHeaderRow?.replaceChildren?.();
        tableBody?.replaceChildren?.();
    }

    function formatDayHeaderParts(isoDate) {
        const iso = coerceIsoDate(isoDate);
        if (!iso) return { weekday: '', date: '' };
        const year = Number(iso.slice(0, 4));
        const month = Number(iso.slice(5, 7));
        const day = Number(iso.slice(8, 10));
        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return { weekday: '', date: '' };
        const d = new Date(year, month - 1, day);
        return {
            weekday: dtfWeekday.format(d),
            date: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`
        };
    }

    /**
     * Zaznacza całą kolumnę dnia (nagłówek + wszystkie komórki), zgodnie z wymaganiem.
     *
     * @param {string} isoDate
     */
    function setSelectedDay(isoDate) {
        const iso = coerceIsoDate(isoDate);
        if (!iso) return;
        selectedIsoDate = iso;
        storageSet(`${SELECTED_DAY_STORAGE_PREFIX}${current.key}`, iso);

        if (tableHeaderRow) {
            const ths = tableHeaderRow.querySelectorAll('[data-iso-date]');
            for (const th of ths) {
                if (!(th instanceof HTMLElement)) continue;
                th.classList.toggle('is-selected-day', String(th.dataset.isoDate || '') === iso);
            }
        }

        if (tableBody) {
            const tds = tableBody.querySelectorAll('[data-iso-date]');
            for (const td of tds) {
                if (!(td instanceof HTMLElement)) continue;
                td.classList.toggle('is-selected-day', String(td.dataset.isoDate || '') === iso);
            }
        }

        const parts = formatDayHeaderParts(iso);
        setSubtitle(`Wybrano: ${parts.weekday} ${parts.date}`);
    }

    function tryRestoreSelectedDay() {
        const stored = storageGet(`${SELECTED_DAY_STORAGE_PREFIX}${current.key}`);
        const iso = coerceIsoDate(stored);
        if (iso) return iso;
        return null;
    }

    function buildMonthSelectOptions() {
        if (!monthSelect) return;
        monthSelect.replaceChildren();

        for (const item of availableMonths) {
            const ym = String(item?.key ?? '');
            const meta = parseYearMonth(ym);
            if (!meta) continue;
            const d = new Date(meta.year, meta.month - 1, 1);
            const opt = document.createElement('option');
            opt.value = meta.key;
            opt.textContent = dtfMonthLabel.format(d);
            if (meta.key === current.key) opt.selected = true;
            monthSelect.appendChild(opt);
        }
    }

    function computePrevNextMonthKey(direction) {
        const idx = availableMonths.findIndex(m => String(m?.key ?? '') === current.key);
        if (idx < 0) return '';
        const nextIdx = idx + (direction < 0 ? -1 : 1);
        if (nextIdx < 0 || nextIdx >= availableMonths.length) return '';
        return String(availableMonths[nextIdx]?.key ?? '');
    }

    function updateMonthNavButtons() {
        if (prevMonthBtn) prevMonthBtn.disabled = !computePrevNextMonthKey(-1);
        if (nextMonthBtn) nextMonthBtn.disabled = !computePrevNextMonthKey(1);
    }

    /**
     * Renderuje zawartość komórki (lista tokenów), zachowując kolejność i separator „/”.
     *
     * @param {HTMLElement} cellEl
     * @param {string} isoDate
     * @param {{ kind: 'route'|'marker', code: string, category?: 'STANDARD'|'WIECZOREK'|'SOBOTA'|'NIEDZIELA' }[]} tokens
     */
    function renderCellTokens(cellEl, isoDate, tokens) {
        const list = Array.isArray(tokens) ? tokens : [];
        if (list.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'schedule-empty';
            empty.textContent = '';
            cellEl.appendChild(empty);
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'schedule-cell-inner';
        for (let i = 0; i < list.length; i++) {
            const tok = list[i];
            const kind = tok?.kind === 'marker' ? 'marker' : 'route';
            const code = String(tok?.code ?? '').trim();
            if (!code) continue;

            if (i > 0) {
                const sep = document.createElement('span');
                sep.className = 'schedule-chip-sep';
                sep.textContent = '/';
                wrap.appendChild(sep);
            }

            if (kind === 'marker') {
                const el = document.createElement('span');
                el.className = 'schedule-chip schedule-chip--marker';
                el.textContent = code;
                const meaning = String(markerMeanings?.[code] ?? '').trim();
                if (meaning) el.title = meaning;
                wrap.appendChild(el);
                continue;
            }

            const isAvailable = isRouteAvailable(code);
            const btn = document.createElement('button');
            const cat = String(tok?.category ?? '').trim();
            btn.className = ['schedule-chip', cat ? `schedule-chip--${cat}` : ''].filter(Boolean).join(' ');
            btn.type = 'button';
            btn.textContent = code;
            btn.disabled = !isAvailable;
            btn.dataset.action = 'open-route';
            btn.dataset.isoDate = isoDate;
            btn.dataset.routeCode = code;
            btn.setAttribute('aria-label', isAvailable
                ? `Otwórz trasę ${code} dla dnia ${isoDate}`
                : `Trasa ${code} nie jest dostępna w bazie`);
            wrap.appendChild(btn);
        }
        cellEl.appendChild(wrap);
    }

    function renderTable(monthTable) {
        if (!monthTable || !Array.isArray(monthTable.days) || !Array.isArray(monthTable.rows)) return;
        if (!tableHeaderRow || !tableBody) return;
        clearTable();

        const thDriver = document.createElement('th');
        thDriver.textContent = 'Kierowca';
        tableHeaderRow.appendChild(thDriver);

        for (const d of monthTable.days) {
            const iso = coerceIsoDate(d?.isoDate);
            if (!iso) continue;
            const parts = formatDayHeaderParts(iso);

            const th = document.createElement('th');
            th.dataset.isoDate = iso;
            th.classList.toggle('is-weekend', Boolean(d?.isWeekend));

            const btn = document.createElement('button');
            btn.className = 'schedule-day-header-btn';
            btn.type = 'button';
            btn.dataset.action = 'select-day';
            btn.dataset.isoDate = iso;
            btn.innerHTML = `<span class="schedule-day-number">${String(d?.day ?? '')}</span><span class="schedule-day-weekday">${parts.weekday}</span>`;
            th.appendChild(btn);
            tableHeaderRow.appendChild(th);
        }

        const frag = document.createDocumentFragment();
        for (const r of monthTable.rows) {
            const tr = document.createElement('tr');

            const tdName = document.createElement('td');
            tdName.textContent = String(r?.driverName ?? '');
            tr.appendChild(tdName);

            const cells = Array.isArray(r?.cells) ? r.cells : [];
            for (let i = 0; i < cells.length; i++) {
                const c = cells[i];
                const iso = coerceIsoDate(c?.isoDate);
                const td = document.createElement('td');
                td.className = 'schedule-cell';
                if (iso) td.dataset.isoDate = iso;
                const dayMeta = monthTable.days[i];
                td.classList.toggle('is-weekend', Boolean(dayMeta?.isWeekend));
                renderCellTokens(td, iso || '', Array.isArray(c?.tokens) ? c.tokens : []);
                tr.appendChild(td);
            }

            frag.appendChild(tr);
        }

        tableBody.appendChild(frag);

        const restored = tryRestoreSelectedDay();
        const fallbackIso = restored || (monthTable.days.length > 0 ? monthTable.days[0].isoDate : null);
        if (fallbackIso) setSelectedDay(fallbackIso);
    }

    function renderMonthDays({ year, month } = {}) {
        const y = Number(year);
        const m = Number(month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return;
        const key = `${y}-${String(m).padStart(2, '0')}`;
        current = { year: y, month: m, key };

        buildMonthSelectOptions();
        updateMonthNavButtons();
        clearTable();

        const table = getMonthScheduleTable(y, m);
        lastMonthTable = table;
        if (!table) {
            setSubtitle('Brak danych grafiku dla wybranego miesiąca.');
            if (tableHeaderRow) {
                const th = document.createElement('th');
                th.textContent = 'Kierowca';
                tableHeaderRow.appendChild(th);
            }
            if (tableBody) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.className = 'schedule-empty';
                td.textContent = 'Nie znaleziono wczytanego pliku grafiku dla tego miesiąca.';
                tr.appendChild(td);
                tableBody.appendChild(tr);
            }
            return;
        }

        setSubtitle('Kliknij dzień w nagłówku, aby zaznaczyć całą kolumnę.');
        renderTable(table);
    }

    function setAvailableMonthsList(list) {
        const src = Array.isArray(list) ? list : [];
        const normalized = src
            .map(x => String(x ?? '').trim())
            .map(k => parseYearMonth(k)?.key || '')
            .filter(Boolean);
        const unique = Array.from(new Set(normalized));
        unique.sort((a, b) => String(a).localeCompare(String(b), 'pl', { sensitivity: 'base' }));
        availableMonths = unique.map(key => Object.freeze({ key }));
        buildMonthSelectOptions();
        updateMonthNavButtons();
    }

    function setMonthByKey(ym) {
        const meta = parseYearMonth(ym);
        if (!meta) return;
        renderMonthDays({ year: meta.year, month: meta.month });
    }

    function goToday() {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (availableMonths.some(m => m.key === ym)) {
            setMonthByKey(ym);
            const iso = buildIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
            if (iso) setSelectedDay(iso);
            return;
        }
        const fallback = availableMonths.length > 0 ? availableMonths[availableMonths.length - 1].key : '';
        if (fallback) setMonthByKey(fallback);
    }

    function handleTableClick(e) {
        const target = e?.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest('[data-action]');
        if (!(btn instanceof HTMLElement)) return;
        const action = String(btn.dataset.action || '');
        if (action === 'select-day') {
            const iso = btn.dataset.isoDate;
            if (iso) setSelectedDay(iso);
            return;
        }
        if (action === 'open-route') {
            const routeCode = String(btn.dataset.routeCode || '').trim();
            const iso = String(btn.dataset.isoDate || '').trim();
            if (!routeCode || !iso) return;
            setSelectedDay(iso);
            onOpenRoute({ routeCode, isoDate: iso });
        }
    }

    function attach() {
        tableHeaderRow?.addEventListener?.('click', handleTableClick);
        tableBody?.addEventListener?.('click', handleTableClick);

        monthSelect?.addEventListener?.('change', () => {
            const key = String(monthSelect.value || '').trim();
            if (key) setMonthByKey(key);
        });

        prevMonthBtn?.addEventListener?.('click', () => {
            const key = computePrevNextMonthKey(-1);
            if (key) setMonthByKey(key);
        });

        nextMonthBtn?.addEventListener?.('click', () => {
            const key = computePrevNextMonthKey(1);
            if (key) setMonthByKey(key);
        });

        todayBtn?.addEventListener?.('click', () => goToday());
    }

    attach();

    return Object.freeze({
        isVisible,
        setAvailableMonthsList,
        setMonthByKey,
        renderMonthDays,
        setSelectedDay,
        goToday
    });
}
