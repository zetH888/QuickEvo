function safeCall(fn, ...args) {
    try { return fn?.(...args); } catch { return undefined; }
}

function safeEncodeHashSegment(value) {
    try { return encodeURIComponent(String(value ?? '')); } catch { return ''; }
}

function safePushState(history, state, url, onError) {
    try { history.pushState(state, '', url); return true; }
    catch (e) { safeCall(onError, e); return false; }
}

function safeReplaceState(history, state, url, onError) {
    try { history.replaceState(state, '', url); return true; }
    catch (e) { safeCall(onError, e); return false; }
}

export function createNavigationService(cfg = {}) {
    const historyRef = cfg?.historyRef || globalThis.history;
    const windowRef = cfg?.windowRef || globalThis;

    const onLog = typeof cfg?.onLog === 'function' ? cfg.onLog : (() => { });
    const onShowHome = typeof cfg?.onShowHome === 'function' ? cfg.onShowHome : (() => { });
    const onShowPreview = typeof cfg?.onShowPreview === 'function' ? cfg.onShowPreview : (() => { });
    const onShowSchedule = typeof cfg?.onShowSchedule === 'function' ? cfg.onShowSchedule : (() => { });
    const onShowSearchView = typeof cfg?.onShowSearchView === 'function' ? cfg.onShowSearchView : (() => { });
    const onSetSearchInputValue = typeof cfg?.onSetSearchInputValue === 'function' ? cfg.onSetSearchInputValue : (() => { });
    const onPerformSearch = typeof cfg?.onPerformSearch === 'function' ? cfg.onPerformSearch : (() => { });
    const onClearSearchUi = typeof cfg?.onClearSearchUi === 'function' ? cfg.onClearSearchUi : (() => { });
    const onPageshowRestore = typeof cfg?.onPageshowRestore === 'function' ? cfg.onPageshowRestore : (() => { });
    const canOpenPreview = typeof cfg?.canOpenPreview === 'function' ? cfg.canOpenPreview : (() => true);
    const shouldIgnoreHomeClick = typeof cfg?.shouldIgnoreHomeClick === 'function' ? cfg.shouldIgnoreHomeClick : (() => false);

    let boundBackClick = null;
    let boundHomeClick = null;

    function replaceHome({ search = false, query = '' } = {}) {
        safeReplaceState(historyRef, { view: 'home', search: Boolean(search), query: String(query || '') }, search ? '#search' : '#home', (e) => onLog('navigation', { error: 'replaceState home failed', msg: e?.message }, 'WARN'));
    }

    function pushHome() {
        safePushState(historyRef, { view: 'home', search: false }, '#home', (e) => onLog('navigation', { error: 'pushState home failed', msg: e?.message }, 'WARN'));
    }

    function setSearchState({ active, query } = {}) {
        const isActive = Boolean(active);
        const q = String(query ?? '');
        const currentHistoryState = historyRef.state || {};
        if (isActive) {
            if (!currentHistoryState.search) safePushState(historyRef, { view: 'home', search: true, query: q }, '#search', (e) => onLog('navigation', { error: 'pushState search failed', msg: e?.message }, 'WARN'));
            else safeReplaceState(historyRef, { view: 'home', search: true, query: q }, '#search', () => { });
            return;
        }
        if (currentHistoryState.search) safeReplaceState(historyRef, { view: 'home', search: false }, '#home', () => { });
    }

    /**
     * Dodaje wpis historii dla podglądu pliku.
     * `contextIsoDate` jest opcjonalne, ale pozwala odtworzyć „kontekst grafiku” po Back/Forward.
     *
     * @param {{ fileName?: string, rowIndex?: (number|null), contextIsoDate?: (string|null) }} [opts]
     * @returns {boolean}
     */
    function pushPreview({ fileName, rowIndex, contextIsoDate } = {}) {
        const safeFileName = String(fileName || '');
        const idx = Number.isInteger(rowIndex) ? rowIndex : null;
        const iso = String(contextIsoDate ?? '').trim() || null;
        const url = `#preview/${safeEncodeHashSegment(safeFileName)}`;
        return safePushState(
            historyRef,
            { view: 'preview', fileName: safeFileName, rowIndex: idx, contextIsoDate: iso },
            url,
            (e) => onLog('navigation', { error: 'pushState preview failed', msg: e?.message }, 'WARN')
        );
    }

    /**
     * Dodaje wpis historii dla widoku grafiku (miesięczny przegląd).
     *
     * @param {{ ym?: string, selectedIsoDate?: (string|null) }} [opts]
     * @returns {boolean}
     */
    function pushSchedule({ ym, selectedIsoDate } = {}) {
        const safeYm = String(ym || '').trim();
        if (!/^\d{4}-\d{2}$/.test(safeYm)) return false;
        const iso = String(selectedIsoDate ?? '').trim() || null;
        const url = `#schedule/${safeEncodeHashSegment(safeYm)}`;
        return safePushState(
            historyRef,
            { view: 'schedule', ym: safeYm, selectedIsoDate: iso },
            url,
            (e) => onLog('navigation', { error: 'pushState schedule failed', msg: e?.message }, 'WARN')
        );
    }

    function handleBackToSearchClick() {
        const st = historyRef.state || {};
        if (st?.view === 'preview' || st?.view === 'schedule') { try { historyRef.back(); } catch { onShowSearchView({ source: 'back_button_fallback' }); } }
        else onShowSearchView({ source: 'back_button' });
    }

    function handleHomeClick() {
        const res = safeCall(cfg?.onHomeClick);
        if (res === false) return;
        pushHome();
    }

    function handlePopstate(e) {
        const state = e?.state || historyRef.state || {};
        if (state?.view === 'preview') {
            if (!canOpenPreview(state?.fileName)) {
                onShowHome({ source: 'popstate_preview_missing_data', search: false });
                return;
            }
            onShowPreview({ fileName: state.fileName, rowIndex: state.rowIndex, contextIsoDate: state.contextIsoDate, skipPush: true, source: 'popstate' });
            return;
        }

        if (state?.view === 'schedule') {
            onShowSchedule({ ym: state.ym, selectedIsoDate: state.selectedIsoDate, skipPush: true, source: 'popstate' });
            return;
        }

        if (state?.view === 'home') {
            onShowSearchView({ source: 'popstate_home' });
            if (!state?.search) {
                onSetSearchInputValue('');
                onClearSearchUi({ source: 'popstate_home_clear' });
                return;
            }
            const q = String(state?.query || '');
            onSetSearchInputValue(q);
            if (q.trim().length >= 3) onPerformSearch(q);
            return;
        }

        onShowHome({ source: 'popstate_unknown', search: false });
    }

    function handlePageshow(e) {
        if (e?.persisted) onPageshowRestore({ state: historyRef.state || {} });
        if ((historyRef.state || {})?.view === 'home') safeCall(cfg?.onScrollTop);
    }

    function attach({ backToSearchBtn, homeLink } = {}) {
        if (backToSearchBtn?.addEventListener) {
            boundBackClick = () => handleBackToSearchClick();
            backToSearchBtn.addEventListener('click', boundBackClick);
        }
        if (homeLink?.addEventListener) {
            boundHomeClick = (ev) => {
                if (shouldIgnoreHomeClick(ev)) return;
                try { ev.preventDefault?.(); } catch { }
                handleHomeClick();
            };
            homeLink.addEventListener('click', boundHomeClick);
        }
        windowRef.addEventListener('popstate', handlePopstate);
        windowRef.addEventListener('pageshow', handlePageshow);
    }

    function detach({ backToSearchBtn, homeLink } = {}) {
        if (backToSearchBtn?.removeEventListener && boundBackClick) backToSearchBtn.removeEventListener('click', boundBackClick);
        if (homeLink?.removeEventListener && boundHomeClick) homeLink.removeEventListener('click', boundHomeClick);
        boundBackClick = null;
        boundHomeClick = null;
        windowRef.removeEventListener('popstate', handlePopstate);
        windowRef.removeEventListener('pageshow', handlePageshow);
    }

    return Object.freeze({
        attach,
        detach,
        replaceHome,
        pushHome,
        setSearchState,
        pushPreview,
        pushSchedule
    });
}
