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

    function clearElement(el) {
        if (!el) return;
        el.replaceChildren();
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

    function renderFileName(fileName) {
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

    function showPreview({ fileName, tableModel, highlightRowIndex }) {
        if (searchView) searchView.classList.add('view-hidden');
        if (filePreviewView) filePreviewView.classList.remove('view-hidden');

        renderFileName(fileName);
        updateMeta(tableModel?.metaLines);

        clearElement(tableHeader);
        clearElement(tableBody);
        renderHeader(tableModel?.headers);
        return renderBody(tableModel, highlightRowIndex);
    }

    return { showSearch, showPreview, updateMeta, renderFileName };
}

