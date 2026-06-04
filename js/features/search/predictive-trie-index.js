/**
 * @module predictive-trie-index
 *
 * @description
 * Indeks predykcyjny oparty o Trie (drzewo prefiksowe) z obsługą aktualizacji inkrementalnych.
 * Moduł jest niezależny od DOM i może być używany przez warstwę orkiestracji wyszukiwania.
 *
 * Projektowo:
 * - Indeks utrzymuje oddzielne struktury dla typów: address / facility / route.
 * - Aktualizacje są wykonywane na poziomie „źródeł” (np. plików) — pozwala to usuwać wkład konkretnego pliku
 *   bez pełnej przebudowy.
 * - Wyszukiwanie prefiksowe jest wykonywane przez Trie i zwraca ograniczoną liczbę kandydatów.
 */

/**
 * @typedef {'address'|'facility'|'route'} PredictiveType
 */

/**
 * @typedef {Object} PredictiveCandidate
 * @property {PredictiveType} type Typ rekordu (adres/placówka/trasa).
 * @property {string} value Wartość wyświetlana dla użytkownika (oryginalna).
 * @property {string} fuzzy Wartość znormalizowana (np. bez diakrytyków) — klucz unikalności w obrębie typu.
 * @property {number} count Częstotliwość wystąpień (zagregowana globalnie).
 * @property {number} importedAt Najnowszy timestamp importu źródła, które wnosi ten wpis (ms).
 * @property {number} acceptCount Licznik akceptacji sugestii (z pamięci lokalnej).
 */

/**
 * @typedef {Object} PredictiveIndexStats
 * @property {number} sources Liczba zarejestrowanych źródeł.
 * @property {{ address: number, facility: number, route: number }} candidates Liczba kandydatów w typach.
 */

/**
 * @typedef {Object} PredictiveSourcePayload
 * @property {number} [importedAt] Timestamp importu źródła (ms).
 * @property {{ address?: Map<string, { value: string, count: number }>, facility?: Map<string, { value: string, count: number }>, route?: Map<string, { value: string, count: number }> }} byType
 */

/**
 * @typedef {Object} PredictiveTrieIndexConfig
 * @property {(text: unknown) => string} fuzzyNormalizeText Funkcja normalizacji (np. do małych liter, bez diakrytyków).
 * @property {() => number} [now] Źródło czasu (testowalne).
 * @property {number} [minChars] Minimalna liczba znaków do predykcji.
 * @property {number} [maxCandidatesPerType] Maksymalna liczba kandydatów zwracana na typ w jednym zapytaniu.
 * @property {{ address: number, facility: number, route: number }} [typeWeights] Wagi typów (ranking bazowy).
 */

const DEFAULT_TYPE_WEIGHTS = Object.freeze({
    address: 330,
    facility: 300,
    route: 270
});

const DEFAULT_MIN_CHARS = 2;
const DEFAULT_MAX_CANDIDATES_PER_TYPE = 250;

class TrieNode {
    constructor() {
        /** @type {Map<string, TrieNode>} */
        this.children = new Map();
        /** @type {Set<string>} */
        this.terminalKeys = new Set();
        /** @type {number} */
        this.maxScore = 0;
    }
}

/**
 * Minimalna implementacja kopca maksimum dla wyszukiwania najlepszych gałęzi Trie.
 * Wystarczy do krótkich kolejek (prefiksy) i nie wymaga zależności zewnętrznych.
 */
class MaxHeap {
    constructor() {
        /** @type {Array<{ score: number, node: TrieNode }>} */
        this.items = [];
    }

    /**
     * @param {{ score: number, node: TrieNode }} item
     */
    push(item) {
        this.items.push(item);
        this.#bubbleUp(this.items.length - 1);
    }

    /**
     * @returns {{ score: number, node: TrieNode } | null}
     */
    pop() {
        const n = this.items.length;
        if (n === 0) return null;
        if (n === 1) return this.items.pop() || null;
        const top = this.items[0];
        this.items[0] = this.items.pop();
        this.#bubbleDown(0);
        return top;
    }

