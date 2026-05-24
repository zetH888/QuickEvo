/**
 * @module preview-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla podglądu pliku w QuickEvo.
 *
 * Cel:
 * - odseparować przepływ „otwórz podgląd pliku → ustaw stan → loguj → odśwież UI” od `app.js`,
 * - pozostawić szczegóły DOM i renderowania w adapterach UI (`ui-components`),
 * - umożliwić dalszą dekompozycję `app.js` w kierunku cienkiego koordynatora.
 */

/**
 * Tworzy serwis aplikacyjny odpowiedzialny za otwieranie i zamykanie podglądu pliku.
 *
 * @param {Object} cfg
 * @param {(fileName: string) => any} cfg.getTableModel
 * @param {(opts: { fileName: string, rowIndex: number|null, contextIsoDate?: string|null }) => void} cfg.pushPreview
 * @param {(state: { fileName: string, rowIndex: number|null, contextIsoDate?: string|null }) => void} cfg.setLastPreviewState
 * @param {(opts: { fileName: string, tableModel: any, highlightRowIndex: number|null, contextIsoDate?: string|null }) => (Element|null)} cfg.showPreview
 * @param {() => void} cfg.showSearch
 * @param {(fileName: string) => void} cfg.queuePreviewReadyEvent
 * @param {(name: string, payload: any) => void} cfg.logClientEvent
 */
export function createPreviewApplication(cfg) {
    if (!cfg || typeof cfg.getTableModel !== 'function') throw new Error('preview-application: brak getTableModel');

    /**
     * Lekka walidacja daty ISO w formacie `YYYY-MM-DD`.
     * Wymusza stabilny kontrakt na granicy warstwy aplikacyjnej (UI może przekazać śmieci).
     *
     * @param {unknown} value
     * @returns {string|null}
     */
    function normalizeContextIsoDate(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
        return raw;
    }

    /**
     * Otwiera widok podglądu pełnej tabeli pliku.
     *
     * @param {{ fileName: string, rowIndex: (number|null), contextIsoDate?: (string|null), skipPush?: boolean }} params
     * @returns {void}
     */
    function openPreview({ fileName, rowIndex, contextIsoDate, skipPush } = {}) {
        const name = String(fileName || '');
        if (!name) return;

        const tableModel = cfg.getTableModel(name);
        if (!tableModel || !Array.isArray(tableModel.headers) || !Array.isArray(tableModel.rows)) return;

        const idx = Number.isInteger(rowIndex) ? rowIndex : null;
        const iso = normalizeContextIsoDate(contextIsoDate);
        if (!skipPush) {
            try { cfg.pushPreview?.({ fileName: name, rowIndex: idx, contextIsoDate: iso }); } catch { }
        }

        try { cfg.setLastPreviewState?.({ fileName: name, rowIndex: idx, contextIsoDate: iso }); } catch { }

        let highlightedRowEl = null;
        try { highlightedRowEl = cfg.showPreview?.({ fileName: name, tableModel, highlightRowIndex: idx, contextIsoDate: iso }); } catch { }

        try { if (highlightedRowEl && typeof highlightedRowEl.scrollIntoView === 'function') highlightedRowEl.scrollIntoView({ block: 'center' }); } catch { }
        try { cfg.queuePreviewReadyEvent?.(name); } catch { }
        try { cfg.logClientEvent?.('preview', { fileName: name, rowIndex: idx, contextIsoDate: iso }); } catch { }
    }

    /**
     * Przechodzi do widoku wyszukiwania.
     */
    function openSearch({ source } = {}) {
        try { cfg.showSearch?.(); } catch { }
        try { cfg.logClientEvent?.('navigate', { to: 'search', source: String(source || '') }); } catch { }
    }

    return Object.freeze({ openPreview, openSearch });
}
