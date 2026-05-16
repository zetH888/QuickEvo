/**
 * @module loading-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla przejścia z ekranu powitalnego/ładowania do aplikacji.
 *
 * Cel:
 * - uprościć `app.js` przez przeniesienie przepływu „kontynuuj do aplikacji” do modułu,
 * - zostawić operacje stricte DOM w callbackach przekazanych z `app.js`.
 */

/**
 * Tworzy serwis aplikacyjny dla ekranu ładowania.
 *
 * @param {Object} cfg
 * @param {() => void} cfg.stopLoadingScreen
 * @param {() => void} cfg.replaceHome
 * @param {() => number} cfg.getDomReadyTs
 * @param {() => number} cfg.now
 * @param {(fn: () => void, ms: number) => any} cfg.setTimeout
 * @param {(fn: () => void) => void} cfg.requestAnimationFrame
 * @param {() => void} cfg.showAppShell
 * @param {() => void} cfg.focusSearchIfEnabled
 * @param {() => void} cfg.updateScrollIndicator
 */
export function createLoadingApplication(cfg) {
    if (!cfg || typeof cfg.stopLoadingScreen !== 'function') throw new Error('loading-application: brak stopLoadingScreen');

    /**
     * Kończy ekran ładowania i przełącza UI do głównej aplikacji.
     */
    function continueToApp() {
        cfg.stopLoadingScreen();
        cfg.replaceHome();

        const elapsed = safeNumber(cfg.now?.(), 0) - safeNumber(cfg.getDomReadyTs?.(), 0);
        const delay = Math.max(0, 300 - elapsed);

        cfg.setTimeout(() => {
            cfg.showAppShell();
            cfg.focusSearchIfEnabled();
            cfg.requestAnimationFrame(() => cfg.updateScrollIndicator());
        }, delay);
    }

    return Object.freeze({ continueToApp });
}

function safeNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
