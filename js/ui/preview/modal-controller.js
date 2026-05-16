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

