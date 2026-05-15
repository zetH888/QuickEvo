const PREDICT_MIN_CHARS = 2;
const PREDICT_MAX_OPTIONS = 14;
const PREDICT_BUCKET_PREFIX_LEN = 2;

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

    let predictiveIndex = null;
    let predictiveIndexBuildTimer = null;

    function addPredictiveValue(map, rawValue) {
        const value = String(rawValue || '').replace(/\s+/g, ' ').trim();
        if (!value) return;
        const key = fuzzyNormalizeText(value);
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
        const addressMap = new Map();
        const facilityMap = new Map();
        const routeMap = new Map();
        const fileNames = new Set();

        for (const item of (Array.isArray(getAllData()) ? getAllData() : [])) {
            const safeFileName = String(item?.fileName || '').trim();
            if (safeFileName) fileNames.add(safeFileName);

            if (!item?.isComplete || !item?.headerMap || !Array.isArray(item?.cells)) continue;
            const h = item.headerMap;

            const address = String(item.cells[h.ADRES] || '').trim();
            if (address) addPredictiveValueWithVariants(addressMap, address);

            const facility = String(item.cells[h.NAZWA_PLACOWKI] || '').trim();
            if (facility) addPredictiveValueWithVariants(facilityMap, facility);
        }

        for (const fn of fileNames) {
            const routeName = String(formatRouteNameForResults(fn) || '').trim();
            if (routeName) addPredictiveValueWithVariants(routeMap, routeName);
        }

        predictiveIndex = {
            builtAt: Date.now(),
            reason: String(reason || ''),
            buckets: {
                address: buildPredictiveBuckets(addressMap, 'address'),
                facility: buildPredictiveBuckets(facilityMap, 'facility'),
                route: buildPredictiveBuckets(routeMap, 'route')
            }
        };
        safeClearCache(predictiveSuggestionsCache);
    }

    function schedulePredictiveIndexRebuild({ reason } = {}) {
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
        const qf = fuzzyNormalizeText(q);
        const cf = fuzzyNormalizeText(c);
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
            target.push({ value: c.value, score: typeWeight + matchWeight + freqBonus });
        }
    }

    function computePredictiveSuggestions(query, limit) {
        const q = String(query || '').trim();
        const qf = fuzzyNormalizeText(q);
        if (!qf || qf.length < PREDICT_MIN_CHARS || !predictiveIndex?.buckets) return [];

        const bucketKey = qf.slice(0, PREDICT_BUCKET_PREFIX_LEN);
        if (!bucketKey) return [];

        const scored = [];
        scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.address?.get(bucketKey), q, qf, 'address');
        scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.facility?.get(bucketKey), q, qf, 'facility');
        scorePredictiveCandidatesInto(scored, predictiveIndex.buckets.route?.get(bucketKey), q, qf, 'route');

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

    function getPredictiveSuggestions(query, { lazyReason = 'predictive_lazy' } = {}) {
        const raw = String(query ?? '');
        const norm = raw.trim();
        if (norm.length < PREDICT_MIN_CHARS || raw !== norm) return { options: [], hasIndex: Boolean(predictiveIndex) };

        if (!predictiveIndex) {
            schedulePredictiveIndexRebuild({ reason: lazyReason });
            return { options: [], hasIndex: false };
        }

        const cached = predictiveSuggestionsCache?.get?.(norm);
        const options = cached || computePredictiveSuggestions(norm, PREDICT_MAX_OPTIONS);
        if (!cached) predictiveSuggestionsCache?.set?.(norm, options);
        return { options: Array.isArray(options) ? options : [], hasIndex: true };
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
        getPredictiveSuggestions,
        normalizeText,
        fuzzyNormalizeText
    });
}

