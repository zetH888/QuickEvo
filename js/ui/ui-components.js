/**
 * @module ui-components
 *
 * Moduł odpowiedzialny za warstwę UI (renderowanie i animacje) bez zależności od stanu domenowego aplikacji.
 * Funkcje przyjmują zależności jawnie przez parametry, aby nie polegać na globalnym scope.
 */

import { clampNumber, normalizeText } from '../core/utils.js';

export function getLoadingTitleCategoryForProgress(progressPercent) {
    const p = clampNumber(progressPercent, 0, 100);
    if (p >= 100) return 'powitalne';
    if (p <= 20) return 'startowe';
    if (p <= 50) return 'techniczne';
    if (p <= 80) return 'absurdalne';
    return 'finalizujace';
}

export function pickRandomNonRepeating(items, lastValue) {
    if (!Array.isArray(items) || items.length === 0) return '';
    if (items.length === 1) return items[0];
    let next = items[Math.floor(Math.random() * items.length)];
    if (typeof lastValue === 'string' && lastValue.length > 0) {
        let guard = 0;
        while (next === lastValue && guard < 12) {
            next = items[Math.floor(Math.random() * items.length)];
            guard += 1;
        }
    }
    return next;
}

export function setLoadingTitleContent(el, nextText) {
    if (!el) return;
    const raw = String(nextText || '').trim();
    if (raw.length === 0) return;
    const normalized = raw.replace(/[✅✔🗸]/g, '✓');
    let hasCheck = false;
    const frag = document.createDocumentFragment();
    for (const ch of Array.from(normalized)) {
        if (ch === '✓') {
            hasCheck = true;
            const s = document.createElement('span');
            s.className = 'qe-check';
            s.textContent = ch;
            frag.appendChild(s);
            continue;
        }
        frag.appendChild(document.createTextNode(ch));
    }
    el.replaceChildren(frag);
    el.classList.toggle('qe-title-has-check', hasCheck);
}

export async function animateLoadingTitleSwap(el, nextText, { reducedMotion, fadeOutMs = 0, fadeInMs = 0 } = {}) {
    if (!el) return;
    const text = String(nextText || '').trim();
    if (text.length === 0) return;
    if (reducedMotion) { setLoadingTitleContent(el, text); el.style.opacity = '1'; return; }

    const fade = (from, to, durationMs) => new Promise((resolve) => {
        try {
            if (typeof el.animate === 'function') {
                const anim = el.animate(
                    [{ opacity: from }, { opacity: to }],
                    { duration: durationMs, easing: 'ease', fill: 'forwards' }
                );
                anim.addEventListener('finish', () => resolve(), { once: true });
                anim.addEventListener('cancel', () => resolve(), { once: true });
            } else {
                el.style.transition = `opacity ${durationMs}ms ease`;
                el.style.opacity = String(to);
                window.setTimeout(() => resolve(), durationMs);
            }
        } catch {
            el.style.opacity = String(to);
            window.setTimeout(() => resolve(), durationMs);
        }
    });

    await fade(1, 0, fadeOutMs);
    setLoadingTitleContent(el, text);
    await fade(0, 1, fadeInMs);
    el.style.opacity = '1';
}

export class LoadingTitleRotator {
    constructor(cfg) {
        this._el = cfg?.el || null;
        this._getProgress = typeof cfg?.getProgress === 'function' ? cfg.getProgress : (() => 0);
        this._getMessagesForProgress = typeof cfg?.getMessagesForProgress === 'function' ? cfg.getMessagesForProgress : (() => []);
        this._prefersReducedMotion = typeof cfg?.prefersReducedMotion === 'function' ? cfg.prefersReducedMotion : (() => false);
        this._fadeOutMs = Number(cfg?.fadeOutMs || 0);
        this._fadeInMs = Number(cfg?.fadeInMs || 0);
        this._intervalMinMs = Number(cfg?.intervalMinMs || 0);
        this._intervalMaxMs = Number(cfg?.intervalMaxMs || 0);

        this._timer = null;
        this._running = false;
        this._reducedMotion = false;
        this._lastMessage = '';
        this._animSeq = 0;
    }

    start() {
        if (this._running) return;
        if (!this._el) return;
        this._running = true;
        this._reducedMotion = this._prefersReducedMotion();
        this._scheduleNext({ immediate: true });
    }

    stop() {
        this._running = false;
        this._animSeq += 1;
        if (this._timer !== null) {
            window.clearTimeout(this._timer);
            this._timer = null;
        }
        if (this._el) {
            this._el.style.opacity = '1';
        }
    }

    _scheduleNext({ immediate } = {}) {
        if (!this._running) return;
        if (!this._el) return;

        const min = Math.max(0, this._intervalMinMs);
        const max = Math.max(min, this._intervalMaxMs);
        const delay = immediate ? 0 : Math.floor(min + Math.random() * (max - min));

        if (this._timer !== null) window.clearTimeout(this._timer);
        this._timer = window.setTimeout(() => {
            this._timer = null;
            void this._tick();
        }, delay);
    }

    async _tick() {
        if (!this._running) return;
        if (!this._el) return;

        const progress = clampNumber(this._getProgress(), 0, 100);
        const pool = this._getMessagesForProgress(progress) || [];
        const next = pickRandomNonRepeating(pool, this._lastMessage);
        if (!next) {
            if (progress >= 100) { this.stop(); return; }
            this._scheduleNext();
            return;
        }

        const seq = (this._animSeq += 1);
        await animateLoadingTitleSwap(this._el, next, { reducedMotion: this._reducedMotion, fadeOutMs: this._fadeOutMs, fadeInMs: this._fadeInMs });
        if (!this._running) return;
        if (seq !== this._animSeq) return;
        this._lastMessage = next;
        if (progress >= 100) { this.stop(); return; }
        this._scheduleNext();
    }
}

function randomIntInclusive(min, max) {
    const a = Math.ceil(Number(min));
    const b = Math.floor(Number(max));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    if (a > b) return a;
    return Math.floor(a + Math.random() * (b - a + 1));
}

