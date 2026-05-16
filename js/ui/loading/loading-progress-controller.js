import { clampNumber } from '../../core/utils.js';

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