    /**
     * @returns {{ score: number, node: TrieNode } | null}
     */
    peek() {
        return this.items.length > 0 ? this.items[0] : null;
    }

    /**
     * @returns {number}
     */
    size() { return this.items.length; }

    /**
     * @param {number} idx
     */
    #bubbleUp(idx) {
        while (idx > 0) {
            const parent = ((idx - 1) / 2) | 0;
            if (this.items[parent].score >= this.items[idx].score) break;
            const tmp = this.items[parent];
            this.items[parent] = this.items[idx];
            this.items[idx] = tmp;
            idx = parent;
        }
    }

    /**
     * @param {number} idx
     */
    #bubbleDown(idx) {
        const n = this.items.length;
        while (true) {
            const left = idx * 2 + 1;
            const right = idx * 2 + 2;
            let largest = idx;
            if (left < n && this.items[left].score > this.items[largest].score) largest = left;
            if (right < n && this.items[right].score > this.items[largest].score) largest = right;
            if (largest === idx) break;
            const tmp = this.items[largest];
            this.items[largest] = this.items[idx];
            this.items[idx] = tmp;
            idx = largest;
        }
    }
}

/**
 * @param {PredictiveCandidate} cand
 * @param {{ address: number, facility: number, route: number }} typeWeights
 * @returns {number}
 */
function computeCandidateBaseScore(cand, typeWeights) {
    const typeWeight = typeWeights?.[cand.type] || 0;
    const freqBonus = Math.min(50, Math.round(Math.log2(Math.max(1, Number(cand.count || 1))) * 10));
    const acceptBonus = Math.min(120, Math.round(Math.log2(Math.max(1, Number(cand.acceptCount || 0) + 1)) * 45));
    const nowTs = Date.now();
    const ageMs = Math.max(0, nowTs - Number(cand.importedAt || 0));
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const recencyBonus = Math.max(0, Math.round(90 * Math.exp(-ageDays / 10)));
    return typeWeight + freqBonus + acceptBonus + recencyBonus;
}

class PredictiveTrie {
    /**
     * @param {(key: string) => number} getKeyScore
     */
    constructor(getKeyScore) {
        /** @type {TrieNode} */
        this.root = new TrieNode();
        /** @type {(key: string) => number} */
        this.getKeyScore = getKeyScore;
    }

    /**
     * @param {string} key
     * @returns {TrieNode | null}
     */
    findNode(key) {
        const k = String(key || '');
        if (!k) return this.root;
        let node = this.root;
        for (let i = 0; i < k.length; i++) {
            const ch = k[i];
            const next = node.children.get(ch);
            if (!next) return null;
            node = next;
        }
        return node;
    }

    /**
     * @param {string} key
     */
    upsertTerminal(key) {
        const k = String(key || '');
        if (!k) return;
        const path = [this.root];
        let node = this.root;
        for (let i = 0; i < k.length; i++) {
            const ch = k[i];
            let next = node.children.get(ch);
            if (!next) {
                next = new TrieNode();
                node.children.set(ch, next);
            }
            node = next;
            path.push(node);
        }
        node.terminalKeys.add(k);
        this.#recomputePathMaxScores(path);
    }

    /**
     * @param {string} key
     */
    removeTerminal(key) {
        const k = String(key || '');
        if (!k) return;
        const path = [this.root];
        /** @type {Array<[TrieNode, string]>} */
        const edges = [];
        let node = this.root;
        for (let i = 0; i < k.length; i++) {
            const ch = k[i];
            const next = node.children.get(ch);
            if (!next) return;
            edges.push([node, ch]);
            node = next;
            path.push(node);
        }
        node.terminalKeys.delete(k);
        this.#recomputePathMaxScores(path);
        this.#prune(edges);
    }

