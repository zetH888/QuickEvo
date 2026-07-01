import { LoadingTitleRotator, getLoadingTitleCategoryForProgress } from './loading-title.js';
import { createLoadingProgressController } from './loading-progress-controller.js';
import { applyWelcomeElementsInitStateDom, clearWelcomeElementsInitStateDom, hideLoadingOverlayDom, scheduleWelcomeLogoEntranceDom, setLoadingStatusTextDom, setLoadingTitleTextDom, showLoadingErrorDom, showLoadingOverlayDom } from './loading-overlay-dom.js';

export function createWelcomeLoadingOverlayController(cfg) {
    const els = cfg?.els || {};
    const loadingOverlay = els.loadingOverlay || null;
    const loadingTitleText = els.loadingTitleText || null;
    const loadingStatusText = els.loadingStatusText || null;
    const loadingError = els.loadingError || null;
    const loadingContinueButton = els.loadingContinueButton || null;
    const loadingProgressMeta = els.loadingProgressMeta || null;
    const loadingProgressBar = els.loadingProgressBar || null;
    const welcomeImportProgress = els.welcomeImportProgress || null;
    const welcomeProgressList = els.welcomeProgressList || null;

    const constants = cfg?.constants || {};
    const LOADING_TITLE_MESSAGES = constants.LOADING_TITLE_MESSAGES || {};
    const LOADING_TITLE_FADE_OUT_MS = Number(constants.LOADING_TITLE_FADE_OUT_MS || 0);
    const LOADING_TITLE_FADE_IN_MS = Number(constants.LOADING_TITLE_FADE_IN_MS || 0);
    const LOADING_TITLE_INTERVAL_MIN_MS = Number(constants.LOADING_TITLE_INTERVAL_MIN_MS || 0);
    const LOADING_TITLE_INTERVAL_MAX_MS = Number(constants.LOADING_TITLE_INTERVAL_MAX_MS || 0);

    const LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH = Number(constants.LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH ?? 97);
    const LOADING_PROGRESS_MICROSTOP_MIN_MS = Number(constants.LOADING_PROGRESS_MICROSTOP_MIN_MS ?? 200);
    const LOADING_PROGRESS_MICROSTOP_MAX_MS = Number(constants.LOADING_PROGRESS_MICROSTOP_MAX_MS ?? 500);
    const LOADING_PROGRESS_JUMP_MIN = Number(constants.LOADING_PROGRESS_JUMP_MIN ?? 1);
    const LOADING_PROGRESS_JUMP_MAX = Number(constants.LOADING_PROGRESS_JUMP_MAX ?? 5);

    const WELCOME_LOGO_ENTER_DELAY_MS = Number(constants.WELCOME_LOGO_ENTER_DELAY_MS ?? 0);
    const WELCOME_SEQUENCE_UNLOCK_AFTER_MS = Number(constants.WELCOME_SEQUENCE_UNLOCK_AFTER_MS ?? 0);
    const WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS = Number(constants.WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS ?? 0);

    const prefersReducedMotion = typeof cfg?.prefersReducedMotion === 'function'
        ? cfg.prefersReducedMotion
        : (() => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));

    const isVisualFinishAllowed = typeof cfg?.isVisualFinishAllowed === 'function' ? cfg.isVisualFinishAllowed : (() => false);
    const getWelcomeGraphicEl = typeof cfg?.getWelcomeGraphicEl === 'function' ? cfg.getWelcomeGraphicEl : (() => document.getElementById('welcome-graphic'));

    const flags = cfg?.flags || {};
    const getLoadingProgressDone = typeof flags.getLoadingProgressDone === 'function' ? flags.getLoadingProgressDone : (() => false);
    const setLoadingProgressDone = typeof flags.setLoadingProgressDone === 'function' ? flags.setLoadingProgressDone : (() => { });
    const getLoadingDataReady = typeof flags.getLoadingDataReady === 'function' ? flags.getLoadingDataReady : (() => false);
    const getLoadingFailed = typeof flags.getLoadingFailed === 'function' ? flags.getLoadingFailed : (() => false);
    const getLoadErrorsCount = typeof flags.getLoadErrorsCount === 'function' ? flags.getLoadErrorsCount : (() => 0);

    let loadingProgressController = null;
    let loadingTitleRotator = null;

    let pendingLoadingStatusText = null;
    let pendingLoadingProgressValue = null;
    let pendingLoadingErrorMessage = null;
    let pendingLoadingErrorVisible = false;

    let pendingLoadingStatusFinalization = null;

    let welcomeLogoDomContentLoadedTs = null;
    let welcomeLogoEnterTimer = null;
    let welcomeSeqUnlockTimer = null;
    let welcomeSeqFailSafeTimer = null;
    let welcomeTextUpdatesLocked = true;
    let welcomeOverlayStartedAt = 0;

    let welcomeParallaxRaf = 0;
    let welcomeParallaxTargetX = 0;
    let welcomeParallaxTargetY = 0;
    let welcomeParallaxCurrentX = 0;
    let welcomeParallaxCurrentY = 0;

    const setElementHtml = typeof cfg?.setElementHtml === 'function'
        ? cfg.setElementHtml
        : ((el, html) => { if (el) el.innerHTML = String(html ?? ''); });

    function clearElement(el) {
        if (!el) return;
        el.replaceChildren();
    }

    function setPendingFinalLoadingStatusText(finalText, interimText) {
        const finalT = String(finalText || '').trim();
        const interimT = String(interimText || '').trim();
        if (!finalT) { pendingLoadingStatusFinalization = null; return; }
        pendingLoadingStatusFinalization = { finalText: finalT, interimText: interimT || 'Finalizowanie...', applied: false };
    }

    function syncPendingFinalLoadingStatusText() {
        if (!pendingLoadingStatusFinalization) return;
        if (!getLoadingProgressDone()) return;
        const ctrl = ensureLoadingProgressController();
        const canFinalizeVisual = prefersReducedMotion() ? (ctrl.getTargetPercent() >= 100) : (ctrl.getDisplayPercent() >= 100);
        if (canFinalizeVisual) {
            if (!pendingLoadingStatusFinalization.applied) {
                pendingLoadingStatusFinalization.applied = true;
                setStatusText(pendingLoadingStatusFinalization.finalText);
            }
            return;
        }
        if (!pendingLoadingStatusFinalization.applied) setStatusText(pendingLoadingStatusFinalization.interimText);
    }

    function ensureLoadingProgressController() {
        if (loadingProgressController) return loadingProgressController;
        loadingProgressController = createLoadingProgressController({
            els: { loadingOverlay, loadingProgressMeta, loadingProgressBar },
            updateContinueAvailability: updateLoadingContinueAvailability,
            syncPendingFinalLoadingStatusText,
            isVisualFinishAllowed,
            prefersReducedMotion,
            softCapBeforeFinish: LOADING_PROGRESS_SOFT_CAP_BEFORE_FINISH,
            microStopMinMs: LOADING_PROGRESS_MICROSTOP_MIN_MS,
            microStopMaxMs: LOADING_PROGRESS_MICROSTOP_MAX_MS,
            jumpMin: LOADING_PROGRESS_JUMP_MIN,
            jumpMax: LOADING_PROGRESS_JUMP_MAX
        });
        return loadingProgressController;
    }

    function updateLoadingContinueAvailability() {
        if (!loadingContinueButton || !loadingOverlay) return;
        const display = ensureLoadingProgressController().getDisplayPercent();
        const canContinue = Boolean(getLoadingProgressDone() && (getLoadingDataReady() || getLoadingFailed()) && (getLoadingFailed() || display >= 100));
        loadingContinueButton.disabled = !canContinue;
        if (canContinue) loadingOverlay.setAttribute('aria-busy', 'false');
    }

    function ensureLoadingTitleRotator() {
        if (loadingTitleRotator) return loadingTitleRotator;
        loadingTitleRotator = new LoadingTitleRotator({
            el: loadingTitleText,
            getProgress: () => ensureLoadingProgressController().getDisplayPercent(),
            getMessagesForProgress: (progress) => {
                const category = getLoadingTitleCategoryForProgress(progress);
                return LOADING_TITLE_MESSAGES[category] || [];
            },
            prefersReducedMotion,
            fadeOutMs: LOADING_TITLE_FADE_OUT_MS,
            fadeInMs: LOADING_TITLE_FADE_IN_MS,
            intervalMinMs: LOADING_TITLE_INTERVAL_MIN_MS,
            intervalMaxMs: LOADING_TITLE_INTERVAL_MAX_MS
        });
        return loadingTitleRotator;
    }

    function startDynamicEffects() {
        if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;
        ensureLoadingTitleRotator().start();
        ensureLoadingProgressController().start();
    }

    function applyWelcomeElementsInitState() {
        applyWelcomeElementsInitStateDom({ loadingOverlay, loadingStatusTextEl: loadingStatusText, loadingErrorEl: loadingError });
    }

    function clearWelcomeElementsInitState() {
        clearWelcomeElementsInitStateDom({ loadingOverlay, loadingStatusTextEl: loadingStatusText, loadingErrorEl: loadingError });
    }

    function forceWelcomeSequenceDone() {
        if (!loadingOverlay) return;
        clearWelcomeElementsInitState();
        loadingOverlay.dataset.welcomeSeq = 'done';
        if (welcomeTextUpdatesLocked) {
            welcomeTextUpdatesLocked = false;
            flushPendingWelcomeTextUpdates();
        }
        startDynamicEffects();
    }

    function scheduleWelcomeLogoEntrance() {
        if (!loadingOverlay) return;
        const container = getWelcomeGraphicEl();
        if (!container) return;

        if (welcomeLogoEnterTimer !== null) { window.clearTimeout(welcomeLogoEnterTimer); welcomeLogoEnterTimer = null; }
        if (welcomeSeqUnlockTimer !== null) { window.clearTimeout(welcomeSeqUnlockTimer); welcomeSeqUnlockTimer = null; }
        if (welcomeSeqFailSafeTimer !== null) { window.clearTimeout(welcomeSeqFailSafeTimer); welcomeSeqFailSafeTimer = null; }

        const baseTs = Number.isFinite(welcomeOverlayStartedAt) && welcomeOverlayStartedAt > 0
            ? welcomeOverlayStartedAt
            : (typeof welcomeLogoDomContentLoadedTs === 'number' ? welcomeLogoDomContentLoadedTs : performance.now());

        const timers = scheduleWelcomeLogoEntranceDom({
            loadingOverlay,
            container,
            baseTs,
            enterDelayMs: WELCOME_LOGO_ENTER_DELAY_MS,
            unlockAfterMs: WELCOME_SEQUENCE_UNLOCK_AFTER_MS,
            failSafeExtraMs: WELCOME_SEQUENCE_FAILSAFE_EXTRA_MS,
            clearWelcomeElementsInitState,
            completeWelcomeEntrance,
            forceWelcomeSequenceDone
        });
        welcomeLogoEnterTimer = timers.enterTimerId;
        welcomeSeqUnlockTimer = timers.unlockTimerId;
        welcomeSeqFailSafeTimer = timers.failSafeTimerId;
    }

    function completeWelcomeEntrance() {
        if (loadingOverlay) loadingOverlay.dataset.welcomeSeq = 'done';
        if (welcomeTextUpdatesLocked) {
            welcomeTextUpdatesLocked = false;
            flushPendingWelcomeTextUpdates();
        }
        startDynamicEffects();
    }

    function flushPendingWelcomeTextUpdates() {
        if (!loadingOverlay) return;

        if (pendingLoadingStatusText !== null) {
            setLoadingStatusTextDom(loadingStatusText, pendingLoadingStatusText);
            pendingLoadingStatusText = null;
        }

        if (pendingLoadingProgressValue !== null) {
            ensureLoadingProgressController().setTargetPercent(pendingLoadingProgressValue, { force: true });
            pendingLoadingProgressValue = null;
        }

        if (pendingLoadingErrorVisible) {
            showLoadingErrorDom(loadingError, pendingLoadingErrorMessage);
            pendingLoadingErrorVisible = false;
            pendingLoadingErrorMessage = null;
        }

        const pendingItems = document.querySelectorAll('.welcome-progress-item[data-pending-status="1"]');
        for (const item of pendingItems) {
            const status = item.querySelector('.welcome-progress-status');
            const text = item.dataset.pendingStatusText;
            if (status && typeof text === 'string') status.textContent = text;
            if (item.dataset.pendingError === '1') item.classList.add('error');
            item.removeAttribute('data-pending-status');
            item.removeAttribute('data-pending-status-text');
            item.removeAttribute('data-pending-error');
        }
    }

    function setupParallax() {
        if (!loadingOverlay) return;
        const reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const pointerFine = Boolean(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
        if (reduced || !pointerFine) return;

        let scrollOffsetY = 0;
        const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

        const kick = () => {
            if (welcomeParallaxRaf) return;
            welcomeParallaxRaf = window.requestAnimationFrame(() => {
                welcomeParallaxRaf = 0;
                if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) {
                    welcomeParallaxTargetX = 0;
                    welcomeParallaxTargetY = 0;
                }

                welcomeParallaxCurrentX += (welcomeParallaxTargetX - welcomeParallaxCurrentX) * 0.14;
                welcomeParallaxCurrentY += (welcomeParallaxTargetY - welcomeParallaxCurrentY) * 0.14;

                const x = welcomeParallaxCurrentX;
                const y = welcomeParallaxCurrentY + scrollOffsetY;
                loadingOverlay.style.setProperty('--qe-parallax-x', `${x.toFixed(2)}px`);
                loadingOverlay.style.setProperty('--qe-parallax-y', `${y.toFixed(2)}px`);
            });
        };

        window.addEventListener('pointermove', (e) => {
            if (!loadingOverlay || loadingOverlay.classList.contains('hidden')) return;
            if (e.pointerType && e.pointerType !== 'mouse') return;
            const card = loadingOverlay.querySelector('.loading-card');
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const dx = (e.clientX - (rect.left + rect.width / 2)) / Math.max(1, rect.width);
            const dy = (e.clientY - (rect.top + rect.height / 2)) / Math.max(1, rect.height);
            welcomeParallaxTargetX = clamp(dx * 10, -8, 8);
            welcomeParallaxTargetY = clamp(dy * 8, -6, 6);
            kick();
        }, { passive: true });

        window.addEventListener('scroll', () => {
            const y = (window.scrollY || document.documentElement.scrollTop || 0);
            scrollOffsetY = -clamp(y / 120, -6, 6);
            kick();
        }, { passive: true });
    }

    function start() {
        if (!loadingOverlay) return;
        welcomeOverlayStartedAt = performance.now();
        showLoadingOverlayDom({
            loadingOverlay,
            loadingErrorEl: loadingError,
            loadingContinueButtonEl: loadingContinueButton,
            welcomeGraphicEl: getWelcomeGraphicEl()
        });

        welcomeTextUpdatesLocked = true;
        pendingLoadingStatusText = null;
        pendingLoadingProgressValue = null;
        pendingLoadingErrorMessage = null;
        pendingLoadingErrorVisible = false;

        setLoadingProgressDone(false);
        ensureLoadingProgressController().reset();
        pendingLoadingStatusFinalization = null;
        setLoadingStatusTextDom(loadingStatusText, 'Inicjalizacja...');
        setLoadingTitleTextDom(loadingTitleText, 'Witamy w QuickEvo!');
        if (loadingTitleRotator) loadingTitleRotator.stop();

        applyWelcomeElementsInitState();
        scheduleWelcomeLogoEntrance();
    }

    function stop() {
        if (!loadingOverlay) return;
        hideLoadingOverlayDom({ loadingOverlay, fadeOutMs: 600 });
        if (welcomeLogoEnterTimer !== null) { window.clearTimeout(welcomeLogoEnterTimer); welcomeLogoEnterTimer = null; }
        if (welcomeSeqUnlockTimer !== null) { window.clearTimeout(welcomeSeqUnlockTimer); welcomeSeqUnlockTimer = null; }
        if (welcomeSeqFailSafeTimer !== null) { window.clearTimeout(welcomeSeqFailSafeTimer); welcomeSeqFailSafeTimer = null; }
        welcomeTextUpdatesLocked = false;
        ensureLoadingProgressController().stop();
        if (loadingTitleRotator) loadingTitleRotator.stop();
    }

    function setProgressPercent(percent, { force = false } = {}) {
        if (!loadingOverlay) return;
        const ctrl = ensureLoadingProgressController();
        const p = Number(percent);
        const raw = Number.isFinite(p) ? p : 0;
        const next = force ? Math.min(100, Math.max(0, raw)) : Math.max(ctrl.getTargetPercent(), Math.min(100, raw));
        if (welcomeTextUpdatesLocked && loadingOverlay.dataset.welcomeSeq !== 'done') { pendingLoadingProgressValue = next; return; }
        ctrl.setTargetPercent(next, { force: true });
    }

    function setStatusText(text) {
        if (!loadingOverlay) return;
        const next = text || '';
        if (welcomeTextUpdatesLocked && loadingOverlay.dataset.welcomeSeq !== 'done') { pendingLoadingStatusText = next; return; }
        setLoadingStatusTextDom(loadingStatusText, next);
    }

    function showError(message) {
        setStatusText('Wystąpił problem podczas ładowania.');
        if (!loadingError) return;
        if (welcomeTextUpdatesLocked && loadingOverlay && loadingOverlay.dataset.welcomeSeq !== 'done') {
            pendingLoadingErrorVisible = true;
            pendingLoadingErrorMessage = message || 'Nieznany błąd ładowania.';
            return;
        }
        showLoadingErrorDom(loadingError, message);
    }

    function updateProgressStart(total) {
        setStatusText(total === 0 ? 'Brak plików .xlsx/.csv. Zaimportuj dane.' : 'Wczytywanie plików...');
        setProgressPercent(total === 0 ? 100 : 0, { force: true });
    }

    function prepareManualContinue() {
        if (getLoadingFailed()) {
            showError('Nie udało się załadować wszystkich danych. Możesz kontynuować i spróbować ponownie później.');
            setPendingFinalLoadingStatusText('Ładowanie zakończone (tryb awaryjny).', 'Przygotowywanie trybu awaryjnego...');
        } else if (getLoadErrorsCount() > 0) {
            showError(`Załadowano aplikację z błędami plików: ${getLoadErrorsCount()}.`);
            setPendingFinalLoadingStatusText('Ładowanie zakończone (z błędami).', 'Finalizowanie i porządkowanie...');
        } else {
            setPendingFinalLoadingStatusText('Ładowanie zakończone pomyślnie.', 'Finalizowanie i optymalizacja...');
        }
        syncPendingFinalLoadingStatusText();
        updateLoadingContinueAvailability();
    }

    function prepareWelcomeProgressList() {
        if (!welcomeImportProgress) return;
        welcomeImportProgress.classList.remove('hidden');
        clearElement(welcomeProgressList);
    }

    function shouldDeferWelcomeUpdates() {
        return Boolean(welcomeTextUpdatesLocked && loadingOverlay && loadingOverlay.dataset.welcomeSeq !== 'done');
    }

    function markWelcomeLogoDomContentLoadedNow() {
        welcomeLogoDomContentLoadedTs = performance.now();
    }

    return {
        start,
        stop,
        setProgressPercent,
        setStatusText,
        showError,
        updateProgressStart,
        prepareManualContinue,
        updateLoadingContinueAvailability,
        forceWelcomeSequenceDone,
        scheduleWelcomeLogoEntrance,
        setupParallax,
        startDynamicEffects,
        markWelcomeLogoDomContentLoadedNow,
        isVisible: () => Boolean(loadingOverlay && !loadingOverlay.classList.contains('hidden')),
        prepareWelcomeProgressList,
        shouldDeferWelcomeUpdates
    };
}
