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

