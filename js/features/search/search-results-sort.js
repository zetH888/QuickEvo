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
 * Parsuje zapis godziny w formacie HH:MM do liczby minut od północy.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseTimeToMinutes(value) {
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
export function extractItemTimeMinutes(item) {
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
 * Oblicza metrykę sortowania czasowego dla grupy.
 *
 * Zasady:
 * - Przed 20:00: kluczem jest minimalna odległość od aktualnej godziny (najbliżej teraz).
 * - Od 20:00: kluczem jest najwcześniejsza godzina z grupy (poranek następnego dnia).
 *
 * Uwaga: nie ma dodatkowej reguły preferującej „późniejszą godzinę” przy remisie.
 *
 * @param {any} group
 * @param {Date} now
 * @returns {{ key: number, hitMinutes: number|null }}
 */
export function computeGroupClosestTimeHit(group, now) {
    const items = Array.isArray(group?.items) ? group.items : [];
    const nowMinutes = (Number(now?.getHours?.()) || 0) * 60 + (Number(now?.getMinutes?.()) || 0);
    const isAfterCutoff = nowMinutes >= (20 * 60);

    let bestKey = Number.POSITIVE_INFINITY;
    let bestHit = null;

    for (const item of items) {
        const mins = extractItemTimeMinutes(item);
        if (mins == null) continue;
        const key = isAfterCutoff ? mins : Math.abs(mins - nowMinutes);
        if (key < bestKey) {
            bestKey = key;
            bestHit = mins;
        }
    }

    return { key: bestKey, hitMinutes: bestHit };
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
    const hasLetters = (s) => /[A-Za-zĄĆĘŁŃÓŚŹŻ]/.test(String(s || ''));
    const hasDigits = (s) => /\d/.test(String(s || ''));

    if (mode === SEARCH_RESULTS_SORT_MODE_TIME) {
        const meta = new Map();
        for (const g of list) meta.set(g, computeGroupClosestTimeHit(g, now));

        list.sort((a, b) => {
            const ma = meta.get(a) || { key: Number.POSITIVE_INFINITY };
            const mb = meta.get(b) || { key: Number.POSITIVE_INFINITY };
            if (ma.key !== mb.key) return ma.key - mb.key;
            return collator.compare(getSortLabel(a), getSortLabel(b));
        });
        return list;
    }

    list.sort((a, b) => {
        const la = getSortCode(a);
        const lb = getSortCode(b);
        const aHasL = hasLetters(la);
        const bHasL = hasLetters(lb);
        if (aHasL !== bHasL) return aHasL ? -1 : 1;
        const aHasD = hasDigits(la);
        const bHasD = hasDigits(lb);
        if (aHasD && bHasD) return collator.compare(la, lb);
        if (aHasD !== bHasD) return aHasD ? -1 : 1;
        return collator.compare(la, lb);
    });

    return list;
}
