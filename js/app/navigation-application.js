/**
 * @module navigation-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla nawigacji widoków w QuickEvo.
 *
 * Cel:
 * - utrzymać spójny przepływ „nawigacja → stan UI → logowanie” poza `app.js`,
 * - pozostawić `navigation-service` jako adapter historii (push/replace/popstate),
 * - ograniczyć liczbę miejsc, w których dotykamy `history`/routing.
 */

/**
 * Tworzy serwis aplikacyjny odpowiedzialny za nawigację pomiędzy widokami.
 *
 * @param {Object} cfg
 * @param {(action: string, payload?: any, level?: string) => void} cfg.onLog
 * @param {(opts: { source?: string }) => void} cfg.resetToInitialState
 * @param {(fileName: string, rowIndex: number|null, opts?: { skipPush?: boolean }) => void} cfg.showFilePreview
 * @param {(opts: { source?: string }) => void} cfg.showSearchView
 * @param {(value: string) => void} cfg.setSearchInputValue
 * @param {(query: string) => Promise<void>} cfg.performSearch
 * @param {() => boolean} cfg.getIsSearchEnabled
 * @param {() => void} cfg.clearSearchUi
 * @param {() => void} cfg.onPageshowRestore
 * @param {(fileName: string) => boolean} cfg.canOpenPreview
 * @param {() => boolean} cfg.isHomeState
 * @param {(e: any) => boolean} cfg.shouldIgnoreHomeClick
 * @param {() => void} cfg.onScrollTop
 * @param {(event: string, payload?: any) => void} cfg.logClientEvent
 */
export function createNavigationApplication(cfg) {
    if (!cfg || typeof cfg.onLog !== 'function') throw new Error('navigation-application: brak onLog');

    function createServiceConfig() {
        return {
            onLog: cfg.onLog,
            onShowHome: ({ source }) => cfg.resetToInitialState({ source: source || 'navigation_home' }),
            onShowPreview: ({ fileName, rowIndex, skipPush }) => cfg.showFilePreview(fileName, rowIndex, { skipPush: Boolean(skipPush) }),
            onShowSearchView: ({ source }) => cfg.showSearchView({ source: String(source || '') }),
            onSetSearchInputValue: (value) => cfg.setSearchInputValue(String(value ?? '')),
            onPerformSearch: (q) => { if (cfg.getIsSearchEnabled()) cfg.performSearch(String(q || '')); },
            onClearSearchUi: () => cfg.clearSearchUi(),
            onPageshowRestore: () => cfg.onPageshowRestore(),
            canOpenPreview: (fileName) => cfg.canOpenPreview(String(fileName || '')),
            onHomeClick: () => {
                if (cfg.isHomeState()) return false;
                cfg.resetToInitialState({ source: 'home' });
                cfg.logClientEvent('navigate', { to: 'home' });
                return true;
            },
            shouldIgnoreHomeClick: (e) => cfg.shouldIgnoreHomeClick(e),
            onScrollTop: () => cfg.onScrollTop()
        };
    }

    return Object.freeze({ createServiceConfig });
}
