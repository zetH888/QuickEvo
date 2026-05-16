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

