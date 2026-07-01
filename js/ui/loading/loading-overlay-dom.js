import { moveFocusOutsideContainer, setElementInert } from '../../core/focus-visibility.js';

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
    setElementInert(loadingOverlay, false);

    clearLoadingErrorDom(loadingErrorEl);
    if (loadingContinueButtonEl) loadingContinueButtonEl.disabled = true;
    if (welcomeGraphicEl) welcomeGraphicEl.classList.remove('welcome-graphic--ready');
}

export function hideLoadingOverlayDom({ loadingOverlay, fadeOutMs = 600 } = {}) {
    if (!loadingOverlay) return;
    moveFocusOutsideContainer(loadingOverlay);
    setElementInert(loadingOverlay, true);
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
