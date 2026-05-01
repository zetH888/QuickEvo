(function () {
    const MODULE_NS = 'QE_Debugger';
    const MAX_ENTRIES = 5000;
    const TRIM_CHUNK = 750;
    const INITIAL_RENDER_LIMIT = 600;
    const APPEND_BATCH_LIMIT = 120;

    const state = {
        mounted: false,
        open: false,
        entries: [],
        lastRenderedIndex: 0,
        renderScheduled: false,
        pendingClearConfirmUntil: 0,
        toastTimer: 0
    };

    const dom = {
        host: null,
        root: null,
        wrap: null,
        fab: null,
        panel: null,
        closeBtn: null,
        clearBtn: null,
        countEl: null,
        list: null,
        toast: null
    };

    const timeFmt = (() => {
        try { return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return null; }
    })();

    function now() { return Date.now(); }
    function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
    function raf(fn) { return window.requestAnimationFrame(fn); }

    function normalizeLevel(level) {
        const lvl = String(level || 'INFO').toUpperCase();
        if (lvl === 'ERROR' || lvl === 'WARN' || lvl === 'INFO') return lvl;
        if (lvl === 'WARNING') return 'WARN';
        return 'INFO';
    }

    function safeStringify(value, { maxLen = 1800, maxDepth = 5, maxKeys = 80 } = {}) {
        const seen = new WeakSet();
        function walk(v, depth) {
            if (depth > maxDepth) return '[…]';
            if (v == null) return v;
            const t = typeof v;
            if (t === 'string') return v.length > 1400 ? (v.slice(0, 1400) + '…') : v;
            if (t === 'number' || t === 'boolean') return v;
            if (t === 'bigint') return String(v) + 'n';
            if (t === 'function') return '[funkcja]';
            if (t !== 'object') return String(v);
            if (v instanceof Error) return { name: v.name, message: v.message, stack: String(v.stack || '').slice(0, 8000) };
            if (v instanceof Date) return v.toISOString();
            if (v instanceof URL) return v.toString();
            if (v instanceof Map) {
                const out = {};
                let i = 0;
                for (const [k, val] of v.entries()) { if (i++ >= maxKeys) break; out[String(k)] = walk(val, depth + 1); }
                return out;
            }
            if (v instanceof Set) {
                const out = [];
                let i = 0;
                for (const val of v.values()) { if (i++ >= maxKeys) break; out.push(walk(val, depth + 1)); }
                return out;
            }
            if (seen.has(v)) return '[cykl]';
            seen.add(v);
            if (Array.isArray(v)) {
                const out = [];
                for (let i = 0; i < Math.min(v.length, maxKeys); i++) out.push(walk(v[i], depth + 1));
                if (v.length > maxKeys) out.push(`[+${v.length - maxKeys}]`);
                return out;
            }
            const out = {};
            const keys = Object.keys(v);
            for (let i = 0; i < Math.min(keys.length, maxKeys); i++) {
                const k = keys[i];
                out[k] = walk(v[k], depth + 1);
            }
            if (keys.length > maxKeys) out.__moreKeys = keys.length - maxKeys;
            return out;
        }

        try {
            const json = JSON.stringify(walk(value, 0));
            return json.length > maxLen ? (json.slice(0, maxLen) + '…') : json;
        } catch {
            try { return String(value); } catch { return '[nie do zserializowania]'; }
        }
    }

    function formatTime(ts) {
        try { return timeFmt ? timeFmt.format(new Date(ts)) : new Date(ts).toLocaleTimeString(); } catch { return ''; }
    }

    function computeMessage(action, payload) {
        const act = String(action || '').trim();
        if (payload == null || payload === '') return act;
        const suffix = (typeof payload === 'string') ? payload : safeStringify(payload, { maxLen: 1600 });
        return act ? (act + ' ' + suffix) : suffix;
    }

    function ensureMounted() {
        if (state.mounted) return;
        state.mounted = true;

        dom.host = document.createElement('div');
        dom.host.id = 'qe-debugger';
        dom.host.style.position = 'fixed';
        dom.host.style.top = 'calc(12px + env(safe-area-inset-top))';
        dom.host.style.right = 'calc(12px + env(safe-area-inset-right))';
        dom.host.style.left = 'auto';
        dom.host.style.zIndex = '10050';
        dom.host.style.pointerEvents = 'auto';
        dom.host.style.contain = 'layout';
        dom.host.style.isolation = 'isolate';

        const root = dom.host.attachShadow({ mode: 'closed' });
        dom.root = root;
        root.appendChild(buildTemplate());

        document.body.appendChild(dom.host);
        setOpen(false);
        syncCount();
    }

    function buildTemplate() {
        const frag = document.createDocumentFragment();
        const style = document.createElement('style');
        style.textContent = `
:host{font-family:inherit; color:inherit}
.wrap{position:relative; pointer-events:auto; font-family:inherit}
.fab{pointer-events:auto; display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:14px; border:1px solid var(--border-color); background:var(--card-bg); background-clip: padding-box; box-shadow:none; filter:drop-shadow(0 10px 18px rgba(0,0,0,0.35)); color:var(--text-color); cursor:pointer; -webkit-tap-highlight-color:transparent; user-select:none; overflow:hidden; transform:translateZ(0); backface-visibility:hidden; will-change:transform; transition:transform 160ms ease, background 200ms ease, border-color 200ms ease, filter 200ms ease}
.fab:active{transform:translateY(1px) translateZ(0)}
.fab:focus-visible{outline:2px solid var(--primary-color); outline-offset:3px}
.fab svg{width:22px; height:22px; fill:var(--primary-color)}

.panel{pointer-events:auto; position:absolute; top:0; right:0; left:auto; margin-top:54px; width:min(520px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right))); max-height:min(62vh, 520px); display:flex; flex-direction:column; gap:0; background:var(--card-gradient); border:1px solid var(--border-color); border-radius:14px; box-shadow:var(--shadow); overflow:hidden; transform-origin:top right; transform:translateY(-6px) scale(0.98); opacity:0; visibility:hidden; transition:opacity 180ms ease, transform 180ms ease, visibility 180ms linear}
.wrap[data-open="true"] .panel{opacity:1; visibility:visible; transform:translateY(0) scale(1)}

.header{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 10px 8px 12px; border-bottom:1px solid var(--border-color); background:rgba(0,0,0,0)}
.title{display:flex; align-items:baseline; gap:8px; min-width:0}
.titleName{font-weight:800; letter-spacing:0.2px; color:var(--text-color); white-space:nowrap}
.count{font-weight:700; font-size:0.82rem; color:var(--secondary-text)}

.actions{display:flex; align-items:center; gap:8px}
.btn{appearance:none; border:1px solid var(--border-color); background:var(--state-hover); color:var(--text-color); border-radius:10px; padding:6px 10px; cursor:pointer; font-weight:800; line-height:1; display:inline-flex; align-items:center; gap:6px; transition:background 140ms ease, border-color 140ms ease, transform 120ms ease}
.btn:hover{background:var(--state-active)}
.btn:active{transform:translateY(1px)}
.btn:focus-visible{outline:2px solid var(--primary-color); outline-offset:2px}
.btn svg{width:16px; height:16px; fill:currentColor}
.btn--ghost{background:transparent}
.btn--danger{border-color:rgba(255, 107, 107, 0.5)}
.btn--danger:hover{background:rgba(255, 107, 107, 0.14)}

.list{padding:10px 10px 12px 10px; overflow:auto; overscroll-behavior:contain; display:flex; flex-direction:column; gap:8px}
.row{display:grid; grid-template-columns:90px 62px 1fr; gap:10px; align-items:start; padding:8px 10px; border-radius:12px; background:var(--state-hover); border:1px solid var(--grid-border)}
.time{font-variant-numeric:tabular-nums; font-weight:800; color:var(--secondary-text)}
.level{font-weight:900; letter-spacing:0.2px}
.level[data-lvl="INFO"]{color:var(--primary-color)}
.level[data-lvl="WARN"]{color:var(--state-warning)}
.level[data-lvl="ERROR"]{color:var(--state-error)}
.msg{color:var(--text-color); word-break:break-word; white-space:pre-wrap}

.toast{position:absolute; top:54px; right:0; left:auto; margin-top:6px; padding:8px 10px; border-radius:12px; border:1px solid var(--border-color); background:var(--card-bg); box-shadow:var(--shadow); color:var(--text-color); font-weight:800; opacity:0; transform:translateY(-4px); pointer-events:none; transition:opacity 160ms ease, transform 160ms ease}
.toast[data-show="true"]{opacity:1; transform:translateY(0)}

@media (max-width: 520px){
  .panel{max-height:min(62vh, 460px)}
  .row{grid-template-columns:82px 56px 1fr; gap:8px}
}

@media (prefers-reduced-motion: reduce){
  .fab, .panel, .toast, .btn{transition:none !important}
}

@media (forced-colors: active){
  .fab, .panel, .btn, .row, .toast{border:2px solid ButtonText !important}
  .msg, .titleName, .count, .time, .btn{color:ButtonText !important}
}
`;

        const wrap = document.createElement('div');
        wrap.className = 'wrap';
        wrap.setAttribute('data-open', 'false');
        dom.wrap = wrap;

        const fab = document.createElement('button');
        fab.className = 'fab';
        fab.type = 'button';
        fab.setAttribute('aria-label', 'Otwórz debugger');
        fab.setAttribute('aria-expanded', 'false');
        fab.innerHTML = bugIconSvg();
        dom.fab = fab;

        const panel = document.createElement('section');
        panel.className = 'panel';
        panel.setAttribute('aria-label', 'Debugger');
        panel.setAttribute('aria-hidden', 'true');
        dom.panel = panel;

        const header = document.createElement('div');
        header.className = 'header';

        const title = document.createElement('div');
        title.className = 'title';

        const titleName = document.createElement('div');
        titleName.className = 'titleName';
        titleName.textContent = 'Debugger';

        const count = document.createElement('div');
        count.className = 'count';
        count.textContent = '0';
        dom.countEl = count;

        title.appendChild(titleName);
        title.appendChild(count);

        const actions = document.createElement('div');
        actions.className = 'actions';

        const clearBtn = document.createElement('button');
        clearBtn.className = 'btn btn--danger';
        clearBtn.type = 'button';
        clearBtn.setAttribute('aria-label', 'Wyczyść logi');
        clearBtn.innerHTML = trashIconSvg() + '<span>Wyczyść</span>';
        dom.clearBtn = clearBtn;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn btn--ghost';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Zwiń debugger');
        closeBtn.innerHTML = closeIconSvg();
        dom.closeBtn = closeBtn;

        actions.appendChild(clearBtn);
        actions.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(actions);

        const list = document.createElement('div');
        list.className = 'list';
        list.setAttribute('role', 'log');
        list.setAttribute('aria-live', 'polite');
        dom.list = list;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.setAttribute('data-show', 'false');
        toast.setAttribute('aria-live', 'polite');
        dom.toast = toast;

        panel.appendChild(header);
        panel.appendChild(list);

        wrap.appendChild(fab);
        wrap.appendChild(panel);
        wrap.appendChild(toast);

        frag.appendChild(style);
        frag.appendChild(wrap);

        fab.addEventListener('click', () => setOpen(!state.open));
        closeBtn.addEventListener('click', () => setOpen(false));
        clearBtn.addEventListener('click', onClearClick);
        list.addEventListener('scroll', () => scheduleRender(), { passive: true });

        document.addEventListener('keydown', (e) => {
            if (!state.open) return;
            if (e.key === 'Escape') setOpen(false);
        }, { passive: true });

        return frag;
    }

    function setOpen(open) {
        state.open = Boolean(open);
        if (!dom.wrap || !dom.fab || !dom.panel) return;

        dom.wrap.setAttribute('data-open', state.open ? 'true' : 'false');
        dom.panel.setAttribute('aria-hidden', state.open ? 'false' : 'true');
        dom.fab.setAttribute('aria-expanded', state.open ? 'true' : 'false');
        dom.fab.setAttribute('aria-label', state.open ? 'Zwiń debugger' : 'Otwórz debugger');

        if (state.open) {
            if (dom.list) dom.list.scrollTop = dom.list.scrollHeight;
            state.lastRenderedIndex = Math.max(0, state.entries.length - INITIAL_RENDER_LIMIT);
            dom.list?.replaceChildren();
            scheduleRender({ forceFull: true });
        }
    }

    function syncCount() {
        if (!dom.countEl) return;
        dom.countEl.textContent = `${state.entries.length}`;
    }

    function showToast(text) {
        if (!dom.toast) return;
        window.clearTimeout(state.toastTimer);
        dom.toast.textContent = String(text || '');
        dom.toast.setAttribute('data-show', 'true');
        state.toastTimer = window.setTimeout(() => dom.toast && dom.toast.setAttribute('data-show', 'false'), 1600);
    }

    function onClearClick() {
        const t = now();
        if (t < state.pendingClearConfirmUntil) {
            clear();
            state.pendingClearConfirmUntil = 0;
            updateClearButton(false);
            showToast('Wyczyszczono logi');
            return;
        }

        state.pendingClearConfirmUntil = t + 1600;
        updateClearButton(true);
        window.setTimeout(() => {
            if (now() >= state.pendingClearConfirmUntil) {
                state.pendingClearConfirmUntil = 0;
                updateClearButton(false);
            }
        }, 1700);
    }

    function updateClearButton(confirming) {
        if (!dom.clearBtn) return;
        if (confirming) {
            dom.clearBtn.innerHTML = checkIconSvg() + '<span>Potwierdź</span>';
            dom.clearBtn.setAttribute('aria-label', 'Potwierdź czyszczenie logów');
        } else {
            dom.clearBtn.innerHTML = trashIconSvg() + '<span>Wyczyść</span>';
            dom.clearBtn.setAttribute('aria-label', 'Wyczyść logi');
        }
    }

    function isNearBottom(el, thresholdPx) {
        if (!el) return true;
        const t = Math.max(0, thresholdPx || 0);
        return (el.scrollHeight - el.scrollTop - el.clientHeight) <= t;
    }

    function scheduleRender(opts = {}) {
        if (!state.open) return;
        if (state.renderScheduled) return;
        state.renderScheduled = true;
        raf(() => {
            state.renderScheduled = false;
            render(opts);
        });
    }

    function render({ forceFull = false } = {}) {
        if (!state.open || !dom.list) return;
        syncCount();

        const stick = isNearBottom(dom.list, 28);

        if (forceFull) state.lastRenderedIndex = Math.max(0, state.entries.length - INITIAL_RENDER_LIMIT);

        const start = clamp(state.lastRenderedIndex, 0, state.entries.length);
        const toRender = state.entries.slice(start);

        if (forceFull) dom.list.replaceChildren();

        const frag = document.createDocumentFragment();
        const maxAppend = forceFull ? toRender.length : Math.min(APPEND_BATCH_LIMIT, toRender.length);
        for (let i = 0; i < maxAppend; i++) frag.appendChild(renderRow(toRender[i]));

        dom.list.appendChild(frag);
        state.lastRenderedIndex = start + maxAppend;

        if (state.lastRenderedIndex < state.entries.length) scheduleRender();
        if (stick) dom.list.scrollTop = dom.list.scrollHeight;
    }

    function renderRow(entry) {
        const row = document.createElement('div');
        row.className = 'row';
        row.setAttribute('data-lvl', entry.level);

        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = formatTime(entry.ts);

        const level = document.createElement('div');
        level.className = 'level';
        level.setAttribute('data-lvl', entry.level);
        level.textContent = entry.level;

        const msg = document.createElement('div');
        msg.className = 'msg';
        msg.textContent = entry.msg;
        msg.title = entry.msg.length > 220 ? entry.msg : '';

        row.appendChild(time);
        row.appendChild(level);
        row.appendChild(msg);
        return row;
    }

    function trimIfNeeded() {
        if (state.entries.length <= MAX_ENTRIES) return;
        const remove = Math.min(TRIM_CHUNK, Math.max(0, state.entries.length - MAX_ENTRIES));
        if (remove <= 0) return;
        state.entries.splice(0, remove);
        state.lastRenderedIndex = Math.max(0, state.lastRenderedIndex - remove);
    }

    function push(action, payload, level) {
        ensureMounted();
        const entry = {
            ts: now(),
            level: normalizeLevel(level),
            msg: computeMessage(action, payload)
        };

        state.entries.push(entry);
        trimIfNeeded();
        syncCount();

        if (state.open) scheduleRender();
    }

    function clear() {
        ensureMounted();
        state.entries = [];
        state.lastRenderedIndex = 0;
        if (dom.list) dom.list.replaceChildren();
        syncCount();
    }

    function toggle() { setOpen(!state.open); }
    function open() { setOpen(true); }
    function close() { setOpen(false); }

    function benchmark({ count = 4000 } = {}) {
        const n = clamp(Number(count) || 0, 0, 60000);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) push('benchmark', { i, payload: 'x'.repeat(32) }, 'INFO');
        const t1 = performance.now();
        open();
        const t2 = performance.now();
        return { count: n, pushMs: Math.round((t1 - t0) * 100) / 100, openMs: Math.round((t2 - t1) * 100) / 100 };
    }

    function bugIconSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8h-2.17A6 6 0 0 0 15 5.34V4a1 1 0 1 0-2 0v.54a6.2 6.2 0 0 0-2 0V4a1 1 0 1 0-2 0v1.34A6 6 0 0 0 6.17 8H4a1 1 0 1 0 0 2h1.26a6.2 6.2 0 0 0 0 4H4a1 1 0 1 0 0 2h2.17A6 6 0 0 0 9 18.66V20a1 1 0 1 0 2 0v-.54a6.2 6.2 0 0 0 2 0V20a1 1 0 1 0 2 0v-1.34A6 6 0 0 0 17.83 16H20a1 1 0 1 0 0-2h-1.26a6.2 6.2 0 0 0 0-4H20a1 1 0 1 0 0-2Zm-7 10.5c-.33.05-.67.05-1 0V17a1 1 0 1 0-2 0v1.2A4 4 0 0 1 8 14.42V14h8v.42A4 4 0 0 1 13 18.5ZM16 12H8v-.42A4 4 0 0 1 10 7.8V9a1 1 0 1 0 2 0V7.5c.33-.05.67-.05 1 0V9a1 1 0 1 0 2 0V7.8A4 4 0 0 1 16 11.58V12Z"/></svg>`;
    }

    function closeIconSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4Z"/></svg>`;
    }

    function trashIconSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h1v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9Zm1 2h4v0H10v0Zm-2 2h8v13H8V7Zm2 2a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0v-8a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0v-8a1 1 0 0 0-1-1Z"/></svg>`;
    }

    function checkIconSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12a1 1 0 1 1 1.4-1.4L9 13.4l8.8-8.8a1 1 0 1 1 1.4 1.4L9 16.2Z"/></svg>`;
    }

    function expose() {
        const api = {
            push,
            log: push,
            clear,
            open,
            close,
            toggle,
            benchmark,
            getEntries: () => state.entries.slice()
        };
        try { Object.defineProperty(window, MODULE_NS, { value: api, writable: false, configurable: false }); } catch { window[MODULE_NS] = api; }

        if (typeof window.logAction !== 'function') {
            window.logAction = function (action, payload, level) { push(action, payload, level); };
        }
    }

    function boot() {
        expose();
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ensureMounted(), { once: true });
        else ensureMounted();
    }

    boot();
})();
