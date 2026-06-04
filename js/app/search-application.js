/**
 * @module search-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla wyszukiwania w QuickEvo.
 *
 * Cel:
 * - wydzielenie przepływu „wpisz zapytanie → wyszukaj → zrenderuj wynik” z `app.js`,
 * - zachowanie czystej granicy: moduł nie zna DOM i nie renderuje UI bezpośrednio,
 * - udostępnienie jednego API do: wyszukiwania, predykcji i przebudowy indeksów.
 */

/**
 * Tworzy serwis aplikacyjny odpowiedzialny za wyszukiwanie oraz predykcje.
 *
 * @param {Object} cfg
 * @param {() => any} cfg.createOrchestrator
 * @param {(text: string) => void} cfg.setStatusText
 * @param {(isHint: boolean) => void} cfg.setStatusHint
 * @param {(query: string) => void} cfg.setLastQuery
 * @param {(results: any[]) => void} cfg.setMatchedResults
 * @param {(results: any[]) => void} cfg.setCurrentResults
 * @param {(query: string) => Promise<void>} cfg.renderResults
 * @param {() => void} cfg.handleShortQuery
 * @param {() => void} cfg.handleNoResults
 * @param {(err: any) => void} cfg.handleError
 * @param {(action: string, payload?: any, level?: string) => void} [cfg.logAction]
 */
export function createSearchApplication(cfg) {
    if (!cfg || typeof cfg.createOrchestrator !== 'function') throw new Error('search-application: brak createOrchestrator');

    /** @type {any|null} */
    let orchestrator = null;

    function ensureOrchestrator() {
        if (orchestrator) return orchestrator;
        orchestrator = cfg.createOrchestrator();
        if (!orchestrator) throw new Error('search-application: orchestrator nie został utworzony');
        return orchestrator;
    }

    /**
     * Wykonuje wyszukiwanie i uruchamia renderowanie wyników.
     *
     * @param {string} query
     * @returns {Promise<void>}
     */
    async function search(query) {
        const trimmedQuery = String(query || '').trim();
        if (trimmedQuery.length < 3) {
            try { cfg.handleShortQuery?.(); } catch { }
            return;
        }

        try { cfg.setStatusText?.('Szukanie...'); } catch { }
        try { cfg.setStatusHint?.(false); } catch { }
        try { cfg.setLastQuery?.(trimmedQuery); } catch { }

        try {
            const results = await ensureOrchestrator().executeSearch(trimmedQuery);
            const safeResults = Array.isArray(results) ? results : [];
            try { cfg.setMatchedResults?.(safeResults); } catch { }

            if (safeResults.length === 0) {
                try { cfg.handleNoResults?.(); } catch { }
                return;
            }

            try { cfg.setStatusText?.('Dane gotowe.'); } catch { }
            try { cfg.setCurrentResults?.(safeResults); } catch { }
            await cfg.renderResults?.(trimmedQuery);
        } catch (err) {
            try { cfg.handleError?.(err); } catch { }
        }
    }

    /**
     * Harmonogramuje przebudowę indeksów predykcyjnych w orchestratorze.
     *
     * @param {{ reason?: string }} [opts]
     */
    function schedulePredictiveIndexRebuild({ reason } = {}) {
        try { ensureOrchestrator().schedulePredictiveIndexRebuild({ reason: reason || 'unknown' }); } catch { }
    }

    /**
     * Zwraca podpowiedzi predykcyjne (bez renderowania).
     *
     * @param {string} normalizedQuery
     * @param {{ lazyReason?: string }} [opts]
     * @returns {any}
     */
    function getPredictiveSuggestions(normalizedQuery, { lazyReason } = {}) {
        return ensureOrchestrator().getPredictiveSuggestions(String(normalizedQuery || ''), { lazyReason: lazyReason || 'unknown' });
    }

    /**
     * Aktualizuje wkład źródła (np. pliku) w indeksie predykcji (jeśli wspierane).
     *
     * @param {string} sourceId
     * @param {any} payload
     */
    function upsertPredictiveSource(sourceId, payload) {
        try { ensureOrchestrator().upsertPredictiveSource?.(String(sourceId || ''), payload); } catch { }
    }

    /**
     * Usuwa wkład źródła (np. po skasowaniu pliku) z indeksu predykcji (jeśli wspierane).
     *
     * @param {string} sourceId
     */
    function removePredictiveSource(sourceId) {
        try { ensureOrchestrator().removePredictiveSource?.(String(sourceId || '')); } catch { }
    }

    return Object.freeze({
        search,
        schedulePredictiveIndexRebuild,
        getPredictiveSuggestions,
        upsertPredictiveSource,
        removePredictiveSource
    });
}
