import { fuzzyNormalizeText } from '../../core/utils.js';

const PREDICT_MIN_CHARS = 2;
const PREDICT_MAX_VARIANTS = 8;

/**
 * Rozszerza popularne skróty adresowe dla predykcji (ul./pl./al./os.).
 *
 * @param {string} text
 * @returns {string}
 */
function expandPredictiveAbbreviations(text) {
    const raw = String(text ?? '');
    if (!raw) return '';
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t) return '';

    const replaceWord = (src, re, next) => src.replace(re, `$1${next}$2`);
    let out = t;
    out = replaceWord(out, /(^|\s)(ul)\.?(?=\s|$)/gi, 'ulica');
    out = replaceWord(out, /(^|\s)(pl)\.?(?=\s|$)/gi, 'plac');
    out = replaceWord(out, /(^|\s)(al)\.?(?=\s|$)/gi, 'aleja');
    out = replaceWord(out, /(^|\s)(os)\.?(?=\s|$)/gi, 'osiedle');
    return out;
}

/**
 * Normalizacja rozmyta dla predykcji (z obsługą skrótów).
 *
 * @param {unknown} text
 * @returns {string}
 */
function predictiveFuzzyNormalizeText(text) {
    return fuzzyNormalizeText(expandPredictiveAbbreviations(String(text ?? '')));
}

/**
 * @param {Map<string, { value: string, count: number }>} map
 * @param {unknown} rawValue
 */
function addPredictiveValue(map, rawValue) {
    const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const key = predictiveFuzzyNormalizeText(value);
    if (!key) return;
    const prev = map.get(key);
    if (!prev) map.set(key, { value, count: 1 });
    else prev.count += 1;
}

/**
 * Dodaje wartość oraz warianty sufiksowe (od kolejnych tokenów).
 *
 * @param {Map<string, { value: string, count: number }>} map
 * @param {unknown} rawValue
 */
function addPredictiveValueWithVariants(map, rawValue) {
    const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    addPredictiveValue(map, value);

    const tokenRe = /[^\s,.;:/\\\-–—()]+/g;
    const matches = Array.from(value.matchAll(tokenRe));
    if (matches.length <= 1) return;

    let added = 0;
    for (let i = 1; i < matches.length && added < PREDICT_MAX_VARIANTS; i++) {
        const idx = matches[i]?.index;
        if (typeof idx !== 'number' || idx < 0) continue;
        const phrase = value.slice(idx).trimStart();
        if (phrase.length < PREDICT_MIN_CHARS) continue;
        addPredictiveValue(map, phrase);
        added += 1;
    }
}

/**
 * Zamienia Mapę w listę wpisów możliwą do przesłania przez postMessage.
 *
 * Format wpisu: [fuzzyKey, value, count]
 *
 * @param {Map<string, { value: string, count: number }>} map
 * @returns {Array<[string, string, number]>}
 */
function toTransferEntries(map) {
    const out = [];
    for (const [k, v] of map.entries()) {
        const key = String(k || '').trim();
        const value = String(v?.value || '').trim();
        const count = Math.max(0, Number(v?.count || 0));
        if (!key || !value || !Number.isFinite(count) || count <= 0) continue;
        out.push([key, value, count]);
    }
    return out;
}

/**
 * @param {any} data
 */
function handleRebuild(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    const perFile = new Map();
    const ensure = (fileName) => {
        const fn = String(fileName || '').trim();
        if (!fn) return null;
        let e = perFile.get(fn);
        if (!e) {
            e = { address: new Map(), facility: new Map() };
            perFile.set(fn, e);
        }
        return e;
    };

    for (const r of rows) {
        const entry = ensure(r?.fileName);
        if (!entry) continue;
        const address = String(r?.address || '').trim();
        const facility = String(r?.facility || '').trim();
        if (address) addPredictiveValueWithVariants(entry.address, address);
        if (facility) addPredictiveValueWithVariants(entry.facility, facility);
    }

    const importedAt = Date.now();
    const payloads = [];
    for (const [fileName, e] of perFile.entries()) {
        payloads.push({
            sourceId: fileName,
            importedAt,
            byType: {
                address: toTransferEntries(e.address),
                facility: toTransferEntries(e.facility)
            }
        });
    }
    return payloads;
}

self.onmessage = (evt) => {
    const msg = evt?.data || {};
    const op = String(msg?.op || '');
    if (op !== 'rebuild') return;

    const seq = Number(msg?.seq || 0);
    try {
        const payloads = handleRebuild(msg);
        self.postMessage({ op: 'rebuild_done', seq, payloads });
    } catch (err) {
        self.postMessage({ op: 'rebuild_error', seq, message: err?.message ? String(err.message) : 'Błąd' });
    }
};
