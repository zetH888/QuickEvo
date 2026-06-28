import { normalizeText } from '../../core/utils.js';

export function createPreviewController(cfg) {
    const searchView = cfg?.searchView || null;
    const filePreviewView = cfg?.filePreviewView || null;
    const previewMeta = cfg?.previewMeta || null;
    const previewFileName = cfg?.previewFileName || null;
    const tableHeader = cfg?.tableHeader || null;
    const tableBody = cfg?.tableBody || null;

    const formatFileName = typeof cfg?.formatFileName === 'function' ? cfg.formatFileName : ((x) => String(x || ''));
    const getRouteCategoriesFromFileName = typeof cfg?.getRouteCategoriesFromFileName === 'function'
        ? cfg.getRouteCategoriesFromFileName
        : (() => []);
    const extractRouteCodeFromFileName = typeof cfg?.extractRouteCodeFromFileName === 'function'
        ? cfg.extractRouteCodeFromFileName
        : (() => '');
    const getDriverForRouteOnDate = typeof cfg?.getDriverForRouteOnDate === 'function'
        ? cfg.getDriverForRouteOnDate
        : (() => null);
    const getDriverForRouteOnIsoDate = typeof cfg?.getDriverForRouteOnIsoDate === 'function'
        ? cfg.getDriverForRouteOnIsoDate
        : (() => null);
    const buildDriverBadgesHtml = typeof cfg?.buildDriverBadgesHtml === 'function'
        ? cfg.buildDriverBadgesHtml
        : (() => '');
    const onDriverBadgeClick = typeof cfg?.onDriverBadgeClick === 'function'
        ? cfg.onDriverBadgeClick
        : null;

    /**
     * Sprawdza, czy wartość wygląda jak data ISO w formacie `YYYY-MM-DD`.
     * Walidacja jest celowo lekka (UI), bo twarda walidacja jest realizowana w `schedule-service`.
     *
     * @param {unknown} value
     * @returns {string} Poprawna data ISO albo pusty string.
     */
    function coerceIsoDate(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
        return raw;
    }

    function clearElement(el) {
        if (!el) return;
        el.replaceChildren();
    }

    /**
     * Obsługuje kliknięcia w badge'e kierowców osadzone w nagłówku podglądu trasy.
     *
     * @param {MouseEvent} event
     * @returns {void}
     */
    function handlePreviewFileNameClick(event) {
        if (!onDriverBadgeClick || !previewFileName) return;
        const target = event?.target;
        if (!(target instanceof Element)) return;

        const badgeEl = target.closest('.result-driver-badge[data-driver-name]');
        if (!(badgeEl instanceof HTMLElement)) return;

        const driverName = String(badgeEl.dataset.driverName || '').trim();
        if (!driverName) return;

        event.preventDefault();
        event.stopPropagation();
        onDriverBadgeClick(driverName);
    }

    function updateMeta(metaLines) {
        if (!previewMeta) return;
        const lines = Array.isArray(metaLines) ? metaLines : [];
        if (lines.length > 0) {
            previewMeta.textContent = lines.join('\n');
            previewMeta.classList.remove('hidden');
        } else {
            previewMeta.textContent = '';
            previewMeta.classList.add('hidden');
        }
    }

    /**
     * Renderuje nazwę pliku oraz metadane trasy (kategorie + kierowca dla danej daty kontekstowej).
     *
     * @param {string} fileName
     * @param {{ contextIsoDate?: string }} [opts]
     */
    function renderFileName(fileName, opts = {}) {
        if (!previewFileName) return;
        previewFileName.replaceChildren();

        const title = document.createElement('span');
        title.className = 'preview-filename-title';
        title.textContent = formatFileName(fileName);
        previewFileName.appendChild(title);

        const categories = getRouteCategoriesFromFileName(fileName);
        const uniqueCats = Array.from(new Set((Array.isArray(categories) ? categories : []).map(c => String(c || '').trim()).filter(Boolean)));
        for (const cat of uniqueCats) {
            const badge = document.createElement('span');
            badge.className = 'route-category-badge';
            badge.dataset.routeCategory = cat;
            badge.textContent = cat;
            previewFileName.appendChild(badge);
        }

        const routeCode = extractRouteCodeFromFileName(fileName);
        const contextIsoDate = coerceIsoDate(opts?.contextIsoDate);
        const driverNames = routeCode
            ? (contextIsoDate
                ? getDriverForRouteOnIsoDate(routeCode, contextIsoDate)
                : getDriverForRouteOnDate(routeCode, new Date()))
            : null;
        const driverBadgesHtml = buildDriverBadgesHtml(driverNames, { interactive: Boolean(onDriverBadgeClick) });
        if (driverBadgesHtml) {
            const driverEl = document.createElement('span');
            driverEl.className = 'result-driver';
            driverEl.setAttribute('aria-label', contextIsoDate ? `Kierowcy z grafiku dla dnia ${contextIsoDate}` : 'Kierowcy z grafiku');
            if (contextIsoDate) driverEl.title = `Grafik: ${contextIsoDate}`;
            driverEl.innerHTML = driverBadgesHtml;
            previewFileName.appendChild(driverEl);
        }
    }

    function renderHeader(headers) {
        if (!tableHeader) return;
        const safeHeaders = Array.isArray(headers) ? headers : [];
        for (const h of safeHeaders) {
            const th = document.createElement('th');
            th.textContent = h || '';
            tableHeader.appendChild(th);
        }
    }

    function renderBody(tableModel, highlightRowIndex) {
        if (!tableBody) return null;
        const rows = Array.isArray(tableModel?.rows) ? tableModel.rows : [];
        const headers = Array.isArray(tableModel?.headers) ? tableModel.headers : [];
        let highlightedRowEl = null;

        for (const rowObj of rows) {
            const tr = document.createElement('tr');
            if (rowObj?.originalRowIndex === highlightRowIndex) {
                tr.classList.add('highlighted-row');
                highlightedRowEl = tr;
            }
            const cells = Array.isArray(rowObj?.cells) ? rowObj.cells : [];
            for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
                const cell = cells[cellIdx];
                const td = document.createElement('td');
                td.textContent = (cell === null || cell === undefined) ? '' : String(cell);
                const header = headers[cellIdx];
                if (header) {
                    const h = normalizeText(String(header));
                    if (h.includes('nazwa') || h.includes('placowk')) td.classList.add('facility-column');
                }
                tr.appendChild(td);
            }
            tableBody.appendChild(tr);
        }

        return highlightedRowEl;
    }

    function showSearch() {
        if (filePreviewView) filePreviewView.classList.add('view-hidden');
        if (searchView) searchView.classList.remove('view-hidden');
    }

    /**
     * Pokazuje widok podglądu pliku.
     *
     * @param {{ fileName: string, tableModel: any, highlightRowIndex: (number|null), contextIsoDate?: string }} params
     * @returns {Element|null}
     */
    function showPreview({ fileName, tableModel, highlightRowIndex, contextIsoDate }) {
        if (searchView) searchView.classList.add('view-hidden');
        if (filePreviewView) filePreviewView.classList.remove('view-hidden');

        renderFileName(fileName, { contextIsoDate });
        updateMeta(tableModel?.metaLines);

        clearElement(tableHeader);
        clearElement(tableBody);
        renderHeader(tableModel?.headers);
        return renderBody(tableModel, highlightRowIndex);
    }

    previewFileName?.addEventListener?.('click', handlePreviewFileNameClick);

    return { showSearch, showPreview, updateMeta, renderFileName };
}
