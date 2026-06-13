import { escapeHtml } from '../../core/utils.js';

/**
 * Tworzy kontroler modalu zmian synchronizacji Google Drive.
 *
 * Po usunieciu systemu diff modul odpowiada wylacznie za:
 * - renderowanie listy zmienionych plikow,
 * - rozwijanie szczegolow pojedynczego kafelka,
 * - obsluge niestandardowego paska przewijania.
 *
 * @param {{
 *   modalOverlay?: HTMLElement | null,
 *   modalContent?: HTMLElement | null,
 *   prefersReducedMotion?: (() => boolean) | null,
 *   formatFileName?: ((name: string) => string) | null
 * }} [cfg]
 * @returns {{ buildChangesModalHtml: (changed: any[]) => string, init: (opts?: { files?: any[] }) => void, teardown: () => void }}
 */
export function createDriveChangesModalController({ modalOverlay, modalContent, prefersReducedMotion, formatFileName } = {}) {
    let state = null;

    /**
     * Okresla, czy wpis reprezentuje plik zmodyfikowany lokalnie/zdalnie,
     * dla ktorego mozna pokazac podglad roznic XLSX.
     *
     * @param {any} file
     * @returns {boolean}
     */
    function canShowDiffButton(file) {
        const isDeletedOnDrive = Boolean(file?.isDeletedOnDrive) || String(file?.qeAction || '').trim() === 'delete_local';
        return !isDeletedOnDrive && file?.isNewInDb !== true;
    }

    /**
     * Formatuje timestamp Google Drive do postaci czytelnej dla uzytkownika.
     *
     * @param {number|string|null|undefined} ts
     * @returns {string}
     */
    function formatDriveTimestamp(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '-';
        try { return new Date(n).toLocaleString('pl-PL'); } catch { return String(n); }
    }

    /**
     * Buduje HTML modalu z lista wykrytych zmian.
     *
     * @param {any[]} changed
     * @returns {string}
     */
    function buildDriveChangesModalHtml(changed) {
        const safeList = Array.isArray(changed) ? changed : [];
        const removedCount = safeList.filter((f) => Boolean(f?.isDeletedOnDrive) || String(f?.qeAction || '').trim() === 'delete_local').length;
        const changedCount = safeList.length - removedCount;
        const summaryParts = [];

        if (changedCount > 0) summaryParts.push(`<strong>${escapeHtml(changedCount)}</strong> zmienionych lub nowych`);
        if (removedCount > 0) summaryParts.push(`<strong>${escapeHtml(removedCount)}</strong> do usuniecia lokalnie`);

        const summaryText = summaryParts.length > 0
            ? `Wykryto ${summaryParts.join(' oraz ')} plik(ow).`
            : `Wykryto <strong>${escapeHtml(safeList.length)}</strong> plik(ow) zmienionych od ostatniej synchronizacji.`;
        const questionText = removedCount > 0 ? 'Zastosowac wykryte zmiany?' : 'Nadpisac zmienione pliki?';

        const items = safeList.map((f, index) => {
            const rawName = String(f?.name || '').trim();
            const name = escapeHtml(formatFileName ? formatFileName(rawName) : rawName);
            const reason = escapeHtml(String(f?.changeReason || '').trim() || 'Zmieniono');
            const isDeletedOnDrive = Boolean(f?.isDeletedOnDrive) || String(f?.qeAction || '').trim() === 'delete_local';
            const chipClass = isDeletedOnDrive ? ' qe-drive-chip--deleted' : '';
            const diffButtonHtml = canShowDiffButton(f)
                ? `<div class="qe-drive-change-actions">
                    <button class="qe-drive-diff-btn" type="button" data-qe-change-index="${index}">
                        <svg class="qe-drive-diff-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 6.75C4 5.78 4.78 5 5.75 5h4.5C11.22 5 12 5.78 12 6.75v10.5c0 .97-.78 1.75-1.75 1.75h-4.5A1.75 1.75 0 0 1 4 17.25V6.75Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
                            <path d="M14 6.75c0-.97.78-1.75 1.75-1.75h2.5C19.22 5 20 5.78 20 6.75v10.5c0 .97-.78 1.75-1.75 1.75h-2.5A1.75 1.75 0 0 1 14 17.25V6.75Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
                            <path d="M7.5 9.5h1.75M7.5 13.25h1.75M15.75 11.5h2.5M12 12h2.25m-1.1-1.15 1.15 1.15-1.15 1.15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <span>Pokaż różnicę</span>
                    </button>
                </div>`
                : '';
            const prevTs = Number(f?.previousDriveModifiedAt);
            const nextTs = Number(f?.driveModifiedAt);
            const prev = Number.isFinite(prevTs) && prevTs > 0 ? escapeHtml(formatDriveTimestamp(prevTs)) : '';
            const next = Number.isFinite(nextTs) && nextTs > 0 ? escapeHtml(formatDriveTimestamp(nextTs)) : '';
            const prevRow = prev
                ? `<div class="qe-drive-kv"><span class="qe-drive-k">Poprzednio</span><span class="qe-drive-v qe-drive-v--prev">${prev}</span></div>`
                : `<div class="qe-drive-kv is-muted"><span class="qe-drive-k">Poprzednio</span><span class="qe-drive-v qe-drive-v--prev">Brak danych</span></div>`;
            const nextRow = isDeletedOnDrive
                ? `<div class="qe-drive-kv is-muted"><span class="qe-drive-k">Na Dysku</span><span class="qe-drive-v qe-drive-v--next">Plik usuniety</span></div>`
                : (next
                    ? `<div class="qe-drive-kv"><span class="qe-drive-k">Na Dysku</span><span class="qe-drive-v qe-drive-v--next">${next}</span></div>`
                    : `<div class="qe-drive-kv is-muted"><span class="qe-drive-k">Na Dysku</span><span class="qe-drive-v qe-drive-v--next">Brak danych</span></div>`);
            const chevron = `<svg class="qe-drive-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

            return `<li class="qe-drive-change" data-qe-change-index="${index}">
            <button class="qe-drive-change-toggle" type="button" aria-expanded="false">
                <div class="qe-drive-change-head">
                    <div class="qe-drive-change-name">${name}</div>
                    <div class="qe-drive-change-right">
                        <div class="qe-drive-chip${chipClass}">${reason}</div>
                        ${chevron}
                    </div>
                </div>
            </button>
            <div class="qe-drive-change-panel" hidden>
                <div class="qe-drive-change-meta">${prevRow}${nextRow}</div>
                ${diffButtonHtml}
            </div>
        </li>`;
        }).join('');

        const expandAllIcon = `<svg class="qe-drive-expandall-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.60"/><path d="M7 12l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        return `<div class="qe-drive-modal" data-qe-drive-changes="1">
        <div class="qe-drive-summary-row">
            <div class="qe-drive-summary">${summaryText}</div>
            <button class="qe-drive-expandall" type="button" aria-pressed="false" aria-label="Rozwin wszystkie kafelki">${expandAllIcon}</button>
        </div>
        <div class="qe-drive-scroll-wrap">
            <div class="qe-drive-scroll" tabindex="0">
                <ul class="qe-drive-changes">${items}</ul>
            </div>
            <div class="qe-drive-scrollbar" aria-hidden="true">
                <div class="qe-drive-scrollbar-thumb"></div>
            </div>
        </div>
        <div class="qe-drive-question">${questionText}</div>
    </div>`;
    }

    /**
     * Czsci zasoby zwiazane z aktualnie otwartym modalem.
     *
     * @returns {void}
     */
    function teardown() {
        if (!state) return;
        try { state.cleanup?.(); } catch { }
        state = null;
        try { modalOverlay?.classList.remove('modal-overlay--drive'); } catch { }
    }

    /**
     * Inicjalizuje interakcje modalu po wstawieniu HTML do DOM.
     *
     * @param {{ files?: any[], token?: string, onOpenDiff?: ((change: any, context: { token: string }) => void | Promise<void>) | null }} [opts]
     * @returns {void}
     */
    function init({ files, token, onOpenDiff } = {}) {
        const list = Array.isArray(files) ? files : [];
        if (!modalOverlay || !modalContent) return;
        const modalState = {
            files: list,
            token: String(token || ''),
            onOpenDiff: typeof onOpenDiff === 'function' ? onOpenDiff : null
        };

        const root = modalContent.querySelector('.qe-drive-modal[data-qe-drive-changes="1"]');
        if (!root) return;

        teardown();
        modalOverlay.classList.add('modal-overlay--drive');

        const cleanupFns = [];
        const scrollEl = root.querySelector('.qe-drive-scroll');
        const scrollbarEl = root.querySelector('.qe-drive-scrollbar');
        const scrollbarThumb = root.querySelector('.qe-drive-scrollbar-thumb');
        if (scrollEl && scrollbarEl && scrollbarThumb) cleanupFns.push(attachOverlayScrollbar(scrollEl, scrollbarEl, scrollbarThumb));

        const expandAllBtn = root.querySelector('.qe-drive-expandall');
        const items = Array.from(root.querySelectorAll('.qe-drive-change'));

        /**
         * W stanie zwinietym blokujemy fokus na elementach wewnatrz panelu.
         * Dzięki temu nawigacja klawiatura nie trafia do ukrytej tresci.
         */
        const setPanelInteractivity = (panelEl, enabled) => {
            if (!panelEl) return;
            try {
                if ('inert' in panelEl) panelEl.inert = !enabled;
            } catch { }
            const focusables = panelEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
            for (const el of focusables) {
                if (!(el instanceof HTMLElement)) continue;
                if (!enabled) {
                    if (!el.dataset.qePrevTabindex) el.dataset.qePrevTabindex = String(el.getAttribute('tabindex') ?? '');
                    el.setAttribute('tabindex', '-1');
                } else {
                    const prev = el.dataset.qePrevTabindex;
                    if (prev === '') el.removeAttribute('tabindex');
                    else if (prev) el.setAttribute('tabindex', prev);
                    else el.removeAttribute('tabindex');
                    delete el.dataset.qePrevTabindex;
                }
            }
        };

        const syncPanelHeight = (itemEl, expanded) => {
            const panel = itemEl?.querySelector?.('.qe-drive-change-panel');
            if (!panel) return;
            if (!expanded) {
                panel.style.setProperty('--qe-drive-panel-max', '0px');
                return;
            }
            panel.style.setProperty('--qe-drive-panel-max', `${panel.scrollHeight}px`);
        };

        const setExpanded = (itemEl, expanded, { animate = true } = {}) => {
            const btn = itemEl?.querySelector?.('.qe-drive-change-toggle');
            const panel = itemEl?.querySelector?.('.qe-drive-change-panel');
            if (!btn || !panel) return;

            const wasExpanded = itemEl.classList.contains('is-expanded');
            const heightBefore = (!expanded && wasExpanded) ? panel.scrollHeight : 0;
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            itemEl.classList.toggle('is-expanded', expanded);

            if (!animate || prefersReducedMotion?.()) {
                panel.hidden = !expanded;
                panel.style.removeProperty('--qe-drive-panel-max');
                setPanelInteractivity(panel, expanded);
                if (expanded) syncPanelHeight(itemEl, true);
                return;
            }

            panel.hidden = false;
            if (expanded) {
                setPanelInteractivity(panel, true);
                panel.style.setProperty('--qe-drive-panel-max', '0px');
                window.requestAnimationFrame(() => {
                    syncPanelHeight(itemEl, true);
                    scrollEl?.dispatchEvent?.(new Event('scroll'));
                });
                return;
            }

            panel.style.setProperty('--qe-drive-panel-max', `${heightBefore}px`);
            void panel.offsetHeight;
            const onEnd = (e) => {
                if (e && e.propertyName !== 'max-height') return;
                panel.removeEventListener('transitionend', onEnd);
                if (!itemEl.classList.contains('is-expanded')) panel.hidden = true;
                setPanelInteractivity(panel, false);
                scrollEl?.dispatchEvent?.(new Event('scroll'));
            };
            panel.addEventListener('transitionend', onEnd);
            panel.style.setProperty('--qe-drive-panel-max', '0px');
        };

        const computeExpandedState = () => items.length > 0 && items.every((el) => el.classList.contains('is-expanded'));

        const updateExpandAllUi = () => {
            if (!expandAllBtn) return;
            const allExpanded = computeExpandedState();
            expandAllBtn.setAttribute('aria-pressed', allExpanded ? 'true' : 'false');
            expandAllBtn.setAttribute('aria-label', allExpanded ? 'Zwin wszystkie kafelki' : 'Rozwin wszystkie kafelki');
            expandAllBtn.classList.toggle('is-expanded', allExpanded);
        };

        for (const item of items) {
            const panel = item.querySelector('.qe-drive-change-panel');
            setPanelInteractivity(panel, false);
        }
        updateExpandAllUi();

        const onExpandAllClick = () => {
            const next = !computeExpandedState();
            for (const el of items) setExpanded(el, next, { animate: true });
            updateExpandAllUi();
            scrollEl?.dispatchEvent?.(new Event('scroll'));
        };
        expandAllBtn?.addEventListener?.('click', onExpandAllClick);
        if (expandAllBtn) cleanupFns.push(() => expandAllBtn.removeEventListener('click', onExpandAllClick));

        const onRootClick = (ev) => {
            const eventTarget = ev.target instanceof Element ? ev.target : null;
            const diffBtn = eventTarget?.closest?.('.qe-drive-diff-btn');
            if (diffBtn) {
                ev.preventDefault?.();
                ev.stopPropagation?.();
                const changeIndex = Number(diffBtn.getAttribute('data-qe-change-index'));
                const change = Number.isInteger(changeIndex) ? modalState.files?.[changeIndex] : null;
                if (!change || typeof modalState.onOpenDiff !== 'function') return;
                Promise.resolve(modalState.onOpenDiff(change, { token: modalState.token })).catch(() => { });
                return;
            }
            const toggle = eventTarget?.closest?.('.qe-drive-change-toggle');
            if (!toggle) return;
            const item = toggle.closest('.qe-drive-change');
            const isExpanded = item?.classList?.contains('is-expanded');
            setExpanded(item, !isExpanded, { animate: true });
            updateExpandAllUi();
            scrollEl?.dispatchEvent?.(new Event('scroll'));
        };
        root.addEventListener('click', onRootClick);
        cleanupFns.push(() => root.removeEventListener('click', onRootClick));

        state = {
            ...modalState,
            cleanup: () => {
                for (const fn of cleanupFns) {
                    try { fn?.(); } catch { }
                }
            }
        };
    }

    /**
     * Podpina niestandardowy pionowy pasek przewijania do obszaru listy zmian.
     *
     * @param {HTMLElement} scrollEl
     * @param {HTMLElement} trackEl
     * @param {HTMLElement} thumbEl
     * @returns {() => void}
     */
    function attachOverlayScrollbar(scrollEl, trackEl, thumbEl) {
        let raf = 0;
        let hideTimer = 0;
        let dragging = false;
        let dragStartY = 0;
        let dragStartScrollTop = 0;

        const show = () => {
            trackEl.classList.add('is-visible');
            if (hideTimer) window.clearTimeout(hideTimer);
            hideTimer = window.setTimeout(() => trackEl.classList.remove('is-visible'), 1100);
        };

        const update = () => {
            raf = 0;
            const height = scrollEl.clientHeight;
            const total = scrollEl.scrollHeight;
            const canScroll = total > height + 1;
            trackEl.hidden = !canScroll;
            if (!canScroll) return;

            const ratio = height / total;
            const thumbMin = 36;
            const thumbH = Math.max(thumbMin, Math.round(height * ratio));
            const maxThumbTop = Math.max(1, height - thumbH);
            const maxScrollTop = Math.max(1, total - height);
            const thumbTop = Math.round((scrollEl.scrollTop / maxScrollTop) * maxThumbTop);

            thumbEl.style.height = `${thumbH}px`;
            thumbEl.style.transform = `translateY(${thumbTop}px)`;
        };

        const schedule = () => {
            if (raf) return;
            raf = window.requestAnimationFrame(update);
        };

        const onScroll = () => {
            show();
            schedule();
        };

        const onPointerDownThumb = (e) => {
            dragging = true;
            dragStartY = e.clientY;
            dragStartScrollTop = scrollEl.scrollTop;
            thumbEl.setPointerCapture?.(e.pointerId);
            show();
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!dragging) return;
            const height = scrollEl.clientHeight;
            const total = scrollEl.scrollHeight;
            const ratio = height / total;
            const thumbMin = 36;
            const thumbH = Math.max(thumbMin, Math.round(height * ratio));
            const maxThumbTop = Math.max(1, height - thumbH);
            const maxScrollTop = Math.max(1, total - height);
            const deltaY = e.clientY - dragStartY;
            const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop;
            scrollEl.scrollTop = dragStartScrollTop + scrollDelta;
            show();
            schedule();
        };

        const onPointerUp = (e) => {
            if (!dragging) return;
            dragging = false;
            try { thumbEl.releasePointerCapture?.(e.pointerId); } catch { }
            show();
        };

        const onTrackPointerDown = (e) => {
            if (e.target === thumbEl) return;
            const rect = trackEl.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const height = scrollEl.clientHeight;
            const total = scrollEl.scrollHeight;
            const ratio = height / total;
            const thumbMin = 36;
            const thumbH = Math.max(thumbMin, Math.round(height * ratio));
            const maxThumbTop = Math.max(1, height - thumbH);
            const maxScrollTop = Math.max(1, total - height);
            const targetThumbTop = Math.max(0, Math.min(maxThumbTop, y - (thumbH / 2)));
            scrollEl.scrollTop = (targetThumbTop / maxThumbTop) * maxScrollTop;
            show();
            schedule();
        };

        const ro = new ResizeObserver(() => schedule());
        ro.observe(scrollEl);

        scrollEl.addEventListener('scroll', onScroll, { passive: true });
        scrollEl.addEventListener('pointerenter', show, { passive: true });
        scrollEl.addEventListener('pointermove', show, { passive: true });
        trackEl.addEventListener('pointerenter', show, { passive: true });
        trackEl.addEventListener('pointermove', show, { passive: true });
        thumbEl.addEventListener('pointerdown', onPointerDownThumb);
        trackEl.addEventListener('pointerdown', onTrackPointerDown);

        const onTrackWheel = (e) => {
            scrollEl.scrollTop += e.deltaY;
            show();
            schedule();
            e.preventDefault();
        };
        trackEl.addEventListener('wheel', onTrackWheel, { passive: false });
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);

        schedule();
        return () => {
            try { if (raf) window.cancelAnimationFrame(raf); } catch { }
            try { if (hideTimer) window.clearTimeout(hideTimer); } catch { }
            try { ro.disconnect(); } catch { }
            try { scrollEl.removeEventListener('scroll', onScroll); } catch { }
            try { scrollEl.removeEventListener('pointerenter', show); } catch { }
            try { scrollEl.removeEventListener('pointermove', show); } catch { }
            try { thumbEl.removeEventListener('pointerdown', onPointerDownThumb); } catch { }
            try { trackEl.removeEventListener('pointerdown', onTrackPointerDown); } catch { }
            try { trackEl.removeEventListener('wheel', onTrackWheel); } catch { }
            try { trackEl.removeEventListener('pointerenter', show); } catch { }
            try { trackEl.removeEventListener('pointermove', show); } catch { }
            try { window.removeEventListener('pointermove', onPointerMove); } catch { }
            try { window.removeEventListener('pointerup', onPointerUp); } catch { }
        };
    }

    return {
        buildChangesModalHtml: buildDriveChangesModalHtml,
        init,
        teardown
    };
}