function randomFloat(min, max) {
    const a = Number(min), b = Number(max);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    if (a > b) return a;
    return a + Math.random() * (b - a);
}

function getSoftCapLeadAllowance(displayPercent) {
    const p = clampNumber(displayPercent, 0, 100);
    if (p < 25) return 10;
    if (p < 60) return 7;
    if (p < 85) return 5;
    if (p < 95) return 3;
    return 1.5;
}

export function createLoadingProgressController(cfg) {
    const els = cfg?.els || {};
    const updateContinueAvailability = typeof cfg?.updateContinueAvailability === 'function' ? cfg.updateContinueAvailability : (() => { });
    const syncPendingFinalLoadingStatusText = typeof cfg?.syncPendingFinalLoadingStatusText === 'function' ? cfg.syncPendingFinalLoadingStatusText : (() => { });
    const isVisualFinishAllowed = typeof cfg?.isVisualFinishAllowed === 'function' ? cfg.isVisualFinishAllowed : (() => false);
    const prefersReducedMotion = typeof cfg?.prefersReducedMotion === 'function' ? cfg.prefersReducedMotion : (() => false);

    const softCapBeforeFinish = Number(cfg?.softCapBeforeFinish ?? 97);
    const microStopMinMs = Number(cfg?.microStopMinMs ?? 200);
    const microStopMaxMs = Number(cfg?.microStopMaxMs ?? 500);
    const jumpMin = Number(cfg?.jumpMin ?? 1);
    const jumpMax = Number(cfg?.jumpMax ?? 5);

    let targetPercent = 0;
    let displayPercent = 0;
    let rafId = 0;
    let lastFrameTs = 0;

    const sim = {
        runId: 0,
        pauseUntilTs: 0,
        pauseTimerId: null,
        nextMicroStopAtTs: 0,
        nextJumpAtTs: 0,
        speedDriftUntilTs: 0,
        speedMultiplier: 1,
        boostUntilTs: 0,
        lastTargetValue: 0,
        profile: null
    };

    function isOverlayActive() {
        const overlay = els?.loadingOverlay;
        return Boolean(overlay && !overlay.classList.contains('hidden'));
    }

    function setDisplayPercentInternal(percent) {
        const next = clampNumber(percent, 0, 100);
        displayPercent = next;
        if (els?.loadingProgressMeta) els.loadingProgressMeta.textContent = `${Math.round(next)}%`;
        if (els?.loadingProgressBar) els.loadingProgressBar.value = next;
        updateContinueAvailability();
        syncPendingFinalLoadingStatusText();
    }

    function stop() {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        lastFrameTs = 0;
        if (sim.pauseTimerId !== null) {
            window.clearTimeout(sim.pauseTimerId);
            sim.pauseTimerId = null;
        }
    }

    function kick() {
        if (rafId) return;
        lastFrameTs = performance.now();
        rafId = window.requestAnimationFrame(step);
    }

    function step(ts) {
        rafId = 0;
        if (!isOverlayActive()) return;

        const display = clampNumber(displayPercent, 0, 100);
        if (prefersReducedMotion()) {
            setDisplayPercentInternal(targetPercent);
            return;
        }

        const dt = Math.max(0, ts - (lastFrameTs || ts));
        lastFrameTs = ts;

        const rawTarget = clampNumber(targetPercent, 0, 100);
        const finishAllowed = isVisualFinishAllowed();
        const hardCap = finishAllowed ? 100 : softCapBeforeFinish;
        const lead = getSoftCapLeadAllowance(display);
        const cap = clampNumber(Math.min(hardCap, Math.max(display, rawTarget + lead)), 0, 100);

        const now = ts;

        if (sim.profile === null) {
            sim.profile = {
                fastPps: randomFloat(22, 34),
                midPps: randomFloat(10, 18),
                cruisePps: randomFloat(6, 12),
                tailPps: randomFloat(1.2, 3.6),
                finalPps: randomFloat(18, 34)
            };
        }

        if (rawTarget > sim.lastTargetValue) {
            const delta = rawTarget - sim.lastTargetValue;
            if (delta >= 6) {
                sim.boostUntilTs = Math.max(sim.boostUntilTs, now + randomIntInclusive(450, 1100));
            }
            sim.lastTargetValue = rawTarget;
        }

        if (sim.pauseUntilTs > 0 && now < sim.pauseUntilTs) {
            if (sim.pauseTimerId === null) {
                const remaining = Math.max(0, sim.pauseUntilTs - now);
                sim.pauseTimerId = window.setTimeout(() => {
                    sim.pauseTimerId = null;
                    kick();
                }, Math.min(remaining + 12, 220));
            }
            return;
        }

        if (sim.pauseTimerId !== null) {
            window.clearTimeout(sim.pauseTimerId);
            sim.pauseTimerId = null;
        }

        if (now >= sim.speedDriftUntilTs) {
            sim.speedMultiplier = randomFloat(0.82, 1.22);
            sim.speedDriftUntilTs = now + randomIntInclusive(260, 720);
            if (display < 85 && Math.random() < 0.22) {
                sim.boostUntilTs = Math.max(sim.boostUntilTs, now + randomIntInclusive(280, 720));
            }
        }

        if (now >= sim.nextMicroStopAtTs) {
            sim.nextMicroStopAtTs = now + randomIntInclusive(420, 1350);
            const p = display;
            const stopChance = p < 20 ? 0.12 : (p < 60 ? 0.22 : (p < 85 ? 0.18 : 0.10));
            const nearCap = (cap - display) < 1.2;
            if (!nearCap && Math.random() < stopChance) {
                sim.pauseUntilTs = now + randomIntInclusive(microStopMinMs, microStopMaxMs);
                kick();
                return;
            }
        }

        let basePps;
        if (display < 25) basePps = sim.profile.fastPps;
        else if (display < 60) basePps = sim.profile.midPps;
        else if (display < 85) basePps = sim.profile.cruisePps;
        else if (display < 97) basePps = sim.profile.tailPps;
        else basePps = sim.profile.tailPps * 0.75;

        const boost = (now < sim.boostUntilTs) ? randomFloat(1.35, 1.95) : 1;
        const requestedSpeedPps = basePps * sim.speedMultiplier * boost;

        let next = display;

        if (finishAllowed && rawTarget >= 100 && display >= 97) {
            next = Math.min(100, display + (dt / 1000) * sim.profile.finalPps);
        } else {
            next = Math.min(cap, display + (dt / 1000) * requestedSpeedPps);
        }

        if (now >= sim.nextJumpAtTs) {
            const minGap = display < 25 ? 260 : (display < 85 ? 340 : 520);
            const maxGap = display < 25 ? 720 : (display < 85 ? 980 : 1320);
            sim.nextJumpAtTs = now + randomIntInclusive(minGap, maxGap);

            const room = cap - next;
            if (room > 0.8 && Math.random() < 0.78) {
                const maxJump = display >= 85 ? 2 : jumpMax;
                const jump = Math.min(room, randomIntInclusive(jumpMin, maxJump));
                if (jump >= 0.9) {
                    next = Math.min(cap, next + jump);
                }
            }
        }

        if (next !== display) setDisplayPercentInternal(next);
        if (next < cap) kick();
    }

    function setTargetPercent(nextPercent, { force = false } = {}) {
        const target = clampNumber(nextPercent, 0, 100);
        targetPercent = force ? target : Math.max(targetPercent, target);
        if (!isOverlayActive()) return;
        if (prefersReducedMotion()) {
            setDisplayPercentInternal(targetPercent);
            return;
        }
        kick();
    }

    function reset() {
        stop();
        sim.runId += 1;
        sim.pauseUntilTs = 0;
        if (sim.pauseTimerId !== null) {
            window.clearTimeout(sim.pauseTimerId);
            sim.pauseTimerId = null;
        }
        sim.nextMicroStopAtTs = performance.now() + randomIntInclusive(280, 750);
        sim.nextJumpAtTs = performance.now() + randomIntInclusive(220, 620);
        sim.speedDriftUntilTs = 0;
        sim.speedMultiplier = 1;
        sim.boostUntilTs = 0;
        sim.lastTargetValue = 0;
        sim.profile = null;
        targetPercent = 0;
        setDisplayPercentInternal(0);
    }

    function start() {
        if (!isOverlayActive()) return;
        if (prefersReducedMotion()) {
            setDisplayPercentInternal(targetPercent);
            return;
        }
        kick();
    }

    return {
        getTargetPercent: () => targetPercent,
        getDisplayPercent: () => displayPercent,
        setTargetPercent,
        reset,
        start,
        stop
    };
}

