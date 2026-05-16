export function createWelcomeProgressRenderer(cfg) {
    const formatFileName = typeof cfg?.formatFileName === 'function' ? cfg.formatFileName : ((x) => String(x || ''));
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((x) => String(x ?? ''));
    const setElementHtml = typeof cfg?.setElementHtml === 'function' ? cfg.setElementHtml : ((el, html) => { if (el) el.innerHTML = String(html ?? ''); });

    function createItem(fileName) {
        const item = document.createElement('div');
        item.className = 'welcome-progress-item';
        setElementHtml(item, `<div class="welcome-progress-name">${escapeHtml(formatFileName(fileName))}</div><div class="welcome-progress-bar-wrap"><div class="welcome-progress-bar-fill" style="width: 0%"></div></div><div class="welcome-progress-status">0%</div>`);
        return item;
    }

    function updateItem(item, percent, statusText, { isError = false, defer = false } = {}) {
        if (!item) return;
        const fill = item.querySelector('.welcome-progress-bar-fill');
        const status = item.querySelector('.welcome-progress-status');
        if (fill) fill.style.width = `${percent}%`;
        const nextStatus = statusText || `${Math.round(percent)}%`;
        if (defer) {
            item.setAttribute('data-pending-status', '1');
            item.setAttribute('data-pending-status-text', nextStatus);
            if (isError) item.setAttribute('data-pending-error', '1');
            return;
        }
        if (status) status.textContent = nextStatus;
        if (isError) item.classList.add('error');
    }

    return { createItem, updateItem };
}

