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

    // Ikona telefonu (inline SVG) używana dla punktów „na telefon” (brak godziny lub '-').
    const PHONE_ICON_SVG = [
        '<svg class="result-time-icon" width="16" height="16" viewBox="0 0 24 24" role="img" aria-label="Punkt na telefon" title="Punkt na telefon" focusable="false" xmlns="http://www.w3.org/2000/svg">',
        '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.3 1.7.54 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.06a2 2 0 0 1 2.11-.45c.8.24 1.64.42 2.5.54A2 2 0 0 1 22 16.92z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        '</svg>'
    ].join('');

    function isPhonePointTime(value) {
        const t = String(value ?? '').trim();
        return t === '' || t === '-';
    }

    function extractThreeParts(result) {
        // Wynik UI ma pokazywać tylko 3 pola: godzina / adres / placówka, niezależnie od źródła danych.
        if (result?.isComplete) {
            const parts = String(result.displayText || '').split('|').map(s => s.trim());
            return { time: parts[0] || '', address: parts[1] || '', facility: parts[2] || '' };
        }
        const cells = Array.isArray(result?.cells) ? result.cells : [];
        const nonEmpty = cells.map(c => (c == null ? '' : String(c))).map(s => s.trim()).filter(s => s !== '');
        return { time: nonEmpty[0] || '', address: nonEmpty[1] || '', facility: nonEmpty[2] || '' };
    }

    function buildResultSummaryHtml(result, query, { isLab = false } = {}) {
        const { time, address, facility: rawFacility } = extractThreeParts(result);
        const timeHtml = isPhonePointTime(time) ? PHONE_ICON_SVG : highlightText(time, query);
        const facility = isLab ? toTitleCase(rawFacility) : rawFacility;
        const facilityClass = isLab ? 'result-col result-facility result-facility--lab' : 'result-col result-facility';
        return [
            `<span class="result-col result-time">${timeHtml}</span>`,
            `<span class="result-col result-address">${highlightText(address, query)}</span>`,
            `<span class="${facilityClass}">${highlightText(facility, query)}</span>`
        ].join('');
    }

    function createGroupElement(group, index, query, { animateIn = false, enterDelayMs = 0 } = {}) {
        const fileName = String(group?.fileName || '');
        const routeName = formatRouteNameForResults(fileName);
        const routeCode = extractRouteCodeFromFileName(fileName);
        const driverNames = routeCode ? getDriverForRouteOnDate(routeCode, new Date()) : null;
        const driverBadgesHtml = buildDriverBadgesHtml(driverNames);
        const driverHtml = driverBadgesHtml ? `<div class="result-driver" aria-label="Kierowcy z grafiku">${driverBadgesHtml}</div>` : '';

        const groupDiv = document.createElement('div');
        const directionClass = (index % 2 === 0) ? 'qe-enter-left' : 'qe-enter-right';
        groupDiv.className = animateIn ? `result-group qe-result-enter ${directionClass}` : 'result-group';
        groupDiv.dataset.index = index;
        if (animateIn && Number.isFinite(enterDelayMs) && enterDelayMs > 0) groupDiv.style.setProperty('--qe-enter-delay', `${enterDelayMs}ms`);

        const items = Array.isArray(group?.items) ? group.items : [];
        const rowsHtml = items.map(item => {
            const isLab = item?.isComplete ? rowMatchesKeyLab((Array.isArray(item?.cells) ? item.cells : []).join(' ')) : false;
            const parts = extractThreeParts(item);
            const isPhonePoint = isPhonePointTime(parts.time);
            const rowClass = [
                'result-row',
                isLab ? 'result-row--lab' : '',
                isPhonePoint ? 'result-row--phonepoint' : ''
            ].filter(Boolean).join(' ');
            return `<div class="${rowClass}" data-row-index="${item.rowIndex}" data-file-name="${escapeHtml(item.fileName)}">
            <div class="result-content">${buildResultSummaryHtml(item, query, { isLab })}</div>
        </div>`;
        }).join('');

        setElementHtml(groupDiv, `<div class="result-group-header"><div class="result-group-header-inner"><span class="result-route-name">${routeName}</span></div>${driverHtml}</div><div class="result-group-body">${rowsHtml}</div>`);
        return groupDiv;
    }

    return { createGroupElement };
}