export function setLoadingStatusTextDom(loadingStatusTextEl, nextText) {
    if (!loadingStatusTextEl) return;
    loadingStatusTextEl.textContent = String(nextText || '');
}

export function showLoadingErrorDom(loadingErrorEl, message) {
    if (!loadingErrorEl) return;
    loadingErrorEl.textContent = String(message || 'Nieznany błąd ładowania.');
    loadingErrorEl.classList.remove('hidden');
}

export function clearLoadingErrorDom(loadingErrorEl) {
    if (!loadingErrorEl) return;
    loadingErrorEl.textContent = '';
    loadingErrorEl.classList.add('hidden');
}

export function setLoadingTitleTextDom(loadingTitleTextEl, nextText) {
    if (!loadingTitleTextEl) return;
    loadingTitleTextEl.textContent = String(nextText || '');
    loadingTitleTextEl.style.opacity = '1';
}

export function applyWelcomeElementsInitStateDom({ loadingOverlay, loadingStatusTextEl, loadingErrorEl } = {}) {
    if (!loadingOverlay) return;
    const welcomeText = document.getElementById('welcome-text');
    const loadingActions = loadingOverlay.querySelector('.loading-actions');
    const nodes = [welcomeText, loadingStatusTextEl, loadingOverlay.querySelector('.loading-progress'), loadingActions, loadingErrorEl].filter(Boolean);
    for (const el of nodes) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(12px) scale(0.992)';
        el.style.filter = 'blur(12px)';
    }
    if (loadingActions) loadingActions.style.pointerEvents = 'none';
}

export function clearWelcomeElementsInitStateDom({ loadingOverlay, loadingStatusTextEl, loadingErrorEl } = {}) {
    if (!loadingOverlay) return;
    const welcomeText = document.getElementById('welcome-text');
    const loadingActions = loadingOverlay.querySelector('.loading-actions');
    const nodes = [welcomeText, loadingStatusTextEl, loadingOverlay.querySelector('.loading-progress'), loadingActions, loadingErrorEl].filter(Boolean);
    for (const el of nodes) {
        el.style.opacity = '';
        el.style.transform = '';
        el.style.filter = '';
    }
    if (loadingActions) loadingActions.style.pointerEvents = '';
}

export function showLoadingOverlayDom({ loadingOverlay, loadingErrorEl, loadingContinueButtonEl, welcomeGraphicEl } = {}) {
    if (!loadingOverlay) return;
    loadingOverlay.dataset.welcomeSeq = 'init';
    loadingOverlay.classList.remove('hidden');
    loadingOverlay.setAttribute('aria-hidden', 'false');
    loadingOverlay.setAttribute('aria-busy', 'true');

    clearLoadingErrorDom(loadingErrorEl);
    if (loadingContinueButtonEl) loadingContinueButtonEl.disabled = true;
    if (welcomeGraphicEl) welcomeGraphicEl.classList.remove('welcome-graphic--ready');
}

export function hideLoadingOverlayDom({ loadingOverlay, fadeOutMs = 600 } = {}) {
    if (!loadingOverlay) return;
    loadingOverlay.classList.add('loading-overlay-fade-out');
    window.setTimeout(() => {
        loadingOverlay.classList.add('hidden');
        loadingOverlay.classList.remove('loading-overlay-fade-out');
    }, Math.max(0, Number(fadeOutMs) || 0));
    loadingOverlay.setAttribute('aria-hidden', 'true');
}