    /**
     * @param {string} prefix
     * @param {number} limit
     * @returns {string[]}
     */
    topKeysByPrefix(prefix, limit) {
        const l = Math.max(0, Number(limit) || 0);
        if (l === 0) return [];
        const node = this.findNode(prefix);
        if (!node) return [];

        const heap = new MaxHeap();
        heap.push({ score: node.maxScore || 0, node });
        const out = [];
        let worst = Infinity;
        const seen = new Set();
        const maxNodes = 4000;
        let visited = 0;

        while (heap.size() > 0) {
            const top = heap.pop();
            if (!top) break;
            visited += 1;
            if (visited > maxNodes) break;

            if (out.length >= l && top.score <= worst) break;

            for (const k of top.node.terminalKeys) {
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(k);
            }

            for (const child of top.node.children.values()) {
                const s = child.maxScore || 0;
                if (s <= 0) continue;
                heap.push({ score: s, node: child });
            }

            if (out.length > l * 6) break;

            if (out.length >= l) {
                const scored = out
                    .map((k) => ({ k, s: this.getKeyScore(k) || 0 }))
                    .sort((a, b) => b.s - a.s);
                out.length = 0;
                for (let i = 0; i < scored.length && i < l; i++) out.push(scored[i].k);
                worst = scored.length > 0 ? scored[Math.min(l - 1, scored.length - 1)].s : Infinity;
            }
        }

        if (out.length <= 1) return out;
        return out
            .map((k) => ({ k, s: this.getKeyScore(k) || 0 }))
            .sort((a, b) => b.s - a.s)
            .slice(0, l)
            .map((x) => x.k);
    }

    /**
     * @param {TrieNode[]} path
     */
    #recomputePathMaxScores(path) {
        for (let i = path.length - 1; i >= 0; i--) {
            const node = path[i];
            let max = 0;
            for (const k of node.terminalKeys) {
                max = Math.max(max, this.getKeyScore(k) || 0);
            }
            for (const child of node.children.values()) {
                max = Math.max(max, child.maxScore || 0);
            }
            node.maxScore = max;
        }
    }

    /**
     * @param {Array<[TrieNode, string]>} edges
     */
    #prune(edges) {
        for (let i = edges.length - 1; i >= 0; i--) {
            const [parent, ch] = edges[i];
            const node = parent.children.get(ch);
            if (!node) continue;
            if (node.terminalKeys.size > 0) break;
            if (node.children.size > 0) break;
            parent.children.delete(ch);
        }
    }
}

/**
 * Tworzy indeks predykcyjny (Trie) z obsługą aktualizacji inkrementalnych per źródło.
 *
 * @param {PredictiveTrieIndexConfig} cfg
 */
