/**
 * @module features/search/search-results-sort
 *
 * @description
 * Funkcje sortowania grup wyników wyszukiwania (tras) dla UI.
 * Sortowanie nie zmienia kolejności sekcji (kategorii) — wpływa wyłącznie na kolejność grup wewnątrz sekcji.
 */

export const SEARCH_RESULTS_SORT_MODE_ALPHANUM = 'alphanum';
export const SEARCH_RESULTS_SORT_MODE_TIME = 'time';

/**
 * Oblicza liczbę minut do kolejnego wystąpienia godziny `targetMinutes`, licząc od `nowMinutes`.
 * Zasada: zawsze wybieramy „następny” moment w przyszłości (dziś lub kolejny dzień).
 *
 * Przykład:
 * - now=20:51 (1251), target=08:00 (480) => delta=669 (11h09)
 * - now=13:30 (810), target=13:25 (805) => delta=1435 (następny dzień)
 *
 * @param {number} targetMinutes
 * @param {number} nowMinutes
 * @returns {number}
 */
function computeNextOccurrenceDeltaMinutes(targetMinutes, nowMinutes) {
    const target = Number(targetMinutes);
    const now = Number(nowMinutes);
    if (!Number.isFinite(target) || !Number.isFinite(now)) return Number.POSITIVE_INFINITY;
    const day = 24 * 60;
    const raw = (target - now) % day;
    return (raw + day) % day;
}

/**
 * Parsuje zapis godziny w formacie HH:MM do liczby minut od północy.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parseTimeToMinutes(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const m = raw.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
}

/**
 * Wyciąga minutę dnia dla rekordu (wiersza) w grupie wyników.
 *
 * @param {any} item
 * @returns {number|null}
 */
function extractItemTimeMinutes(item) {
    if (item?.isComplete && item?.headerMap && Array.isArray(item?.cells)) {
        const idx = Number(item.headerMap.GODZ);
        if (Number.isInteger(idx) && idx >= 0 && idx < item.cells.length) {
            const parsed = parseTimeToMinutes(item.cells[idx]);
            if (parsed != null) return parsed;
        }
    }
    const displayText = String(item?.displayText ?? '');
    const firstPart = displayText.split('|')[0];
    const parsedFirst = parseTimeToMinutes(firstPart);
    if (parsedFirst != null) return parsedFirst;
    const parsedAny = parseTimeToMinutes(displayText);
    return parsedAny;
}

/**
 * Oblicza metrykę sortowania czasowego dla grupy:
 * - Kluczem jest „najwcześniejsza następna godzina” w grupie (najmniejsza liczba minut do przyszłego wystąpienia).
 * - Godziny wcześniejsze niż bieżąca są traktowane jako godziny z następnego dnia.
 *
 * Uwaga: brak dodatkowej reguły preferowania „późniejszej godziny” przy remisie.
 *
 * @param {any} group
 * @param {Date} now
 * @returns {{ key: number, hitMinutes: number|null }}
 */
function computeGroupClosestTimeHit(group, now) {
    const items = Array.isArray(group?.items) ? group.items : [];
    const nowMinutes = (Number(now?.getHours?.()) || 0) * 60 + (Number(now?.getMinutes?.()) || 0);

    let bestKey = Number.POSITIVE_INFINITY;
    let bestHit = null;

    for (const item of items) {
        const mins = extractItemTimeMinutes(item);
        if (mins == null) continue;
        const key = computeNextOccurrenceDeltaMinutes(mins, nowMinutes);
        if (key < bestKey) {
            bestKey = key;
            bestHit = mins;
        }
    }

    return { key: bestKey, hitMinutes: bestHit };
}

/**
 * Sortuje wiersze (trafienia) w grupie tak, aby na górze znajdowały się te, które wystąpią najwcześniej „następnym razem”.
 * Wiersze bez godziny (np. '-') trafiają na koniec, zachowując kolejność wejściową.
 *
 * @param {Array<any>} items
 * @param {Date} now
 * @returns {Array<any>}
 */
function sortGroupItemsByNextTime(items, now) {
    const list = Array.isArray(items) ? items.slice() : [];
    if (list.length <= 1) return list;
    const nowMinutes = (Number(now?.getHours?.()) || 0) * 60 + (Number(now?.getMinutes?.()) || 0);

    const meta = list.map((item, index) => {
        const mins = extractItemTimeMinutes(item);
        const delta = mins == null ? Number.POSITIVE_INFINITY : computeNextOccurrenceDeltaMinutes(mins, nowMinutes);
        return { item, index, delta };
    });

    meta.sort((a, b) => {
        if (a.delta !== b.delta) return a.delta - b.delta;
        return a.index - b.index;
    });

    return meta.map(m => m.item);
}

/**
 * Sortuje grupy wyników wyszukiwania (tras) wg wybranego trybu.
 *
 * @param {Array<any>} groups
 * @param {{
 *   mode?: string,
 *   now?: Date,
 *   formatRouteNameForResults?: (fileName: string) => string
 * }} opts
 * @returns {Array<any>}
 */
export function sortSearchResultGroups(groups, opts = {}) {
    const list = Array.isArray(groups) ? groups.slice() : [];
    const mode = String(opts?.mode || SEARCH_RESULTS_SORT_MODE_ALPHANUM);
    const now = opts?.now instanceof Date ? opts.now : new Date();
    const formatRouteNameForResults = typeof opts?.formatRouteNameForResults === 'function'
        ? opts.formatRouteNameForResults
        : (fileName) => String(fileName || '');

    const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

    const getSortLabel = (group) => formatRouteNameForResults(String(group?.fileName || ''));
    const getSortCode = (group) => {
        const label = getSortLabel(group);
        const withoutPrefix = label.replace(/^trasa\s+/i, '').trim();
        return withoutPrefix || label;
    };
    /**
     * Określa priorytet sortowania dla kodu trasy.
     * W trybie alfanumerycznym preferujemy najpierw kody zaczynające się od cyfr (np. 1, 2, 11, 12/H),
     * a dopiero potem kody zaczynające się od liter (np. I, J, O, S-5).
     *
     * @param {string} code
     * @returns {number}
     */
    const getAlphanumSortBucket = (code) => {
        const c = String(code || '').trim();
        if (!c) return 2;
        if (/^\d/.test(c)) return 0;
        if (/^[A-Za-zĄĆĘŁŃÓŚŹŻ]/.test(c)) return 1;
        return 2;
    };

    if (mode === SEARCH_RESULTS_SORT_MODE_TIME) {
        const meta = new Map();
        for (const g of list) {
            const timeMeta = computeGroupClosestTimeHit(g, now);
            const sortedItems = sortGroupItemsByNextTime(Array.isArray(g?.items) ? g.items : [], now);
            meta.set(g, { key: timeMeta.key, group: { ...g, items: sortedItems } });
        }

        const sortedGroups = list.slice().sort((a, b) => {
            const ma = meta.get(a) || { key: Number.POSITIVE_INFINITY };
            const mb = meta.get(b) || { key: Number.POSITIVE_INFINITY };
            if (ma.key !== mb.key) return ma.key - mb.key;
            return collator.compare(getSortLabel(a), getSortLabel(b));
        });

        return sortedGroups.map((g) => (meta.get(g)?.group ?? g));
    }

    list.sort((a, b) => {
        const la = getSortCode(a);
        const lb = getSortCode(b);
        const ba = getAlphanumSortBucket(la);
        const bb = getAlphanumSortBucket(lb);
        if (ba !== bb) return ba - bb;
        return collator.compare(la, lb);
    });

    return list;
}
