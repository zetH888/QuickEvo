export function createPredictiveGhostController(cfg) {
    const searchInput = cfg?.searchInput || null;
    const ghostOverlay = cfg?.ghostOverlay || null;
    const ghostPrefix = cfg?.ghostPrefix || null;
    const ghostSuffix = cfg?.ghostSuffix || null;
    const suggestOverlay = cfg?.suggestOverlay || null;
    const suggestList = cfg?.suggestList || null;

    const isSearchEnabled = typeof cfg?.isSearchEnabled === 'function' ? cfg.isSearchEnabled : (() => false);
    const fuzzyNormalizeText = typeof cfg?.fuzzyNormalizeText === 'function' ? cfg.fuzzyNormalizeText : ((x) => String(x ?? '').trim().toLowerCase());
    const getPredictiveSuggestions = typeof cfg?.getPredictiveSuggestions === 'function' ? cfg.getPredictiveSuggestions : (() => ({ hasIndex: false, options: [] }));
    const onAcceptSuggestion = typeof cfg?.onAcceptSuggestion === 'function' ? cfg.onAcceptSuggestion : (() => { });

    const minChars = Number.isFinite(Number(cfg?.minChars)) ? Math.max(1, Number(cfg.minChars)) : 2;
    const maxDropdownItems = Number.isFinite(Number(cfg?.maxDropdownItems)) ? Math.max(1, Number(cfg.maxDropdownItems)) : 5;

    let isComposing = false;
    let state = { raw: '', norm: '', options: [], index: 0, hidden: false };
    let lastSuggestSig = '';

    function hide() {
        if (!ghostOverlay || !ghostPrefix || !ghostSuffix) return;
        ghostPrefix.textContent = '';
        ghostSuffix.textContent = '';
        ghostOverlay.classList.remove('qe-ghost-loading');
        ghostOverlay.classList.add('is-hidden');
    }

    function hideSuggest() {
        if (!suggestOverlay || !suggestList) return;
        suggestOverlay.classList.add('is-hidden');
        suggestList.textContent = '';
        lastSuggestSig = '';
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
        ghostOverlay.classList.toggle('is-hidden', ghostSuffix.textContent.length === 0);
        syncScroll();
    }

    function renderSuggestList() {
        if (!suggestOverlay || !suggestList || !searchInput) return;
        if (state.hidden) { hideSuggest(); return; }

        const query = String(state.norm || '').trim();
        const hasOptions = Array.isArray(state.options) && state.options.length > 0;
        if (!query || !hasOptions || query.length < minChars) { hideSuggest(); return; }

        const items = state.options.slice(0, maxDropdownItems).map(v => String(v || '').trim()).filter(Boolean);
        if (items.length === 0) { hideSuggest(); return; }

        const sig = `${query}::${state.index}::${items.join('\u0001')}`;
        if (sig === lastSuggestSig) return;
        lastSuggestSig = sig;

        const frag = document.createDocumentFragment();
        for (let i = 0; i < items.length; i++) {
            const value = items[i];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'qe-suggest-item' + (i === state.index ? ' is-active' : '');
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', i === state.index ? 'true' : 'false');
            btn.setAttribute('tabindex', '-1');
            btn.dataset.index = String(i);
            btn.textContent = value;
            frag.appendChild(btn);
        }

        suggestList.textContent = '';
        suggestList.appendChild(frag);
        suggestOverlay.classList.toggle('is-hidden', false);
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
            hideSuggest();
            return;
        }

        const res = getPredictiveSuggestions(norm, { lazyReason: 'predictive_lazy' });
        if (!res?.hasIndex) {
            state.hidden = true;
            hide();
            hideSuggest();
            return;
        }

        ghostOverlay.classList.remove('qe-ghost-loading');
        state.options = Array.isArray(res?.options) ? res.options : [];
        if (state.index >= Math.min(state.options.length, maxDropdownItems)) state.index = 0;
        if (source === 'input') state.index = 0;
        render();
        renderSuggestList();
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
        hideSuggest();
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

        if (key === 'ArrowDown' || key === 'ArrowUp') {
            e.preventDefault();
            state.hidden = false;
            const delta = key === 'ArrowDown' ? 1 : -1;
            const n = Math.min(state.options.length, maxDropdownItems);
            state.index = (state.index + delta + n) % n;
            render();
            renderSuggestList();
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
                hideSuggest();
            }
        }
    }

    function onScroll() { syncScroll(); }
    function onBlur() { hide(); hideSuggest(); }
    function onCompositionStart() { isComposing = true; hide(); }
    function onCompositionEnd(value) { isComposing = false; update(value, { source: 'compositionend' }); }

    function onSuggestMouseDown(e) {
        if (!e) return;
        try { e.preventDefault(); } catch { }
    }

    function onSuggestClick(e) {
        if (!e) return;
        const t = e?.target;
        const idx = Number(t?.dataset?.index);
        if (!Number.isFinite(idx) || idx < 0) return;
        if (!Array.isArray(state.options) || state.options.length === 0) return;
        state.index = Math.min(Math.min(state.options.length, maxDropdownItems) - 1, idx);
        const ok = acceptSuggestion();
        if (ok) {
            try { e.preventDefault(); } catch { }
        }
    }

    if (suggestList) {
        try { suggestList.addEventListener('mousedown', onSuggestMouseDown); } catch { }
        try { suggestList.addEventListener('click', onSuggestClick); } catch { }
    }

    return { update, onKeydown, onScroll, onBlur, onCompositionStart, onCompositionEnd, hide, hideSuggest };
}
