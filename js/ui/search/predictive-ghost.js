/**
 * Kontroler predykcyjnych podpowiedzi inline.
 * Utrzymuje wyłącznie ghost text w polu wyszukiwania bez rozwijanej listy.
 *
 * @param {object} cfg
 * @returns {{ update: Function, onKeydown: Function, onScroll: Function, onBlur: Function, onCompositionStart: Function, onCompositionEnd: Function, hide: Function }}
 */
export function createPredictiveGhostController(cfg) {
    const searchInput = cfg?.searchInput || null;
    const ghostOverlay = cfg?.ghostOverlay || null;
    const ghostPrefix = cfg?.ghostPrefix || null;
    const ghostSuffix = cfg?.ghostSuffix || null;
    const ghostHint = cfg?.ghostHint || null;

    const isSearchEnabled = typeof cfg?.isSearchEnabled === 'function' ? cfg.isSearchEnabled : (() => false);
    const fuzzyNormalizeText = typeof cfg?.fuzzyNormalizeText === 'function' ? cfg.fuzzyNormalizeText : ((x) => String(x ?? '').trim().toLowerCase());
    const getPredictiveSuggestions = typeof cfg?.getPredictiveSuggestions === 'function' ? cfg.getPredictiveSuggestions : (() => ({ hasIndex: false, options: [] }));
    const onAcceptSuggestion = typeof cfg?.onAcceptSuggestion === 'function' ? cfg.onAcceptSuggestion : (() => { });

    const minChars = Number.isFinite(Number(cfg?.minChars)) ? Math.max(1, Number(cfg.minChars)) : 2;
    const maxNavigableItems = Number.isFinite(Number(cfg?.maxNavigableItems)) ? Math.max(1, Number(cfg.maxNavigableItems)) : 5;

    let isComposing = false;
    let state = { raw: '', norm: '', options: [], index: 0, hidden: false };

    function setHintVisible(visible) {
        if (!ghostHint) return;
        ghostHint.classList.toggle('is-visible', visible);
        ghostHint.tabIndex = visible ? 0 : -1;
        ghostHint.disabled = !visible;
    }

    function resetMouseDrivenScroll() {
        if (!searchInput) return;
        if ((Number(searchInput.scrollLeft) || 0) === 0) return;
        try { searchInput.scrollLeft = 0; } catch { }
        try { syncScroll(); } catch { }
    }

    /**
     * Ukrywa nakładkę podpowiedzi i czyści zawartość węzłów DOM.
     * Ustawia flagę ukrycia w stanie wewnętrznym, chroniąc przed niepożądanym ponownym renderem.
     */
    function hide() {
        state.hidden = true;
        if (!ghostOverlay || !ghostPrefix || !ghostSuffix) return;
        ghostPrefix.textContent = '';
        ghostSuffix.textContent = '';
        if (ghostHint) {
            setHintVisible(false);
        }
        ghostOverlay.classList.remove('qe-ghost-loading');
        ghostOverlay.classList.add('is-hidden');
    }

    /**
     * Całkowicie resetuje stan wewnętrzny kontrolera podpowiedzi ghost-autocomplete
     * oraz czyszcząc elementy nakładki w drzewie DOM.
     */
    function reset() {
        state = { raw: '', norm: '', options: [], index: 0, hidden: true };
        hide();
    }

    function syncScroll() {
        if (!ghostOverlay || !searchInput) return;
        ghostOverlay.scrollLeft = searchInput.scrollLeft;
    }

    function candidateStartsWithQuery(query, candidate) {
        const q = String(query ?? '').trim();
        const c = String(candidate ?? '').trim();
        if (!q || !c) return false;
        const qf = fuzzyNormalizeText(q);
        const cf = fuzzyNormalizeText(c);
        return cf.startsWith(qf);
    }

    function render() {
        if (!ghostOverlay || !ghostPrefix || !ghostSuffix || !searchInput) return;
        if (state.hidden) { hide(); return; }

        const query = String(state.raw || '');
        const suggestion = state.options[state.index] || '';

        if (!query || !suggestion || suggestion.length <= query.length ||
            String(state.norm || '') !== query ||
            !candidateStartsWithQuery(state.norm, suggestion)) {
            if (!ghostOverlay.classList.contains('qe-ghost-loading')) hide();
            return;
        }

        const selStart = Number(searchInput.selectionStart ?? 0);
        const selEnd = Number(searchInput.selectionEnd ?? 0);
        if (selStart !== selEnd || selEnd !== query.length) { hide(); return; }

        ghostOverlay.classList.remove('qe-ghost-loading');
        ghostPrefix.textContent = query;
        ghostSuffix.textContent = String(suggestion).slice(query.length);
        if (ghostHint) {
            const showCyclingHint = state.options.length > 1;
            setHintVisible(showCyclingHint);
        }
        ghostOverlay.classList.toggle('is-hidden', ghostSuffix.textContent.length === 0);
        syncScroll();
    }

    function update(query, { source } = {}) {
        if (isComposing) return;
        if (!ghostOverlay || !ghostPrefix || !ghostSuffix || !searchInput) return;

        const raw = String(query ?? '');
        const norm = raw.trim();
        const changed = raw !== state.raw;

        if (changed) {
            state = { raw, norm, options: [], index: 0, hidden: false };
            if (norm.length >= minChars) {
                ghostOverlay.classList.remove('is-hidden');
                ghostOverlay.classList.add('qe-ghost-loading');
            }
        } else {
            state.raw = raw;
            state.norm = norm;
        }

        if (!isSearchEnabled() || norm.length < minChars || raw !== norm) {
            state.hidden = true;
            hide();
            return;
        }

        const res = getPredictiveSuggestions(norm, { lazyReason: 'predictive_lazy' });
        if (!res?.hasIndex) {
            state.hidden = true;
            hide();
            return;
        }

        ghostOverlay.classList.remove('qe-ghost-loading');
        state.options = Array.isArray(res?.options)
            ? res.options
                // Ograniczamy liczbę pozycji do sensownego zakresu nawigacji klawiaturą.
                .slice(0, maxNavigableItems)
                .map((value) => String(value || '').trim())
                .filter(Boolean)
            : [];
        if (state.index >= state.options.length) state.index = 0;
        if (source === 'input') state.index = 0;
        render();
    }

    function acceptSuggestion() {
        const query = String(state.norm || '').trim();
        const suggestion = state.options[state.index] || '';
        if (!query || !suggestion || suggestion.length <= query.length) return false;
        if (!candidateStartsWithQuery(query, suggestion)) return false;
        if (!searchInput) return false;

        searchInput.value = suggestion;
        try { searchInput.setSelectionRange(suggestion.length, suggestion.length); } catch { }
        state = { raw: suggestion, norm: suggestion, options: [], index: 0, hidden: false };
        try { onAcceptSuggestion(query, suggestion); } catch { }
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function cycleSuggestion(delta = 1) {
        if (!Array.isArray(state.options) || state.options.length <= 1) return false;
        state.hidden = false;
        const n = state.options.length;
        state.index = (state.index + delta + n) % n;
        render();
        return true;
    }

    function onKeydown(e) {
        if (!isSearchEnabled() || isComposing) return;
        if (!e || !searchInput) return;

        const key = String(e.key || '');
        const raw = String(searchInput.value || '');
        const norm = raw.trim();
        if (norm.length < minChars || raw !== norm) return;

        update(raw, { source: 'keydown' });

        const hasOptions = Array.isArray(state.options) && state.options.length > 0;
        if (!hasOptions) return;

        if ((key === 'ArrowDown' || key === 'ArrowUp') && state.options.length > 1) {
            e.preventDefault();
            const delta = key === 'ArrowDown' ? 1 : -1;
            cycleSuggestion(delta);
            return;
        }

        const canAccept = (key === 'Tab') || (key === 'Enter') || (key === 'ArrowRight' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey);
        if (canAccept) {
            if (!ghostOverlay?.classList.contains('is-hidden')) {
                const ok = acceptSuggestion();
                if (ok) {
                    e.preventDefault();
                    return;
                }
            }
        }

        if (key === 'Escape') {
            if (!ghostOverlay?.classList.contains('is-hidden')) {
                e.preventDefault();
                state.hidden = true;
                hide();
            }
        }
    }

    function onScroll() { syncScroll(); }
    function onBlur() { syncScroll(); }
    function onCompositionStart() { isComposing = true; hide(); }
    function onCompositionEnd(value) { isComposing = false; update(value, { source: 'compositionend' }); }

    function onHintMouseDown(e) {
        if (!e) return;
        try { e.preventDefault(); } catch { }
    }

    function onHintClick(e) {
        if (!e) return;
        try { e.preventDefault(); } catch { }
        const changed = cycleSuggestion(1);
        if (changed) {
            try { searchInput?.focus({ preventScroll: true }); } catch { try { searchInput?.focus(); } catch { } }
        }
    }

    function onViewportResize() {
        if (!ghostOverlay || ghostOverlay.classList.contains('is-hidden') || state.hidden) return;
        render();
    }

    function onInputWheel(e) {
        if (!e || !searchInput) return;
        const attemptsHorizontalScroll = Math.abs(Number(e.deltaX) || 0) > 0 || Boolean(e.shiftKey) || (Number(searchInput.scrollLeft) || 0) > 0;
        if (!attemptsHorizontalScroll) return;
        try { e.preventDefault(); } catch { }
        resetMouseDrivenScroll();
    }

    function onInputPointerUp() {
        resetMouseDrivenScroll();
    }

    if (ghostHint) {
        try { ghostHint.addEventListener('mousedown', onHintMouseDown); } catch { }
        try { ghostHint.addEventListener('click', onHintClick); } catch { }
    }
    if (searchInput) {
        try { searchInput.addEventListener('wheel', onInputWheel, { passive: false }); } catch { }
        try { searchInput.addEventListener('pointerup', onInputPointerUp, { passive: true }); } catch { }
        try { searchInput.addEventListener('mouseup', onInputPointerUp, { passive: true }); } catch { }
    }
    try { window.addEventListener('resize', onViewportResize, { passive: true }); } catch { }

    return { update, onKeydown, onScroll, onBlur, onCompositionStart, onCompositionEnd, hide, reset };
}
