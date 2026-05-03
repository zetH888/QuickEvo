(function () {
    const STORAGE_KEY = 'matrixThemeActive';
    const BODY_CLASS = 'matrix-theme';
    const CANVAS_CLASS = 'matrix-rain-canvas';
    const MIN_DESKTOP_WIDTH = 769;

    // Moduł odpowiada wyłącznie za easter egg motywu MATRIX® (bez ingerencji w logikę biznesową).
    // Animacja „digital rain” jest uruchamiana tylko w trybie desktopowym i tylko gdy motyw jest aktywny.
    // Parametry strojenia animacji (celowo w jednym miejscu, aby łatwo dopasować efekt bez grzebania w algorytmie).
    const TUNING = {
        // Mniejsza wartość = wolniejsze zanikanie ogona (dłuższa widoczność „tła”).
        // Ustawione ~2.5x wolniej niż poprzednio, aby znaki tła utrzymywały się dłużej.
        fadeRatePerSec: 0.9,
        // Minimalna widoczność ogona zanim zostanie pominięty w renderze.
        minTailAlpha: 0.015,
        // Mnożnik interwału spawnu: mniejszy = częstsze generowanie nowych znaków (szybsze „spływanie”).
        spawnIntervalMultiplier: 0.7,
        // Losowy jitter, aby kolumny nie synchronizowały się.
        spawnJitterMs: 18
    };
    const state = {
        active: false,
        running: false,
        rafId: 0,
        lastTs: 0,
        canvas: null,
        ctx: null,
        dpr: 1,
        fontSizeCssPx: 16,
        columns: 0,
        streams: [],
        glyphPool: '',
        onResize: null
    };

    function safeStorageGet(key) {
        try { return window.localStorage.getItem(key); } catch { return null; }
    }

    function safeStorageSet(key, value) {
        try { window.localStorage.setItem(key, value); } catch { }
    }

    function isDesktopViewport() {
        try { return window.innerWidth >= MIN_DESKTOP_WIDTH; } catch { return false; }
    }

    function ensureCanvas() {
        if (state.canvas) return;
        const canvas = document.createElement('canvas');
        canvas.className = CANVAS_CLASS;
        canvas.setAttribute('aria-hidden', 'true');
        canvas.tabIndex = -1;
        document.body.appendChild(canvas);
        state.canvas = canvas;
        state.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    }

    function removeCanvas() {
        if (!state.canvas) return;
        try { state.canvas.remove(); } catch { }
        state.canvas = null;
        state.ctx = null;
    }

    function nowMs() {
        return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
    }

    function resizeCanvasAndResetStreams() {
        if (!state.canvas || !state.ctx) return;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        state.dpr = dpr;

        const w = Math.max(1, Math.floor(window.innerWidth));
        const h = Math.max(1, Math.floor(window.innerHeight));
        state.fontSizeCssPx = Math.max(14, Math.min(18, Math.round(w / 70)));
        state.canvas.width = Math.floor(w * dpr);
        state.canvas.height = Math.floor(h * dpr);
        state.canvas.style.width = w + 'px';
        state.canvas.style.height = h + 'px';

        state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        state.ctx.textBaseline = 'top';
        state.ctx.font = `700 ${state.fontSizeCssPx}px monospace`;

        const cols = Math.max(1, Math.floor(w / state.fontSizeCssPx));
        state.columns = cols;
        const nextStreams = new Array(cols);

        for (let i = 0; i < cols; i++) {
            const existing = state.streams[i];
            if (existing) {
                existing.x = i * state.fontSizeCssPx;
                existing.fontSize = state.fontSizeCssPx;
                nextStreams[i] = existing;
                continue;
            }
            nextStreams[i] = createStream(i, w, h);
        }

        state.streams = nextStreams;
    }

    function randomGlyph() {
        if (!state.glyphPool) {
            state.glyphPool = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
            'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ' +
            '0123456789' +
            '@#$%&*+-=<>!?/\\|:;[]{}()';
        }
        const pool = state.glyphPool;
        return pool.charAt((Math.random() * pool.length) | 0);
    }

    function randomInt(min, max) {
        const a = Math.ceil(Number(min));
        const b = Math.floor(Number(max));
        if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
        if (a > b) return a;
        return Math.floor(a + Math.random() * (b - a + 1));
    }

    function createStream(index, w, h) {
        const fontSize = state.fontSizeCssPx;
        const maxLen = randomInt(14, 40);
        return {
            index,
            x: index * fontSize,
            fontSize,
            speed: 40 + Math.random() * 80,
            headY: -Math.random() * h,
            maxLen,
            cells: [],
            nextSpawnAt: nowMs() + Math.random() * 900
        };
    }

    function recycleStream(stream, h) {
        stream.headY = -Math.random() * Math.max(260, h);
        stream.speed = 40 + Math.random() * 80;
        stream.maxLen = randomInt(14, 40);
        stream.cells.length = 0;
        stream.nextSpawnAt = nowMs() + 120 + Math.random() * 1100;
    }

    // Spawnowanie jest krokowe: „głowa” strumienia nie przesuwa się płynnie.
    // Nowy znak pojawia się dokładnie pod poprzednią głową, a poprzednia głowa natychmiast przygasa.
    function spawnNext(stream) {
        const y = stream.cells.length === 0 ? stream.headY : (stream.headY + stream.fontSize);
        stream.headY = y;

        const prevHead = stream.cells[stream.cells.length - 1];
        if (prevHead && prevHead.isHead) {
            prevHead.isHead = false;
            prevHead.intensity = Math.min(prevHead.intensity, 0.55);
        }

        stream.cells.push({
            ch: randomGlyph(),
            y,
            intensity: 1,
            isHead: true
        });

        while (stream.cells.length > stream.maxLen) stream.cells.shift();
    }

    function frame(ts) {
        if (!state.running || !state.ctx || !state.canvas) return;

        const w = Math.max(1, Math.floor(window.innerWidth));
        const h = Math.max(1, Math.floor(window.innerHeight));

        const last = state.lastTs || ts;
        const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
        state.lastTs = ts;

        const ctx = state.ctx;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        const streams = state.streams;
        const fadeMul = Math.exp(-TUNING.fadeRatePerSec * dt);
        const minVisible = TUNING.minTailAlpha;
        const tNow = nowMs();

        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        for (let col = 0; col < streams.length; col++) {
            const s = streams[col];
            if (!s) continue;

            if (tNow >= s.nextSpawnAt) {
                spawnNext(s);
                const baseInterval = (s.fontSize / Math.max(1, s.speed)) * 1000 * TUNING.spawnIntervalMultiplier;
                const jitter = Math.random() * TUNING.spawnJitterMs;
                s.nextSpawnAt = tNow + baseInterval + jitter;
            }

            if (s.headY > h + (s.maxLen + 2) * s.fontSize) {
                recycleStream(s, h);
                continue;
            }

            for (let i = 0; i < s.cells.length; i++) {
                const cell = s.cells[i];
                if (!cell) continue;

                if (!cell.isHead) {
                    cell.intensity = cell.intensity * fadeMul;
                    if (cell.intensity < minVisible) continue;
                    if (Math.random() < 0.012) cell.ch = randomGlyph();
                } else {
                    cell.intensity = 0.92 + Math.random() * 0.08;
                }

                if (cell.y < -s.fontSize || cell.y > h + s.fontSize) continue;

                ctx.globalAlpha = Math.max(0, Math.min(1, cell.intensity));
                if (cell.isHead) {
                    ctx.fillStyle = '#c8ffd6';
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = 'rgba(0, 255, 65, 0.65)';
                } else {
                    ctx.fillStyle = '#00ff41';
                    ctx.shadowBlur = 0;
                    ctx.shadowColor = 'transparent';
                }
                ctx.fillText(cell.ch, s.x, cell.y);
            }
        }

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        state.rafId = window.requestAnimationFrame(frame);
    }

    function startRainIfAllowed() {
        if (!state.active) return;
        if (!isDesktopViewport()) return;
        if (state.running) return;

        ensureCanvas();
        resizeCanvasAndResetStreams();

        state.running = true;
        state.lastTs = 0;
        state.rafId = window.requestAnimationFrame(frame);
    }

    function stopRain() {
        if (!state.running) return;
        state.running = false;
        window.cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        state.lastTs = 0;
        removeCanvas();
    }

    function syncRainToViewport() {
        if (!state.active) {
            stopRain();
            return;
        }
        if (!isDesktopViewport()) {
            stopRain();
            return;
        }
        if (!state.running) startRainIfAllowed();
        else resizeCanvasAndResetStreams();
    }

    function setActive(nextActive) {
        const active = Boolean(nextActive);
        state.active = active;

        if (document.body) {
            document.body.classList.toggle(BODY_CLASS, active);
        }
        // Globalna flaga i event są celowo lekkie – pozwalają innym modułom (np. UI) reagować bez sprzęgania.
        try { window.isMatrixThemeActive = active; } catch { }
        try { window.dispatchEvent(new CustomEvent('qe:matrix-theme-changed', { detail: { active } })); } catch { }
        safeStorageSet(STORAGE_KEY, active ? 'true' : 'false');

        if (active) startRainIfAllowed();
        else stopRain();
    }

    function toggle() {
        setActive(!state.active);
        return state.active;
    }

    function initFromStorage() {
        const stored = safeStorageGet(STORAGE_KEY);
        const shouldBeActive = stored === 'true';
        setActive(shouldBeActive);
    }

    function createEasterEggButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'matrix-easter-egg';
        btn.setAttribute('aria-hidden', 'true');
        btn.tabIndex = -1;
        btn.dataset.active = state.active ? 'true' : 'false';
        btn.innerHTML = `<svg class="matrix-pill" viewBox="0 0 92 28" role="presentation" aria-hidden="true">
  <defs>
    <linearGradient id="pillBlue" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0096c7"/>
      <stop offset="1" stop-color="#00BFFF"/>
    </linearGradient>
    <linearGradient id="pillRed" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c1121f"/>
      <stop offset="1" stop-color="#FF0000"/>
    </linearGradient>
    <filter id="pillGlow" x="-30%" y="-60%" width="160%" height="220%">
      <feGaussianBlur stdDeviation="1.4" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0  0 0 0 0 1  0 0 0 0 0.25  0 0 0 0.85 0" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect x="1" y="1" width="90" height="26" rx="13" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.14)"/>
  <path d="M14 2h32v24H14c-6.6 0-12-5.4-12-12S7.4 2 14 2Z" fill="url(#pillBlue)" opacity="0.92"/>
  <path d="M46 2h32c6.6 0 12 5.4 12 12s-5.4 12-12 12H46V2Z" fill="url(#pillRed)" opacity="0.92"/>
  <text x="23.5" y="18" text-anchor="middle" font-family="Courier New, monospace" font-size="10" font-weight="900" fill="rgba(0,0,0,0.75)">STAY</text>
  <text x="68.5" y="18" text-anchor="middle" font-family="Courier New, monospace" font-size="10" font-weight="900" fill="rgba(0,0,0,0.75)">LEAVE</text>
  <g class="matrix-pill-knob" filter="url(#pillGlow)">
    <rect x="4" y="4" width="40" height="20" rx="10" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.22)"/>
    <path d="M14 7.2h3.4v13.6H14V7.2Zm5.4 0h3.4v13.6h-3.4V7.2Zm5.4 0h3.4v13.6h-3.4V7.2Z" fill="rgba(0,255,65,0.35)"/>
  </g>
</svg>`;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const next = toggle();
            btn.dataset.active = next ? 'true' : 'false';
        });
        window.addEventListener('qe:matrix-theme-changed', (ev) => {
            const next = Boolean(ev && ev.detail && ev.detail.active);
            btn.dataset.active = next ? 'true' : 'false';
        }, { passive: true });
        return btn;
    }

    function boot() {
        state.onResize = () => {
            if (!state.active) return;
            syncRainToViewport();
        };
        window.addEventListener('resize', state.onResize, { passive: true });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initFromStorage, { once: true, passive: true });
        } else {
            initFromStorage();
        }
    }

    const api = Object.freeze({
        toggle,
        setActive,
        isActive: () => state.active,
        createEasterEggButton
    });

    try { Object.defineProperty(window, 'QE_MatrixTheme', { value: api, writable: false, configurable: false }); } catch { window.QE_MatrixTheme = api; }
    boot();
})();

