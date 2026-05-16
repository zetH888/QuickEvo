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