export function scheduleWelcomeLogoEntranceDom(cfg) {
    const loadingOverlay = cfg?.loadingOverlay || null;
    const container = cfg?.container || null;
    const clearWelcomeElementsInitState = typeof cfg?.clearWelcomeElementsInitState === 'function'
        ? cfg.clearWelcomeElementsInitState
        : (() => { });
    const completeWelcomeEntrance = typeof cfg?.completeWelcomeEntrance === 'function'
        ? cfg.completeWelcomeEntrance
        : (() => { });
    const forceWelcomeSequenceDone = typeof cfg?.forceWelcomeSequenceDone === 'function'
        ? cfg.forceWelcomeSequenceDone
        : (() => { });

    const enterDelayMs = Number(cfg?.enterDelayMs ?? 0);
    const unlockAfterMs = Number(cfg?.unlockAfterMs ?? 0);
    const failSafeExtraMs = Number(cfg?.failSafeExtraMs ?? 0);

    if (!loadingOverlay || !container) return { enterTimerId: null, unlockTimerId: null, failSafeTimerId: null };

    const baseTs = Number(cfg?.baseTs);
    const base = Number.isFinite(baseTs) && baseTs > 0 ? baseTs : performance.now();
    const elapsed = performance.now() - base;
    const remaining = Math.max(0, enterDelayMs - elapsed);

    const timers = { enterTimerId: null, unlockTimerId: null, failSafeTimerId: null };

    const run = () => {
        if (!loadingOverlay) return;
        loadingOverlay.dataset.welcomeSeq = 'ready';
        clearWelcomeElementsInitState();
        if (!container.classList.contains('welcome-graphic--ready')) container.classList.add('welcome-graphic--ready');
        timers.unlockTimerId = window.setTimeout(() => {
            timers.unlockTimerId = null;
            completeWelcomeEntrance();
        }, Math.max(0, unlockAfterMs));
    };

    timers.enterTimerId = window.setTimeout(() => { timers.enterTimerId = null; run(); }, remaining);
    timers.failSafeTimerId = window.setTimeout(() => {
        timers.failSafeTimerId = null;
        if (!loadingOverlay) return;
        if (loadingOverlay.dataset.welcomeSeq === 'done') return;
        if (!container.classList.contains('welcome-graphic--ready')) container.classList.add('welcome-graphic--ready');
        forceWelcomeSequenceDone();
    }, remaining + Math.max(0, unlockAfterMs) + Math.max(0, failSafeExtraMs));

    return timers;
}

export function createModalController(cfg) {
    const modalOverlay = cfg?.modalOverlay || null;
    const modalTitle = cfg?.modalTitle || null;
    const modalContent = cfg?.modalContent || null;
    const modalActions = cfg?.modalActions || null;

    const buildTitleHtml = typeof cfg?.buildTitleHtml === 'function' ? cfg.buildTitleHtml : ((t) => ({ html: String(t || ''), hasDrive: false }));
    const setElementHtml = typeof cfg?.setElementHtml === 'function' ? cfg.setElementHtml : ((el, html) => { if (el) el.innerHTML = String(html ?? ''); });
    const clearElement = typeof cfg?.clearElement === 'function' ? cfg.clearElement : ((el) => { if (el) el.replaceChildren(); });
    const onBeforeHide = typeof cfg?.onBeforeHide === 'function' ? cfg.onBeforeHide : (() => { });

    function show(title, content, actions = []) {
        if (!modalOverlay || !modalTitle || !modalContent || !modalActions) return;
        const { html, hasDrive } = buildTitleHtml(title);
        modalTitle.innerHTML = html;
        modalTitle.classList.toggle('qe-modal-title--gdrive', Boolean(hasDrive));
        setElementHtml(modalContent, content);
        clearElement(modalActions);
        (Array.isArray(actions) ? actions : []).forEach(action => {
            const btn = document.createElement('button');
            btn.className = `modal-btn ${action.class || ''}`;
            btn.textContent = action.label;
            btn.onclick = () => { hide(); if (typeof action.onClick === 'function') action.onClick(); };
            modalActions.appendChild(btn);
        });
        modalOverlay.classList.remove('hidden');
        modalOverlay.setAttribute('aria-hidden', 'false');
    }

    function hide() {
        onBeforeHide();
        if (!modalOverlay) return;
        modalOverlay.classList.add('hidden');
        modalOverlay.setAttribute('aria-hidden', 'true');
    }

    return { show, hide };
}

export function updateResultsCountInfoDom(resultsInfoEl, { matchedCount = 0, loadedFileCount = 0 } = {}) {
    if (!resultsInfoEl) return;
    const a = Number.isFinite(matchedCount) ? matchedCount : 0;
    const b = Number.isFinite(loadedFileCount) ? loadedFileCount : 0;
    resultsInfoEl.innerHTML = `Trasy: ${a} / ${b}`;
}

