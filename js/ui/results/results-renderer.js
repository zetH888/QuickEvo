export function createResultsRenderer(cfg) {
    const formatRouteNameForResults = typeof cfg?.formatRouteNameForResults === 'function' ? cfg.formatRouteNameForResults : ((x) => String(x || ''));
    const extractRouteCodeFromFileName = typeof cfg?.extractRouteCodeFromFileName === 'function' ? cfg.extractRouteCodeFromFileName : (() => null);
    const getDriverForRouteOnDate = typeof cfg?.getDriverForRouteOnDate === 'function' ? cfg.getDriverForRouteOnDate : (() => null);
    const buildDriverBadgesHtml = typeof cfg?.buildDriverBadgesHtml === 'function' ? cfg.buildDriverBadgesHtml : (() => '');
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((x) => String(x ?? ''));
    const setElementHtml = typeof cfg?.setElementHtml === 'function' ? cfg.setElementHtml : ((el, html) => { if (el) el.innerHTML = String(html ?? ''); });
    const rowMatchesKeyLab = typeof cfg?.rowMatchesKeyLab === 'function' ? cfg.rowMatchesKeyLab : (() => false);
    const toTitleCase = typeof cfg?.toTitleCase === 'function' ? cfg.toTitleCase : ((x) => String(x || ''));
    const highlightText = typeof cfg?.highlightText === 'function' ? cfg.highlightText : ((text) => String(text ?? ''));
    const isEmptyCell = typeof cfg?.isEmptyCell === 'function' ? cfg.isEmptyCell : ((v) => v == null || v === '');

    function buildResultSummaryHtml(result, query, { isLab = false } = {}) {
        if (result?.isComplete) {
            const parts = String(result.displayText || '').split('|').map(s => s.trim());
            const time = parts[0] || '—', address = parts[1] || '';
            let facility = parts[2] || '';
            if (isLab) facility = toTitleCase(facility);
            const facilityClass = isLab ? 'result-col result-facility result-facility--lab' : 'result-col result-facility';
            return [
                `<span class="result-col result-time">${highlightText(time, query)}</span>`,
                `<span class="result-col result-address">${highlightText(address, query)}</span>`,
                `<span class="${facilityClass}">${highlightText(facility, query)}</span>`
            ].join('');
        }
        const cells = Array.isArray(result?.cells) ? result.cells : [];
        return cells.filter(c => !isEmptyCell(c)).map(c => {
            let text = String(c);
            if (isLab) text = toTitleCase(text);
            return `<span class="result-cell-fragment">${highlightText(text, query)}</span>`;
        }).join('');
    }

    function createGroupElement(group, index, query, { animateIn = false, enterDelayMs = 0 } = {}) {
        const fileName = String(group?.fileName || '');
        const routeName = formatRouteNameForResults(fileName);
        const routeCode = extractRouteCodeFromFileName(fileName);
        const driverNames = routeCode ? getDriverForRouteOnDate(routeCode, new Date()) : null;
        const driverBadgesHtml = buildDriverBadgesHtml(driverNames);
        const driverHtml = driverBadgesHtml ? `<span class="result-driver" aria-label="Kierowcy z grafiku">— ${driverBadgesHtml}</span>` : '';

        const groupDiv = document.createElement('div');
        const directionClass = (index % 2 === 0) ? 'qe-enter-left' : 'qe-enter-right';
        groupDiv.className = animateIn ? `result-group qe-result-enter ${directionClass}` : 'result-group';
        groupDiv.dataset.index = index;
        if (animateIn && Number.isFinite(enterDelayMs) && enterDelayMs > 0) groupDiv.style.setProperty('--qe-enter-delay', `${enterDelayMs}ms`);

        const items = Array.isArray(group?.items) ? group.items : [];
        const rowsHtml = items.map(item => {
            const isLab = item?.isComplete ? rowMatchesKeyLab((Array.isArray(item?.cells) ? item.cells : []).join(' ')) : false;
            const rowClass = isLab ? 'result-row result-row--lab' : 'result-row';
            return `<div class="${rowClass}" data-row-index="${item.rowIndex}" data-file-name="${escapeHtml(item.fileName)}">
            <div class="result-content">${buildResultSummaryHtml(item, query, { isLab })}</div>
        </div>`;
        }).join('');

        setElementHtml(groupDiv, `<div class="result-group-header"><span class="result-filename"><span class="result-route-name">${routeName}</span>${driverHtml}</span></div><div class="result-group-body">${rowsHtml}</div>`);
        return groupDiv;
    }

    return { createGroupElement };
}

