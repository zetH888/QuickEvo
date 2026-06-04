import { createPredictiveTrieIndex } from './predictive-trie-index.js';

const PREDICT_MIN_CHARS = 2;
const PREDICT_MAX_OPTIONS = 14;
const PREDICT_BUCKET_PREFIX_LEN = 2;

const PREDICT_INDEX_MODE = Object.freeze({
    buckets: 'buckets',
    trie: 'trie'
});

const PREDICT_TYPE_WEIGHT = Object.freeze({
    address: 330,
    facility: 300,
    route: 270
});

const PREDICT_MATCH_WEIGHT = Object.freeze({
    exactPrefix: 250,
    exactWord: 200,
    caseInsensitivePrefix: 150,
    substring: 50,
    fuzzy: 20
});

function getLevenshteinDistance(a, b) {
    const s1 = String(a ?? '');
    const s2 = String(b ?? '');
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;
    const matrix = [];
    for (let i = 0; i <= s2.length; i++) matrix[i] = [i];
    for (let j = 0; j <= s1.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= s2.length; i++) {
        for (let j = 1; j <= s1.length; j++) {
            if (s2.charAt(i - 1) === s1.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    return matrix[s2.length][s1.length];
}

function getFuzzyScore(query, text) {
    const q = String(query ?? '');
    const t = String(text ?? '');
    const distance = getLevenshteinDistance(q, t);
    const maxLength = Math.max(q.length, t.length);
    return maxLength === 0 ? 1.0 : 1.0 - (distance / maxLength);
}

function safeClearCache(cache) {
    try { cache?.clear?.(); return; } catch { }
    if (!cache || typeof cache !== 'object') return;
    try {
        if (typeof cache.set === 'function') {
            for (const k of Array.from(cache.keys?.() ?? [])) { try { cache.set(k, undefined); } catch { } }
        }
    } catch { }
}

export function createSearchOrchestrator(cfg = {}) {
    const getAllData = typeof cfg?.getAllData === 'function' ? cfg.getAllData : (() => []);
    const searchEngine = cfg?.searchEngine || null;
    const searchCache = cfg?.searchCache || null;
    const predictiveSuggestionsCache = cfg?.predictiveSuggestionsCache || null;
    const getRouteCategoriesFromFileName = typeof cfg?.getRouteCategoriesFromFileName === 'function' ? cfg.getRouteCategoriesFromFileName : (() => []);
    const formatRouteNameForResults = typeof cfg?.formatRouteNameForResults === 'function' ? cfg.formatRouteNameForResults : ((x) => String(x || ''));
    const normalizeText = typeof cfg?.normalizeText === 'function' ? cfg.normalizeText : ((t) => String(t ?? '').toLowerCase());
    const fuzzyNormalizeText = typeof cfg?.fuzzyNormalizeText === 'function' ? cfg.fuzzyNormalizeText : ((t) => String(t ?? '').toLowerCase());
    const logAction = typeof cfg?.logAction === 'function' ? cfg.logAction : (() => { });
    const getPredictiveAcceptCount = typeof cfg?.getPredictiveAcceptCount === 'function'
        ? cfg.getPredictiveAcceptCount
        : (() => 0);

    /**
     * Tryb indeksu predykcyjnego:
     * - buckets: dotychczasowy mechanizm (bucketing po 2 znaki)
     * - trie: nowe Trie (przygotowane do aktualizacji inkrementalnych; domyślnie wyłączone)
     *
     * @type {'buckets'|'trie'}
     */
    const predictiveIndexMode = cfg?.predictiveIndexMode === PREDICT_INDEX_MODE.trie ? PREDICT_INDEX_MODE.trie : PREDICT_INDEX_MODE.buckets;

    let predictiveIndex = null;
    let predictiveIndexBuildTimer = null;

    /**
     * Konfiguracja rebuildu w Web Workerze.
     * W trybie Trie stary indeks pozostaje aktywny aż do zakończenia rebuildu i podmiany (swap).
     *
     * @type {boolean}
     */
    const enablePredictiveWorker = cfg?.enablePredictiveWorker !== false;

    /**
     * @type {Worker|null}
     */
    let predictiveWorker = null;

    /**
     * @type {number}
     */
    let predictiveWorkerSeq = 0;

    /**
     * @type {number|null}
     */
    let predictiveWorkerActiveSeq = null;

    /**
     * @type {boolean}
     */
    let predictiveWorkerBusy = false;

    /**
     * @type {string|null}
     */
    let predictiveWorkerPendingReason = null;

    /**
     * Rozszerza popularne skróty adresowe (dla predykcji), aby:
     * - „ul.” i „ul” dopasowywały się do „ulica”
     * - „pl.” i „pl” dopasowywały się do „plac”
     * - „al.” i „al” dopasowywały się do „aleja”
     * - „os.” i „os” dopasowywały się do „osiedle”
     *
     * Uwaga: działa wyłącznie w obrębie predykcji i nie zmienia globalnego `fuzzyNormalizeText`.
     *
     * @param {string} text
     * @returns {string}
     */
    function expandPredictiveAbbreviations(text) {
        const raw = String(text ?? '');
        if (!raw) return '';
        const t = raw
            .replace(/[.]/g, '.')
            .replace(/\s+/g, ' ')
            .trim();
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
     * Normalizacja rozmyta dla predykcji: dodatkowo uwzględnia skróty (ul./pl./al./os.).
     *
     * @param {unknown} text
     * @returns {string}
     */
    function predictiveFuzzyNormalizeText(text) {
        const expanded = expandPredictiveAbbreviations(String(text ?? ''));
        return fuzzyNormalizeText(expanded);
    }

    /**
     * Zapewnia istnienie indeksu Trie (tworzy pusty, gdy jeszcze nie istnieje).
     * To pozwala wykonywać aktualizacje inkrementalne zanim zostanie wykonany pełny rebuild.
     *
     * @returns {any}
     */
    function ensureTrieIndex() {
        if (predictiveIndex?.mode === PREDICT_INDEX_MODE.trie && predictiveIndex?.trieIndex) return predictiveIndex.trieIndex;
        const trieIndex = createPredictiveTrieIndex({
            fuzzyNormalizeText: predictiveFuzzyNormalizeText,
            now: () => Date.now(),
            minChars: PREDICT_MIN_CHARS,
            maxCandidatesPerType: 420,
            typeWeights: PREDICT_TYPE_WEIGHT
        });
        predictiveIndex = {
            builtAt: Date.now(),
            reason: 'init_trie',
            mode: PREDICT_INDEX_MODE.trie,
            trieIndex
        };
        return trieIndex;
    }

    /**
     * Aktualizuje wkład źródła (np. pliku) w indeksie Trie.
     * Metoda jest bezpieczna do wywoływania wielokrotnie dla tego samego sourceId.
     *
     * @param {string} sourceId
     * @param {any} payload
     */
    function upsertPredictiveSource(sourceId, payload) {
        if (predictiveIndexMode !== PREDICT_INDEX_MODE.trie) return;
        const id = String(sourceId || '').trim();
        if (!id) return;
        const trieIndex = ensureTrieIndex();
        trieIndex.upsertSource(id, payload);
        safeClearCache(predictiveSuggestionsCache);
    }

    /**
     * Usuwa wkład źródła (np. po usunięciu pliku) z indeksu Trie.
     *
     * @param {string} sourceId
     */
    function removePredictiveSource(sourceId) {
        if (predictiveIndexMode !== PREDICT_INDEX_MODE.trie) return;
        const id = String(sourceId || '').trim();
        if (!id) return;
        const trieIndex = ensureTrieIndex();
        trieIndex.removeSource(id);
        safeClearCache(predictiveSuggestionsCache);
    }

    /**
     * @returns {number}
     */
    function getPredictiveSourcesCount() {
        if (predictiveIndexMode !== PREDICT_INDEX_MODE.trie) return 0;
        const idx = predictiveIndex?.trieIndex;
        if (!idx?.getStats) return 0;
        try { return Number(idx.getStats()?.sources) || 0; } catch { return 0; }
    }

    function addPredictiveValue(map, rawValue) {
        const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
        if (!value) return;
        const key = predictiveFuzzyNormalizeText(value);
        if (!key) return;
        const prev = map.get(key);
        if (!prev) map.set(key, { value, count: 1 });
        else prev.count += 1;
    }

    function addPredictiveValueWithVariants(map, rawValue) {
        const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
        if (!value) return;
        addPredictiveValue(map, value);

        const tokenRe = /[^\s,.;:/\\\-–—()]+/g;
        const matches = Array.from(value.matchAll(tokenRe));
        if (matches.length <= 1) return;

        const maxVariants = 8;
        let added = 0;
        for (let i = 1; i < matches.length && added < maxVariants; i++) {
            const idx = matches[i]?.index;
            if (typeof idx !== 'number' || idx < 0) continue;
            const phrase = value.slice(idx).trimStart();
            if (phrase.length < PREDICT_MIN_CHARS) continue;
            addPredictiveValue(map, phrase);
            added += 1;
        }
    }

    function buildPredictiveBuckets(map, type) {
        const bucketMaps = new Map();

        const addToBucket = (bucketKey, cand) => {
            const key = String(bucketKey || '').slice(0, PREDICT_BUCKET_PREFIX_LEN);
            if (!key) return;
            let inner = bucketMaps.get(key);
            if (!inner) { inner = new Map(); bucketMaps.set(key, inner); }
            inner.set(cand.fuzzy, cand);
        };

        for (const [fuzzy, meta] of map.entries()) {
            const baseFuzzy = String(fuzzy || '');
            if (!baseFuzzy) continue;
            const cand = { type, value: meta.value, fuzzy, count: meta.count };
            addToBucket(baseFuzzy, cand);

            const tokens = baseFuzzy.split(/[\s,.;:/\\\-–—()]+/g).filter(t => t.length >= PREDICT_MIN_CHARS);
            for (const t of tokens) addToBucket(t, cand);
        }

        const buckets = new Map();
        for (const [k, inner] of bucketMaps.entries()) {
            const list = Array.from(inner.values());
            list.sort((a, b) => (b.count - a.count) || String(a.value).localeCompare(String(b.value), 'pl', { sensitivity: 'base' }));
            buckets.set(k, list);
        }
        return buckets;
    }

    function rebuildPredictiveIndex({ reason } = {}) {
        if (predictiveIndexMode === PREDICT_INDEX_MODE.trie) {
            rebuildPredictiveIndexTrie({ reason });
            return;
        }
        const addressMap = new Map();
        const facilityMap = new Map();

        for (const item of (Array.isArray(getAllData()) ? getAllData() : [])) {
            if (!item?.isComplete || !item?.headerMap || !Array.isArray(item?.cells)) continue;
            const h = item.headerMap;

            const address = String(item.cells[h.ADRES] || '').trim();
            if (address) addPredictiveValueWithVariants(addressMap, address);

            const facility = String(item.cells[h.NAZWA_PLACOWKI] || '').trim();
            if (facility) addPredictiveValueWithVariants(facilityMap, facility);
        }

        predictiveIndex = {
            builtAt: Date.now(),
            reason: String(reason || ''),
            buckets: {
                address: buildPredictiveBuckets(addressMap, 'address'),
                facility: buildPredictiveBuckets(facilityMap, 'facility'),
                route: new Map()
            }
        };
        safeClearCache(predictiveSuggestionsCache);
    }

    function rebuildPredictiveIndexTrie({ reason } = {}) {
        if (enablePredictiveWorker && typeof Worker !== 'undefined' && typeof URL !== 'undefined') {
            rebuildPredictiveIndexTrieInWorker({ reason });
            return;
        }
        const trieIndex = createPredictiveTrieIndex({
            fuzzyNormalizeText: predictiveFuzzyNormalizeText,
            now: () => Date.now(),
            minChars: PREDICT_MIN_CHARS,
            maxCandidatesPerType: 420,
            typeWeights: PREDICT_TYPE_WEIGHT
        });

        const perFile = new Map();

        const ensureFileEntry = (fileName) => {
            const fn = String(fileName || '').trim();
            if (!fn) return null;
            let entry = perFile.get(fn);
            if (!entry) {
                entry = { address: new Map(), facility: new Map() };
                perFile.set(fn, entry);
            }
            return entry;
        };

        for (const item of (Array.isArray(getAllData()) ? getAllData() : [])) {
            const safeFileName = String(item?.fileName || '').trim();
            const entry = ensureFileEntry(safeFileName);
            if (!entry) continue;

            if (!item?.isComplete || !item?.headerMap || !Array.isArray(item?.cells)) continue;
            const h = item.headerMap;

            const address = String(item.cells[h.ADRES] || '').trim();
            if (address) addPredictiveValueWithVariants(entry.address, address);

            const facility = String(item.cells[h.NAZWA_PLACOWKI] || '').trim();
            if (facility) addPredictiveValueWithVariants(entry.facility, facility);
        }

        for (const [fn, entry] of perFile.entries()) {
            trieIndex.upsertSource(fn, {
                importedAt: Date.now(),
                byType: { address: entry.address, facility: entry.facility }
            });
        }

        predictiveIndex = {
            builtAt: Date.now(),
            reason: String(reason || ''),
            mode: PREDICT_INDEX_MODE.trie,
            trieIndex
        };
        safeClearCache(predictiveSuggestionsCache);
    }

    /**
     * Pełny rebuild indeksu Trie w Web Workerze:
     * - przenosi generowanie map (wraz z wariantami) poza główny wątek,
     * - utrzymuje stary indeks aktywny do czasu zakończenia budowy,
     * - po zakończeniu tworzy nowy Trie i podmienia go atomowo.
     *
     * @param {{ reason?: string }} [opts]
     */
    function rebuildPredictiveIndexTrieInWorker({ reason } = {}) {
        const r = String(reason || '');
        if (predictiveWorkerBusy) {
            predictiveWorkerPendingReason = r || 'unknown';
            return;
        }

        if (!predictiveWorker) {
            try {
                predictiveWorker = new Worker(new URL('./predictive-index-worker.js', import.meta.url), { type: 'module' });
                predictiveWorker.onmessage = (evt) => {
                    const msg = evt?.data || {};
                    const op = String(msg?.op || '');
                    const seq = Number(msg?.seq || 0);
                    if (predictiveWorkerActiveSeq !== seq) return;

                    if (op === 'rebuild_error') {
                        predictiveWorkerBusy = false;
                        predictiveWorkerActiveSeq = null;
                        logAction('predictive', { phase: 'worker_rebuild_error', message: String(msg?.message || 'Błąd') }, 'WARN');
                        const pending = predictiveWorkerPendingReason;
                        predictiveWorkerPendingReason = null;
                        if (pending) rebuildPredictiveIndexTrieInWorker({ reason: pending });
                        return;
                    }

                    if (op !== 'rebuild_done') return;
                    const payloads = Array.isArray(msg?.payloads) ? msg.payloads : [];
                    try {
                        const trieIndex = createPredictiveTrieIndex({
                            fuzzyNormalizeText: predictiveFuzzyNormalizeText,
                            now: () => Date.now(),
                            minChars: PREDICT_MIN_CHARS,
                            maxCandidatesPerType: 420,
                            typeWeights: PREDICT_TYPE_WEIGHT
                        });

                        for (const p of payloads) {
                            const sourceId = String(p?.sourceId || '').trim();
                            if (!sourceId) continue;
                            const byType = p?.byType || {};

                            const toMap = (entries) => {
                                const map = new Map();
                                for (const row of (Array.isArray(entries) ? entries : [])) {
                                    const k = String(row?.[0] || '').trim();
                                    const v = String(row?.[1] || '').trim();
                                    const c = Math.max(0, Number(row?.[2] || 0));
                                    if (!k || !v || !Number.isFinite(c) || c <= 0) continue;
                                    map.set(k, { value: v, count: c });
                                }
                                return map;
                            };

                            trieIndex.upsertSource(sourceId, {
                                importedAt: Number(p?.importedAt || Date.now()),
                                byType: {
                                    address: toMap(byType.address),
                                    facility: toMap(byType.facility)
                                }
                            });
                        }

                        predictiveIndex = {
                            builtAt: Date.now(),
                            reason: r,
                            mode: PREDICT_INDEX_MODE.trie,
                            trieIndex
                        };
                        safeClearCache(predictiveSuggestionsCache);
                        logAction('predictive', { phase: 'worker_rebuild_done', mode: 'trie', sources: trieIndex.getStats?.()?.sources || 0 }, 'INFO');
                    } catch (err) {
                        logAction('predictive', { phase: 'worker_rebuild_apply_failed', message: err?.message ? String(err.message) : 'Błąd' }, 'WARN');
                    } finally {
                        predictiveWorkerBusy = false;
                        predictiveWorkerActiveSeq = null;
                        const pending = predictiveWorkerPendingReason;
                        predictiveWorkerPendingReason = null;
                        if (pending) rebuildPredictiveIndexTrieInWorker({ reason: pending });
                    }
                };
                predictiveWorker.onerror = (err) => {
                    predictiveWorkerBusy = false;
                    predictiveWorkerActiveSeq = null;
                    logAction('predictive', { phase: 'worker_error', message: err?.message ? String(err.message) : 'Błąd' }, 'WARN');
                };
            } catch (err) {
                predictiveWorker = null;
                logAction('predictive', { phase: 'worker_init_failed', message: err?.message ? String(err.message) : 'Błąd' }, 'WARN');
                return;
            }
        }

        const rows = [];
        for (const item of (Array.isArray(getAllData()) ? getAllData() : [])) {
            const safeFileName = String(item?.fileName || '').trim();
            if (!item?.isComplete || !item?.headerMap || !Array.isArray(item?.cells)) continue;
            const h = item.headerMap;
            rows.push({
                fileName: safeFileName,
                address: String(item.cells[h.ADRES] || '').trim(),
                facility: String(item.cells[h.NAZWA_PLACOWKI] || '').trim()
            });
        }

        predictiveWorkerBusy = true;
        predictiveWorkerActiveSeq = ++predictiveWorkerSeq;
        try {
            predictiveWorker.postMessage({ op: 'rebuild', seq: predictiveWorkerActiveSeq, rows });
            logAction('predictive', { phase: 'worker_rebuild_start', mode: 'trie', rows: rows.length }, 'INFO');
        } catch (err) {
            predictiveWorkerBusy = false;
            predictiveWorkerActiveSeq = null;
            logAction('predictive', { phase: 'worker_post_failed', message: err?.message ? String(err.message) : 'Błąd' }, 'WARN');
        }
    }

    function schedulePredictiveIndexRebuild({ reason } = {}) {
        if (predictiveIndexMode === PREDICT_INDEX_MODE.trie) {
            const r = String(reason || '');
            const sources = getPredictiveSourcesCount();
            const isForced =
                r.includes('full_reload') ||
                r.includes('dev_clear_db') ||
                r.includes('dev_clear_rnd') ||
                r.includes('force');
            if (sources > 0 && !isForced) return;
        }
        if (predictiveIndexBuildTimer) globalThis.clearTimeout?.(predictiveIndexBuildTimer);
        predictiveIndexBuildTimer = globalThis.setTimeout?.(() => {
            predictiveIndexBuildTimer = null;
            try { rebuildPredictiveIndex({ reason: reason || 'unknown' }); }
            catch (err) { logAction('predictive', { phase: 'rebuild_failed', message: err?.message ? String(err.message) : 'Błąd' }, 'WARN'); }
        }, 0);
    }

    function predictiveCandidateStartsWithQuery(query, candidate) {
        const q = String(query ?? '').trim();
        const c = String(candidate ?? '').trim();
        if (!q || !c) return false;
        const qf = predictiveFuzzyNormalizeText(q);
        const cf = predictiveFuzzyNormalizeText(c);
        return cf.startsWith(qf);
    }

    function scorePredictiveCandidatesInto(target, candidates, q, qf, type) {
        const list = Array.isArray(candidates) ? candidates : [];
        if (list.length === 0) return;

        const typeWeight = PREDICT_TYPE_WEIGHT[type] || 0;
        const maxScan = 2000;

        for (let i = 0; i < list.length && i < maxScan; i++) {
            const c = list[i];
            const value = String(c?.value || '');
            const fuzzyValue = String(c?.fuzzy || '');
            if (!value || !fuzzyValue) continue;

            let matchWeight = 0;
            if (value.startsWith(q)) {
                matchWeight = PREDICT_MATCH_WEIGHT.exactPrefix;
            } else if (fuzzyValue.startsWith(qf)) {
                matchWeight = PREDICT_MATCH_WEIGHT.caseInsensitivePrefix;
            } else if (fuzzyValue.includes(` ${qf}`)) {
                matchWeight = PREDICT_MATCH_WEIGHT.exactWord;
            } else if (fuzzyValue.includes(qf)) {
                matchWeight = PREDICT_MATCH_WEIGHT.substring;
            } else if (qf.length >= 4) {
                const fuzzyScore = getFuzzyScore(qf, fuzzyValue);
                if (fuzzyScore > 0.7) matchWeight = PREDICT_MATCH_WEIGHT.fuzzy * fuzzyScore;
                else continue;
            } else {
                continue;
            }

            const freqBonus = Math.min(50, Math.round(Math.log2(Math.max(1, Number(c.count || 1))) * 10));
            const acceptCount = Math.max(0, Number(getPredictiveAcceptCount(fuzzyValue) || 0));
            const acceptBonus = Math.min(120, Math.round(Math.log2(acceptCount + 1) * 45));

            const builtAt = Number(predictiveIndex?.builtAt || 0);
            const importedAt = Number.isFinite(Number(c?.importedAt)) ? Number(c.importedAt) : builtAt;
            const ageMs = Math.max(0, Date.now() - Math.max(0, importedAt));
            const ageDays = ageMs / (24 * 60 * 60 * 1000);
            const recencyBonus = Math.max(0, Math.round(90 * Math.exp(-ageDays / 10)));

            target.push({ value: c.value, score: typeWeight + matchWeight + freqBonus + acceptBonus + recencyBonus });
        }
    }

    function computePredictiveSuggestionsTrie(query, limit) {
        const q = String(query || '').trim();
        const qf = predictiveFuzzyNormalizeText(q);
        const idx = predictiveIndex?.trieIndex;
        if (!qf || qf.length < PREDICT_MIN_CHARS || !idx) return [];

        const perTypeLimit = Math.max(1, Math.min(420, Number(limit || 0) || PREDICT_MAX_OPTIONS));
        const res = idx.suggestByType(q, perTypeLimit);
        const scored = [];
        scorePredictiveCandidatesInto(scored, res?.address, q, qf, 'address');
        scorePredictiveCandidatesInto(scored, res?.facility, q, qf, 'facility');

        scored.sort((a, b) => (b.score - a.score) || String(a.value).localeCompare(String(b.value), 'pl', { sensitivity: 'base' }));

        const out = [];
        const seen = new Set();
        for (const row of scored) {
            const v = String(row.value || '').trim();
            if (!v) continue;
            if (!predictiveCandidateStartsWithQuery(q, v)) continue;
            if (v.length <= q.length) continue;
            const k = fuzzyNormalizeText(v);
            if (!k || seen.has(k)) continue;
            seen.add(k);
            out.push(v);
            if (out.length >= (Number(limit || 0) || PREDICT_MAX_OPTIONS)) break;
        }
        return out;
    }

    function computePredictiveSuggestions(query, limit) {
        if (predictiveIndex?.mode === PREDICT_INDEX_MODE.trie) {
            return computePredictiveSuggestionsTrie(query, limit);
        }
        const q = String(query || '').trim();
        const qf = predictiveFuzzyNormalizeText(q);
        if (!qf || qf.length < PREDICT_MIN_CHARS || !predictiveIndex?.buckets) return [];

        const bucketKey = qf.slice(0, PREDICT_BUCKET_PREFIX_LEN);
        if (!bucketKey) return [];

        const scored = [];
        scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.address?.get(bucketKey), q, qf, 'address');
        scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.facility?.get(bucketKey), q, qf, 'facility');

        scored.sort((a, b) => (b.score - a.score) || String(a.value).localeCompare(String(b.value), 'pl', { sensitivity: 'base' }));

        const out = [];
        const seen = new Set();
        for (const row of scored) {
            const v = String(row.value || '').trim();
            if (!v) continue;
            if (!predictiveCandidateStartsWithQuery(q, v)) continue;
            if (v.length <= q.length) continue;
            const k = predictiveFuzzyNormalizeText(v);
            if (!k || seen.has(k)) continue;
            seen.add(k);
            out.push(v);
            if (out.length >= (Number(limit || 0) || PREDICT_MAX_OPTIONS)) break;
        }
        return out;
    }

    function getPredictiveSuggestions(query, { lazyReason = 'predictive_lazy' } = {}) {
        const raw = String(query ?? '');
        const norm = raw.trim();
        if (norm.length < PREDICT_MIN_CHARS || raw !== norm) {
            const has = predictiveIndexMode === PREDICT_INDEX_MODE.trie
                ? (getPredictiveSourcesCount() > 0)
                : Boolean(predictiveIndex);
            return { options: [], hasIndex: has };
        }

        if (!predictiveIndex) {
            schedulePredictiveIndexRebuild({ reason: lazyReason });
            return { options: [], hasIndex: false };
        }

        const cached = predictiveSuggestionsCache?.get?.(norm);
        const options = cached || computePredictiveSuggestions(norm, PREDICT_MAX_OPTIONS);
        if (!cached) predictiveSuggestionsCache?.set?.(norm, options);
        const hasIndex = predictiveIndexMode === PREDICT_INDEX_MODE.trie
            ? (getPredictiveSourcesCount() > 0)
            : true;
        return { options: Array.isArray(options) ? options : [], hasIndex };
    }

    async function executeSearch(query) {
        if (!searchEngine?.executeSearch) throw new Error('Brak searchEngine.executeSearch');
        return await searchEngine.executeSearch({
            query,
            allData: Array.isArray(getAllData()) ? getAllData() : [],
            searchCache,
            getRouteCategoriesFromFileName
        });
    }

    function clearSearchCache() {
        safeClearCache(searchCache);
    }

    return Object.freeze({
        executeSearch,
        clearSearchCache,
        schedulePredictiveIndexRebuild,
        rebuildPredictiveIndex,
        upsertPredictiveSource,
        removePredictiveSource,
        getPredictiveSuggestions,
        normalizeText,
        fuzzyNormalizeText
    });
}