export function createPreviewController(cfg) {
    const searchView = cfg?.searchView || null;
    const filePreviewView = cfg?.filePreviewView || null;
    const previewMeta = cfg?.previewMeta || null;
    const previewFileName = cfg?.previewFileName || null;
    const tableHeader = cfg?.tableHeader || null;
    const tableBody = cfg?.tableBody || null;

    const formatFileName = typeof cfg?.formatFileName === 'function' ? cfg.formatFileName : ((x) => String(x || ''));
    const getRouteCategoriesFromFileName = typeof cfg?.getRouteCategoriesFromFileName === 'function'
        ? cfg.getRouteCategoriesFromFileName
        : (() => []);

    function clearElement(el) {
        if (!el) return;
        el.replaceChildren();
    }

    function updateMeta(metaLines) {
        if (!previewMeta) return;
        const lines = Array.isArray(metaLines) ? metaLines : [];
        if (lines.length > 0) {
            previewMeta.textContent = lines.join('\n');
            previewMeta.classList.remove('hidden');
        } else {
            previewMeta.textContent = '';
            previewMeta.classList.add('hidden');
        }
    }

    function renderFileName(fileName) {
        if (!previewFileName) return;
        previewFileName.replaceChildren();

        const title = document.createElement('span');
        title.className = 'preview-filename-title';
        title.textContent = formatFileName(fileName);
        previewFileName.appendChild(title);

        const categories = getRouteCategoriesFromFileName(fileName);
        const uniqueCats = Array.from(new Set((Array.isArray(categories) ? categories : []).map(c => String(c || '').trim()).filter(Boolean)));
        for (const cat of uniqueCats) {
            const badge = document.createElement('span');
            badge.className = 'route-category-badge';
            badge.dataset.routeCategory = cat;
            badge.textContent = cat;
            previewFileName.appendChild(badge);
        }
    }

    function renderHeader(headers) {
        if (!tableHeader) return;
        const safeHeaders = Array.isArray(headers) ? headers : [];
        for (const h of safeHeaders) {
            const th = document.createElement('th');
            th.textContent = h || '';
            tableHeader.appendChild(th);
        }
    }

    function renderBody(tableModel, highlightRowIndex) {
        if (!tableBody) return null;
        const rows = Array.isArray(tableModel?.rows) ? tableModel.rows : [];
        const headers = Array.isArray(tableModel?.headers) ? tableModel.headers : [];
        let highlightedRowEl = null;

        for (const rowObj of rows) {
            const tr = document.createElement('tr');
            if (rowObj?.originalRowIndex === highlightRowIndex) {
                tr.classList.add('highlighted-row');
                highlightedRowEl = tr;
            }
            const cells = Array.isArray(rowObj?.cells) ? rowObj.cells : [];
            for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
                const cell = cells[cellIdx];
                const td = document.createElement('td');
                td.textContent = (cell === null || cell === undefined) ? '' : String(cell);
                const header = headers[cellIdx];
                if (header) {
                    const h = normalizeText(String(header));
                    if (h.includes('nazwa') || h.includes('placowk')) td.classList.add('facility-column');
                }
                tr.appendChild(td);
            }
            tableBody.appendChild(tr);
        }

        return highlightedRowEl;
    }

    function showSearch() {
        if (filePreviewView) filePreviewView.classList.add('view-hidden');
        if (searchView) searchView.classList.remove('view-hidden');
    }

    function showPreview({ fileName, tableModel, highlightRowIndex }) {
        if (searchView) searchView.classList.add('view-hidden');
        if (filePreviewView) filePreviewView.classList.remove('view-hidden');

        renderFileName(fileName);
        updateMeta(tableModel?.metaLines);

        clearElement(tableHeader);
        clearElement(tableBody);
        renderHeader(tableModel?.headers);
        return renderBody(tableModel, highlightRowIndex);
    }

    return { showSearch, showPreview, updateMeta, renderFileName };
}

export async function prepareResultsListDom(resultsListEl, { append = false, reduceMotion = false, exitClass = 'qe-results-exiting', exitDelayMs = 160 } = {}) {
    if (!resultsListEl) return;
    if (!append && resultsListEl.children.length > 0 && !reduceMotion) {
        resultsListEl.classList.add(exitClass);
        await new Promise(resolve => window.setTimeout(resolve, Math.max(0, Number(exitDelayMs) || 0)));
        resultsListEl.classList.remove(exitClass);
        resultsListEl.replaceChildren();
        return;
    }
    if (!append) {
        resultsListEl.replaceChildren();
    }
}

