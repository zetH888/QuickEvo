import { focusElementSafely, getActiveHtmlElement, isRestorableFocusTarget, moveFocusOutsideContainer, setElementInert } from '../../core/focus-visibility.js';

export function createModalController(cfg) {
    const modalOverlay = cfg?.modalOverlay || null;
    const modalTitle = cfg?.modalTitle || null;
    const modalContent = cfg?.modalContent || null;
    const modalActions = cfg?.modalActions || null;

    const buildTitleHtml = typeof cfg?.buildTitleHtml === 'function' ? cfg.buildTitleHtml : ((t) => ({ html: String(t || ''), hasDrive: false }));
    const setElementHtml = typeof cfg?.setElementHtml === 'function' ? cfg.setElementHtml : ((el, html) => { if (el) el.innerHTML = String(html ?? ''); });
    const clearElement = typeof cfg?.clearElement === 'function' ? cfg.clearElement : ((el) => { if (el) el.replaceChildren(); });
    const onBeforeHide = typeof cfg?.onBeforeHide === 'function' ? cfg.onBeforeHide : (() => { });
    let secondaryModalState = null;
    let lastFocusedBeforeOpen = null;

    /**
     * Zwraca najlepszy kandydat do odzyskania fokusu po zamknieciu glownego modala.
     *
     * @returns {HTMLElement | null}
     */
    function getFocusRestoreTarget() {
        if (isRestorableFocusTarget(lastFocusedBeforeOpen) && !modalOverlay?.contains(lastFocusedBeforeOpen)) return lastFocusedBeforeOpen;
        return document?.body instanceof HTMLElement ? document.body : null;
    }

    function show(title, content, actions = []) {
        if (!modalOverlay || !modalTitle || !modalContent || !modalActions) return;
        const activeBeforeOpen = getActiveHtmlElement(document);
        if (!modalOverlay.contains(activeBeforeOpen)) lastFocusedBeforeOpen = activeBeforeOpen;
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
        setElementInert(modalOverlay, false);
    }

    /**
     * Pokazuje drugi modal osadzony nad głównym hostem systemowego modala.
     * Dzięki temu stan głównej zawartości pozostaje nienaruszony.
     *
     * @param {{
     *   title?: string,
     *   content?: string,
     *   className?: string,
     *   closeLabel?: string,
     *   onClose?: (() => void) | null
     * }} options
     * @returns {void}
     */
    function showSecondary(options = {}) {
        if (!modalOverlay) return;
        const title = String(options?.title || '').trim();
        const content = String(options?.content ?? '');
        const className = String(options?.className || '').trim();
        const closeLabel = String(options?.closeLabel || 'Zamknij');

        if (!secondaryModalState) secondaryModalState = createSecondaryModalDom();
        if (!secondaryModalState) return;

        secondaryModalState.onClose = typeof options?.onClose === 'function' ? options.onClose : null;
        secondaryModalState.previousActiveElement = getActiveHtmlElement(document);
        secondaryModalState.titleEl.textContent = title;
        setElementHtml(secondaryModalState.contentEl, content);
        secondaryModalState.cardEl.className = `qe-secondary-modal-card${className ? ` ${className}` : ''}`;
        secondaryModalState.closeBtn.setAttribute('aria-label', closeLabel);
        secondaryModalState.overlayEl.hidden = false;
        secondaryModalState.overlayEl.setAttribute('aria-hidden', 'false');
        setElementInert(secondaryModalState.overlayEl, false);
        secondaryModalState.closeBtn.focus({ preventScroll: true });
    }

    /**
     * Aktualizuje treść już otwartego drugiego modala.
     *
     * @param {{ title?: string, content?: string, className?: string }} options
     * @returns {void}
     */
    function updateSecondary(options = {}) {
        if (!secondaryModalState) {
            showSecondary(options);
            return;
        }
        if (options && Object.prototype.hasOwnProperty.call(options, 'title')) {
            secondaryModalState.titleEl.textContent = String(options?.title || '').trim();
        }
        if (options && Object.prototype.hasOwnProperty.call(options, 'content')) {
            setElementHtml(secondaryModalState.contentEl, String(options?.content ?? ''));
        }
        if (options && Object.prototype.hasOwnProperty.call(options, 'className')) {
            const className = String(options?.className || '').trim();
            secondaryModalState.cardEl.className = `qe-secondary-modal-card${className ? ` ${className}` : ''}`;
        }
    }

    /**
     * Zamyka drugi modal bez ukrywania głównego hosta.
     *
     * @returns {void}
     */
    function hideSecondary() {
        if (!secondaryModalState) return;
        const { overlayEl, onClose, previousActiveElement } = secondaryModalState;
        secondaryModalState = null;
        moveFocusOutsideContainer(overlayEl, { preferredTarget: previousActiveElement });
        setElementInert(overlayEl, true);
        overlayEl.hidden = true;
        overlayEl.setAttribute('aria-hidden', 'true');
        try { onClose?.(); } catch { }
        try { overlayEl.remove(); } catch { }
        focusElementSafely(previousActiveElement);
    }

    function hide() {
        hideSecondary();
        onBeforeHide();
        if (!modalOverlay) return;
        moveFocusOutsideContainer(modalOverlay, { preferredTarget: getFocusRestoreTarget() });
        setElementInert(modalOverlay, true);
        modalOverlay.classList.add('hidden');
        modalOverlay.setAttribute('aria-hidden', 'true');
    }

    /**
     * Tworzy DOM drugiego modala i podpina obsługę zamknięcia.
     *
     * @returns {{
     *   overlayEl: HTMLDivElement,
     *   cardEl: HTMLDivElement,
     *   titleEl: HTMLDivElement,
     *   contentEl: HTMLDivElement,
     *   closeBtn: HTMLButtonElement,
     *   onClose: (() => void) | null,
     *   previousActiveElement: HTMLElement | null
     * } | null}
     */
    function createSecondaryModalDom() {
        if (!modalOverlay || !document?.createElement) return null;

        const overlayEl = document.createElement('div');
        overlayEl.className = 'qe-secondary-modal-overlay';
        overlayEl.hidden = true;
        overlayEl.setAttribute('aria-hidden', 'true');

        const cardEl = document.createElement('div');
        cardEl.className = 'qe-secondary-modal-card';
        cardEl.setAttribute('role', 'dialog');
        cardEl.setAttribute('aria-modal', 'true');

        const headerEl = document.createElement('div');
        headerEl.className = 'qe-secondary-modal-header';

        const titleEl = document.createElement('div');
        titleEl.className = 'qe-secondary-modal-title';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'qe-secondary-modal-close';
        closeBtn.textContent = 'Zamknij';

        const contentEl = document.createElement('div');
        contentEl.className = 'qe-secondary-modal-content';

        closeBtn.addEventListener('click', () => hideSecondary());
        overlayEl.addEventListener('click', (event) => {
            if (event.target === overlayEl) hideSecondary();
        });
        cardEl.addEventListener('click', (event) => event.stopPropagation());
        overlayEl.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                hideSecondary();
            }
        });

        headerEl.append(titleEl, closeBtn);
        cardEl.append(headerEl, contentEl);
        overlayEl.appendChild(cardEl);
        modalOverlay.appendChild(overlayEl);

        return {
            overlayEl,
            cardEl,
            titleEl,
            contentEl,
            closeBtn,
            onClose: null,
            previousActiveElement: null
        };
    }

    return { show, hide, showSecondary, updateSecondary, hideSecondary };
}