export function createPredictiveTrieIndex(cfg) {
    const fuzzyNormalizeText = typeof cfg?.fuzzyNormalizeText === 'function'
        ? cfg.fuzzyNormalizeText
        : ((x) => String(x ?? '').trim().toLowerCase());
    const now = typeof cfg?.now === 'function' ? cfg.now : (() => Date.now());
    const minChars = Number.isFinite(Number(cfg?.minChars)) ? Math.max(1, Number(cfg.minChars)) : DEFAULT_MIN_CHARS;
    const maxCandidatesPerType = Number.isFinite(Number(cfg?.maxCandidatesPerType))
        ? Math.max(10, Number(cfg.maxCandidatesPerType))
        : DEFAULT_MAX_CANDIDATES_PER_TYPE;
    const typeWeights = (cfg?.typeWeights && typeof cfg.typeWeights === 'object') ? cfg.typeWeights : DEFAULT_TYPE_WEIGHTS;

    /** @type {Map<string, PredictiveCandidate>} */
    const candidatesByTypeKey = new Map();

    /** @type {Map<string, PredictiveSourcePayload>} */
    const sources = new Map();

    /**
     * @param {PredictiveType} type
     * @param {string} fuzzy
     * @returns {string}
     */
    const toGlobalKey = (type, fuzzy) => `${type}::${String(fuzzy || '')}`;

    /**
     * @param {string} globalKey
     * @returns {number}
     */
    const getKeyScore = (globalKey) => {
        const cand = candidatesByTypeKey.get(globalKey);
        if (!cand) return 0;
        return computeCandidateBaseScore(cand, typeWeights);
    };

    const tries = Object.freeze({
        address: new PredictiveTrie(getKeyScore),
        facility: new PredictiveTrie(getKeyScore),
        route: new PredictiveTrie(getKeyScore)
    });

    /**
     * @param {PredictiveType} type
     * @param {string} fuzzy
     * @returns {PredictiveCandidate | null}
     */
    function getCandidate(type, fuzzy) {
        const key = toGlobalKey(type, fuzzy);
        return candidatesByTypeKey.get(key) || null;
    }

    /**
     * @param {PredictiveType} type
     * @param {string} fuzzy
     * @param {() => PredictiveCandidate} factory
     * @returns {PredictiveCandidate}
     */
    function ensureCandidate(type, fuzzy, factory) {
        const key = toGlobalKey(type, fuzzy);
        const prev = candidatesByTypeKey.get(key);
        if (prev) return prev;
        const created = factory();
        candidatesByTypeKey.set(key, created);
        tries[type].upsertTerminal(key);
        return created;
    }

    /**
     * @param {PredictiveType} type
     * @param {string} fuzzy
     */
    function maybeDropCandidate(type, fuzzy) {
        const key = toGlobalKey(type, fuzzy);
        const cand = candidatesByTypeKey.get(key);
        if (!cand) return;
        if (Number(cand.count || 0) > 0) return;
        candidatesByTypeKey.delete(key);
        tries[type].removeTerminal(key);
    }

    /**
     * Aktualizuje (podmienia) wkład pojedynczego źródła.
     * `payload.byType` powinno zawierać mapy: fuzzyKey -> { value, count } (count >= 1).
     *
     * @param {string} sourceId
     * @param {PredictiveSourcePayload} payload
     */
    function upsertSource(sourceId, payload) {
        const id = String(sourceId || '').trim();
        if (!id) return;
        const nextImportedAt = Number.isFinite(Number(payload?.importedAt)) ? Number(payload.importedAt) : now();
        const next = {
            importedAt: nextImportedAt,
            byType: {
                address: payload?.byType?.address instanceof Map ? payload.byType.address : new Map(),
                facility: payload?.byType?.facility instanceof Map ? payload.byType.facility : new Map(),
                route: payload?.byType?.route instanceof Map ? payload.byType.route : new Map()
            }
        };

        const prev = sources.get(id);
        sources.set(id, next);

        /** @type {PredictiveType[]} */
        const types = ['address', 'facility', 'route'];
        for (const type of types) {
            const prevMap = prev?.byType?.[type] instanceof Map ? prev.byType[type] : new Map();
            const nextMap = next.byType[type] instanceof Map ? next.byType[type] : new Map();

            for (const [fuzzy, meta] of prevMap.entries()) {
                if (!nextMap.has(fuzzy)) {
                    const cand = getCandidate(type, fuzzy);
                    if (cand) {
                        cand.count = Math.max(0, Number(cand.count || 0) - Math.max(0, Number(meta?.count || 0)));
                    }
                    maybeDropCandidate(type, fuzzy);
                }
            }

            for (const [fuzzy, meta] of nextMap.entries()) {
                const fv = String(fuzzy || '');
                if (!fv) continue;
                const safeCount = Math.max(0, Number(meta?.count || 0));
                if (safeCount <= 0) continue;
                const safeValue = String(meta?.value || '').trim();
                if (!safeValue) continue;

                const prevMeta = prevMap.get(fv);
                const prevCount = Math.max(0, Number(prevMeta?.count || 0));
                const delta = safeCount - prevCount;
                if (delta === 0 && prevMeta && String(prevMeta.value || '') === safeValue) {
                    const cand = getCandidate(type, fv);
                    if (cand) cand.importedAt = Math.max(Number(cand.importedAt || 0), nextImportedAt);
                    continue;
                }

                const cand = ensureCandidate(type, fv, () => ({
                    type,
                    value: safeValue,
                    fuzzy: fv,
                    count: 0,
                    importedAt: nextImportedAt,
                    acceptCount: 0
                }));

                if (delta !== 0) cand.count = Math.max(0, Number(cand.count || 0) + delta);
                cand.value = safeValue || cand.value;
                cand.importedAt = Math.max(Number(cand.importedAt || 0), nextImportedAt);

                tries[type].upsertTerminal(toGlobalKey(type, fv));
            }
        }
    }

    /**
     * Usuwa wkład źródła z indeksu (np. po usunięciu pliku).
     *
     * @param {string} sourceId
     */
    function removeSource(sourceId) {
        const id = String(sourceId || '').trim();
        if (!id) return;
        const prev = sources.get(id);
        if (!prev) return;
        sources.delete(id);

        /** @type {PredictiveType[]} */
        const types = ['address', 'facility', 'route'];
        for (const type of types) {
            const prevMap = prev?.byType?.[type] instanceof Map ? prev.byType[type] : new Map();
            for (const [fuzzy, meta] of prevMap.entries()) {
                const fv = String(fuzzy || '');
                if (!fv) continue;
                const cand = getCandidate(type, fv);
                if (cand) cand.count = Math.max(0, Number(cand.count || 0) - Math.max(0, Number(meta?.count || 0)));
                maybeDropCandidate(type, fv);
            }
        }
    }

    /**
     * Ustawia liczniki akceptacji (np. z localStorage) dla istniejących kandydatów.
     * Nie tworzy nowych rekordów — ignoruje nieznane klucze.
     *
     * @param {PredictiveType} type
     * @param {Map<string, number>} acceptCounts
     */
    function applyAcceptCounts(type, acceptCounts) {
        if (!(acceptCounts instanceof Map)) return;
        const t = /** @type {PredictiveType} */ (type);
        for (const [fuzzy, count] of acceptCounts.entries()) {
            const fv = String(fuzzy || '');
            if (!fv) continue;
            const cand = getCandidate(t, fv);
            if (!cand) continue;
            cand.acceptCount = Math.max(0, Number(count || 0));
            tries[t].upsertTerminal(toGlobalKey(t, fv));
        }
    }

    /**
     * Zwraca kandydatów dla prefiksu (w obrębie każdego typu osobno).
     * Metoda zwraca obiekty kandydata, bez finalnego filtrowania stricte UI.
     *
     * @param {string} query
     * @param {number} [limit]
     * @returns {{ address: PredictiveCandidate[], facility: PredictiveCandidate[], route: PredictiveCandidate[] }}
     */
    function suggestByType(query, limit) {
        const raw = String(query ?? '');
        const trimmed = raw.trim();
        const qf = fuzzyNormalizeText(trimmed);
        if (!qf || qf.length < minChars || raw !== trimmed) {
            return { address: [], facility: [], route: [] };
        }

        const perTypeLimit = Math.max(1, Math.min(maxCandidatesPerType, Number(limit) || maxCandidatesPerType));
        const out = { address: [], facility: [], route: [] };

        /** @type {PredictiveType[]} */
        const types = ['address', 'facility', 'route'];
        for (const type of types) {
            const keys = tries[type].topKeysByPrefix(toGlobalKey(type, qf).slice(0, `${type}::`.length + qf.length), perTypeLimit);
            for (const gk of keys) {
                const cand = candidatesByTypeKey.get(gk);
                if (!cand) continue;
                if (!cand.fuzzy.startsWith(qf)) continue;
                out[type].push(cand);
            }
        }
        return out;
    }

    /**
     * @returns {PredictiveIndexStats}
     */
    function getStats() {
        let addr = 0, fac = 0, rou = 0;
        for (const cand of candidatesByTypeKey.values()) {
            if (cand.type === 'address') addr += 1;
            else if (cand.type === 'facility') fac += 1;
            else if (cand.type === 'route') rou += 1;
        }
        return { sources: sources.size, candidates: { address: addr, facility: fac, route: rou } };
    }

    return Object.freeze({
        upsertSource,
        removeSource,
        applyAcceptCounts,
        suggestByType,
        getStats
    });
}