export function createResultsCategoryController(cfg) {
    const resultsList = cfg?.resultsList || null;
    const categories = Array.isArray(cfg?.categories) ? cfg.categories.map(c => String(c || '').trim()).filter(Boolean) : [];

    const getCollapsed = typeof cfg?.getCollapsed === 'function' ? cfg.getCollapsed : (() => false);
    const setCollapsed = typeof cfg?.setCollapsed === 'function' ? cfg.setCollapsed : (() => { });
    const prefersReducedMotion = typeof cfg?.prefersReducedMotion === 'function' ? cfg.prefersReducedMotion : (() => false);
    const onLayout = typeof cfg?.onLayout === 'function' ? cfg.onLayout : (() => { });

    function cssEscapeAttrValue(value) {
        const v = String(value ?? '');
        if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(v);
        return v.replace(/["\\\]]/g, '\\$&');
    }

    function clearElement(el) {
        if (!el) return;
        el.replaceChildren();
    }

    function ensureBodyInner(body) {
        if (!body || !(body instanceof HTMLElement)) return null;
        const existing = body.querySelector('.results-category-body-inner');
        if (existing && existing.parentElement === body) return existing;

        const inner = document.createElement('div');
        inner.className = 'results-category-body-inner';
        while (body.firstChild) inner.appendChild(body.firstChild);
        body.appendChild(inner);
        return inner;
    }

    function ensureSections({ animate = false } = {}) {
        const map = new Map();
        if (!resultsList) return map;

        const shouldRebuild = categories.some((c) => !resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(c)}"]`));
        if (shouldRebuild) clearElement(resultsList);

        let sectionOrdinal = 0;
        for (const category of categories) {
            let section = resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(category)}"]`);

            if (!section) {
                section = document.createElement('section');
                section.className = 'results-category';
                section.dataset.category = category;

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'results-category-toggle';
                button.dataset.category = category;

                const title = document.createElement('span');
                title.className = 'results-category-title';
                title.textContent = category;

                const count = document.createElement('span');
                count.className = 'results-category-count';
                count.textContent = '0';

                button.appendChild(title);
                button.appendChild(count);

                const body = document.createElement('div');
                body.className = 'results-category-body';
                const inner = document.createElement('div');
                inner.className = 'results-category-body-inner';
                body.appendChild(inner);

                const collapsed = Boolean(getCollapsed(category));
                section.classList.toggle('is-collapsed', collapsed);
                button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

                section.appendChild(button);
                section.appendChild(body);
                resultsList.appendChild(section);
            }

            if (animate) {
                const collapsed = Boolean(getCollapsed(category));
                section.classList.remove('qe-section-enter', 'qe-enter-left', 'qe-enter-right', 'qe-enter-center');
                void section.offsetWidth;
                section.classList.add('qe-section-enter');
                if (collapsed) {
                    const directionClass = (sectionOrdinal % 2 === 0) ? 'qe-enter-left' : 'qe-enter-right';
                    section.classList.add(directionClass);
                } else {
                    section.classList.add('qe-enter-center');
                }
                section.style.setProperty('--qe-section-delay', `${sectionOrdinal * 60}ms`);
                sectionOrdinal++;
            }

            const btn = section.querySelector('.results-category-toggle');
            const count = section.querySelector('.results-category-count');
            const body = section.querySelector('.results-category-body');
            const inner = ensureBodyInner(body);
            map.set(category, { section, button: btn, count, body, inner });
        }

        return map;
    }

    function updateCounts(sections, currentResults) {
        const list = Array.isArray(currentResults) ? currentResults : [];
        const counts = new Map();
        for (const category of categories) counts.set(category, 0);

        for (const group of list) {
            const cats = Array.isArray(group?.categories) && group.categories.length > 0 ? group.categories : ['STANDARD'];
            const uniqueCats = Array.from(new Set(cats.map(c => String(c || '').trim()).filter(Boolean)));
            const targetCats = uniqueCats.length > 0 ? uniqueCats : ['STANDARD'];
            for (const category of targetCats) {
                if (!counts.has(category)) continue;
                counts.set(category, (counts.get(category) || 0) + 1);
            }
        }

        for (const category of categories) {
            const entry = sections instanceof Map ? sections.get(category) : null;
            if (!entry || !entry.section) continue;
            const value = counts.get(category) || 0;
            if (entry.count) entry.count.textContent = String(value);
            entry.section.classList.toggle('hidden', value === 0);
        }
    }

    function syncHeights(sections) {
        if (!resultsList) return;

        const entries = [];
        if (sections instanceof Map) {
            for (const entry of sections.values()) {
                if (!entry || !entry.section || !entry.body) continue;
                const body = entry.body;
                const inner = entry.inner || ensureBodyInner(body);
                if (!inner) continue;
                entries.push({ section: entry.section, body, inner });
            }
        } else {
            const sectionEls = resultsList.querySelectorAll('.results-category');
            for (const section of sectionEls) {
                if (!(section instanceof HTMLElement)) continue;
                const body = section.querySelector('.results-category-body');
                if (!body || !(body instanceof HTMLElement)) continue;
                const inner = ensureBodyInner(body);
                if (!inner) continue;
                entries.push({ section, body, inner });
            }
        }

        for (const entry of entries) {
            if (entry.section.classList.contains('hidden')) continue;
            const style = window.getComputedStyle(entry.section);
            if (style.display === 'none' || style.visibility === 'hidden') continue;

            if (entry.section.classList.contains('is-collapsed')) {
                entry.body.style.setProperty('--qe-results-category-max', '0px');
                continue;
            }

            const height = entry.inner.scrollHeight;
            entry.body.style.setProperty('--qe-results-category-max', `${height}px`);
        }
    }

    function toggleCategory(category) {
        const cat = String(category || '').trim();
        if (!resultsList || !cat) return;
        const section = resultsList.querySelector(`.results-category[data-category="${cssEscapeAttrValue(cat)}"]`);
        if (!section) return;
        const button = section.querySelector('.results-category-toggle');
        const body = section.querySelector('.results-category-body');
        const inner = body ? ensureBodyInner(body) : null;
        const wasCollapsed = section.classList.contains('is-collapsed');
        const reduceMotion = prefersReducedMotion();

        if (!body || !inner || reduceMotion) {
            const isCollapsed = section.classList.toggle('is-collapsed');
            if (button) button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
            setCollapsed(cat, isCollapsed);
            syncHeights();
            window.requestAnimationFrame(() => onLayout());
            return;
        }

        if (wasCollapsed) {
            body.style.setProperty('--qe-results-category-max', '0px');
            section.classList.remove('is-collapsed');
            if (button) button.setAttribute('aria-expanded', 'true');
            setCollapsed(cat, false);
            window.requestAnimationFrame(() => {
                const height = inner.scrollHeight;
                body.style.setProperty('--qe-results-category-max', `${height}px`);
                window.requestAnimationFrame(() => onLayout());
            });
            return;
        }

        const height = inner.scrollHeight;
        body.style.setProperty('--qe-results-category-max', `${height}px`);
        if (button) button.setAttribute('aria-expanded', 'false');
        setCollapsed(cat, true);
        window.requestAnimationFrame(() => {
            section.classList.add('is-collapsed');
            window.requestAnimationFrame(() => onLayout());
        });
    }

    return { ensureSections, updateCounts, syncHeights, toggleCategory };
}

export function createResultsRenderer(cfg) {
    const formatRouteNameForResults = typeof cfg?.formatRouteNameForResults === 'function' ? cfg.formatRouteNameForResults : ((x) => String(x || ''));
    const extractRouteCodeFromFileName = typeof cfg?.extractRouteCodeFromFileName === 'function' ? cfg.extractRouteCodeFromFileName : (() => null);
    const getDriverForRouteOnDate = typeof cfg?.getDriverForRouteOnDate === 'function' ? cfg.getDriverForRouteOnDate : (() => null);
    const buildDriverBadgesHtml = typeof cfg?.buildDriverBadgesHtml === 'function' ? cfg.buildDriverBadgesHtml : (() => '');
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((x) => String(x ?? ''));
    const setElementHtml = typeof cfg?.setElementHtml === 'function' ? cfg.setElementHtml : ((el, html) => { if (el) el.innerHTML = String(html ?? ''); });
    const rowMatchesKeyLab = typeof cfg?.rowMatchesKeyLab === 'function' ? cfg.rowMatchesKeyLab : (() => false);
    const toTitleCase = typeof cfg?.toTitleCase === 'function' ? cfg.toTitleCase : ((x) => String(x || ''));
    const highlightText = typeof cfg?.highlightText === 'function' ? cfg.highlightText : ((text) => String(text ?? ''));
    const isEmptyCell = typeof cfg?.isEmptyCell === 'function' ? cfg.isEmptyCell : ((v) => v == null || v === '');

    function buildResultSummaryHtml(result, query, { isLab = false } = {}) {
        if (result?.isComplete) {
            const parts = String(result.displayText || '').split('|').map(s => s.trim());
            const time = parts[0] || '—', address = parts[1] || '';
            let facility = parts[2] || '';
            if (isLab) facility = toTitleCase(facility);
            const facilityClass = isLab ? 'result-col result-facility result-facility--lab' : 'result-col result-facility';
            return [
                `<span class="result-col result-time">${highlightText(time, query)}</span>`,
                `<span class="result-col result-address">${highlightText(address, query)}</span>`,
                `<span class="${facilityClass}">${highlightText(facility, query)}</span>`
            ].join('');
        }
        const cells = Array.isArray(result?.cells) ? result.cells : [];
        return cells.filter(c => !isEmptyCell(c)).map(c => {
            let text = String(c);
            if (isLab) text = toTitleCase(text);
            return `<span class="result-cell-fragment">${highlightText(text, query)}</span>`;
        }).join('');
    }

    function createGroupElement(group, index, query, { animateIn = false, enterDelayMs = 0 } = {}) {
        const fileName = String(group?.fileName || '');
        const routeName = formatRouteNameForResults(fileName);
        const routeCode = extractRouteCodeFromFileName(fileName);
        const driverNames = routeCode ? getDriverForRouteOnDate(routeCode, new Date()) : null;
        const driverBadgesHtml = buildDriverBadgesHtml(driverNames);
        const driverHtml = driverBadgesHtml ? `<span class="result-driver" aria-label="Kierowcy z grafiku">— ${driverBadgesHtml}</span>` : '';

        const groupDiv = document.createElement('div');
        const directionClass = (index % 2 === 0) ? 'qe-enter-left' : 'qe-enter-right';
        groupDiv.className = animateIn ? `result-group qe-result-enter ${directionClass}` : 'result-group';
        groupDiv.dataset.index = index;
        if (animateIn && Number.isFinite(enterDelayMs) && enterDelayMs > 0) groupDiv.style.setProperty('--qe-enter-delay', `${enterDelayMs}ms`);

        const items = Array.isArray(group?.items) ? group.items : [];
        const rowsHtml = items.map(item => {
            const isLab = item?.isComplete ? rowMatchesKeyLab((Array.isArray(item?.cells) ? item.cells : []).join(' ')) : false;
            const rowClass = isLab ? 'result-row result-row--lab' : 'result-row';
            return `<div class="${rowClass}" data-row-index="${item.rowIndex}" data-file-name="${escapeHtml(item.fileName)}">
            <div class="result-content">${buildResultSummaryHtml(item, query, { isLab })}</div>
        </div>`;
        }).join('');

        setElementHtml(groupDiv, `<div class="result-group-header"><span class="result-filename"><span class="result-route-name">${routeName}</span>${driverHtml}</span></div><div class="result-group-body">${rowsHtml}</div>`);
        return groupDiv;
    }

    return { createGroupElement };
}

export function highlightLabsInPreviewTableDom(cfg) {
    const tbody = cfg?.tbody || null;
    const rowMatchesKeyLab = typeof cfg?.rowMatchesKeyLab === 'function' ? cfg.rowMatchesKeyLab : (() => false);
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((x) => String(x ?? ''));
    const toTitleCase = typeof cfg?.toTitleCase === 'function' ? cfg.toTitleCase : ((x) => String(x || ''));

    if (!tbody || !tbody.rows) return;

    for (let r = 0; r < tbody.rows.length; r++) {
        const tr = tbody.rows[r];
        let rowText = '';
        for (let c = 0; c < tr.cells.length; c++) rowText += ` ${tr.cells[c]?.textContent || ''}`;
        const isLab = rowMatchesKeyLab(rowText);
        tr.classList.toggle('highlight-lab', isLab);
        if (isLab) {
            const facilityCell = tr.querySelector('.facility-column');
            if (facilityCell && !facilityCell.querySelector('.lab-badge')) {
                facilityCell.innerHTML = `<span class="lab-badge">${escapeHtml(toTitleCase(facilityCell.textContent))}</span>`;
            }
        }
    }
}

export function createWelcomeProgressRenderer(cfg) {
    const formatFileName = typeof cfg?.formatFileName === 'function' ? cfg.formatFileName : ((x) => String(x || ''));
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((x) => String(x ?? ''));
    const setElementHtml = typeof cfg?.setElementHtml === 'function' ? cfg.setElementHtml : ((el, html) => { if (el) el.innerHTML = String(html ?? ''); });

    function createItem(fileName) {
        const item = document.createElement('div');
        item.className = 'welcome-progress-item';
        setElementHtml(item, `<div class="welcome-progress-name">${escapeHtml(formatFileName(fileName))}</div><div class="welcome-progress-bar-wrap"><div class="welcome-progress-bar-fill" style="width: 0%"></div></div><div class="welcome-progress-status">0%</div>`);
        return item;
    }

    function updateItem(item, percent, statusText, { isError = false, defer = false } = {}) {
        if (!item) return;
        const fill = item.querySelector('.welcome-progress-bar-fill');
        const status = item.querySelector('.welcome-progress-status');
        if (fill) fill.style.width = `${percent}%`;
        const nextStatus = statusText || `${Math.round(percent)}%`;
        if (defer) {
            item.setAttribute('data-pending-status', '1');
            item.setAttribute('data-pending-status-text', nextStatus);
            if (isError) item.setAttribute('data-pending-error', '1');
            return;
        }
        if (status) status.textContent = nextStatus;
        if (isError) item.classList.add('error');
    }

    return { createItem, updateItem };
}

export function createLogoRenderer(cfg) {
    const setElementSvg = typeof cfg?.setElementSvg === 'function' ? cfg.setElementSvg : (() => { });
    const buildQuickEvoLogoSvg = typeof cfg?.buildQuickEvoLogoSvg === 'function' ? cfg.buildQuickEvoLogoSvg : (() => '');
    const startLogoOrbitInContainer = typeof cfg?.startLogoOrbitInContainer === 'function' ? cfg.startLogoOrbitInContainer : (() => { });

    function renderHeaderLogo(appHeaderLogoEl) {
        if (!appHeaderLogoEl) return;
        setElementSvg(appHeaderLogoEl, buildQuickEvoLogoSvg({ size: 'header' }));
        startLogoOrbitInContainer(appHeaderLogoEl, 'header');
    }

    function refreshWelcomeGraphicIfPresent(container) {
        if (container && container.dataset.loaded === '1') {
            setElementSvg(container, buildQuickEvoLogoSvg({ size: 'welcome' }));
            startLogoOrbitInContainer(container, 'welcome');
        }
    }

    function lazyLoadWelcomeGraphic(container) {
        if (!container) return;
        const inject = () => {
            if (container.dataset.loaded === '1') return;
            container.dataset.loaded = '1';
            setElementSvg(container, buildQuickEvoLogoSvg({ size: 'welcome' }));
            startLogoOrbitInContainer(container, 'welcome');
        };
        if ('requestIdleCallback' in window) window.requestIdleCallback(inject, { timeout: 900 });
        else window.setTimeout(inject, 350);
    }

    return { renderHeaderLogo, refreshWelcomeGraphicIfPresent, lazyLoadWelcomeGraphic };
}

export function createScrollIndicatorController(cfg) {
    const scrollIndicator = cfg?.scrollIndicator || null;
    const resultsList = cfg?.resultsList || null;
    const resultsEndIntersection = cfg?.resultsEndIntersection || { observer: null, target: null, lastFullyVisible: false };

    function getScrollContainer() {
        const el = document.scrollingElement;
        if (el && el instanceof HTMLElement) return el;
        return document.documentElement;
    }

    function checkListOverflow(container, list) {
        if (!container || !list) return false;
        if (!(container instanceof Element) || !(list instanceof Element)) return false;

        const containerStyle = window.getComputedStyle(container);
        if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') return false;
        const listStyle = window.getComputedStyle(list);
        if (listStyle.display === 'none' || listStyle.visibility === 'hidden') return false;

        const containerClientHeight = container.clientHeight;
        const listScrollHeight = list.scrollHeight;
        if (!Number.isFinite(containerClientHeight) || !Number.isFinite(listScrollHeight)) return false;
        if (containerClientHeight <= 0) return false;

        return listScrollHeight > containerClientHeight;
    }

    function hasMoreContentBelowViewport(container, list, thresholdPx = 0) {
        if (!container || !(container instanceof HTMLElement)) return false;
        if (!list || !(list instanceof Element)) return false;

        const t = Number(thresholdPx);
        const threshold = Number.isFinite(t) ? Math.max(0, t) : 0;

        if (container === list) {
            const current = container.scrollTop + container.clientHeight;
            return current < (container.scrollHeight - threshold);
        }

        const containerRect = container.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const listOffsetTopInContainer = (listRect.top - containerRect.top) + container.scrollTop;
        const listBottomInContainer = listOffsetTopInContainer + list.scrollHeight;
        const viewportBottomInContainer = container.scrollTop + container.clientHeight;

        return listBottomInContainer > (viewportBottomInContainer + threshold);
    }

    function update() {
        if (!scrollIndicator) return;
        if (!resultsList) {
            scrollIndicator.classList.add('is-hidden');
            scrollIndicator.setAttribute('aria-hidden', 'true');
            scrollIndicator.dataset.scrollNeeded = 'false';
            return;
        }

        const container = getScrollContainer();
        const hasVerticalOverflow = checkListOverflow(container, resultsList);
        const hasMoreBelow = (resultsEndIntersection.observer && resultsEndIntersection.target)
            ? !resultsEndIntersection.lastFullyVisible
            : hasMoreContentBelowViewport(container, resultsList, 40);
        const shouldShow = hasVerticalOverflow && hasMoreBelow;

        scrollIndicator.dataset.scrollNeeded = hasVerticalOverflow ? 'true' : 'false';
        scrollIndicator.classList.toggle('is-hidden', !shouldShow);
        scrollIndicator.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    }

    function ensureObserver() {
        if (resultsEndIntersection.observer) return;
        if (typeof IntersectionObserver !== 'function') return;

        resultsEndIntersection.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry || entry.target !== resultsEndIntersection.target) continue;
                const fullyVisible = Boolean(entry.isIntersecting && entry.intersectionRatio >= 0.999);
                if (fullyVisible === resultsEndIntersection.lastFullyVisible) continue;
                resultsEndIntersection.lastFullyVisible = fullyVisible;
                update();
            }
        }, { root: null, threshold: [0, 1] });
    }

    function syncResultsEndIntersectionObserver() {
        if (!resultsList) return;
        ensureObserver();
        if (!resultsEndIntersection.observer) return;

        const groups = Array.from(resultsList.querySelectorAll('.result-group'));
        const lastVisibleGroup = (() => {
            for (let i = groups.length - 1; i >= 0; i--) {
                const el = groups[i];
                if (!el) continue;
                if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) continue;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                return el;
            }
            return null;
        })();
        const last = lastVisibleGroup || (groups.length > 0 ? groups[groups.length - 1] : resultsList.lastElementChild);
        if (last === resultsEndIntersection.target) return;

        if (resultsEndIntersection.target) {
            try { resultsEndIntersection.observer.unobserve(resultsEndIntersection.target); } catch { }
        }
        resultsEndIntersection.target = last || null;
        resultsEndIntersection.lastFullyVisible = false;

        if (resultsEndIntersection.target) {
            try { resultsEndIntersection.observer.observe(resultsEndIntersection.target); } catch { }
        }
    }

    return { update, getScrollContainer, syncResultsEndIntersectionObserver };
}
