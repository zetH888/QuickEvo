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
 * @param {(opts: { fileName: string, rowIndex: number }) => void} cfg.pushPreview
 * @param {(state: { fileName: string, rowIndex: number|null }) => void} cfg.setLastPreviewState
 * @param {(opts: { fileName: string, tableModel: any, highlightRowIndex: number|null }) => (Element|null)} cfg.showPreview
 * @param {() => void} cfg.showSearch
 * @param {(fileName: string) => void} cfg.queuePreviewReadyEvent
 * @param {(name: string, payload: any) => void} cfg.logClientEvent
 * @param {() => void} cfg.requestScrollIndicatorUpdate
 */
export function createPreviewApplication(cfg) {
    if (!cfg || typeof cfg.getTableModel !== 'function') throw new Error('preview-application: brak getTableModel');

    /**
     * Otwiera widok podglądu pełnej tabeli pliku.
     *
     * @param {{ fileName: string, rowIndex: (number|null), skipPush?: boolean }} params
     * @returns {void}
     */
    function openPreview({ fileName, rowIndex, skipPush } = {}) {
        const name = String(fileName || '');
        if (!name) return;

        const tableModel = cfg.getTableModel(name);
        if (!tableModel || !Array.isArray(tableModel.headers) || !Array.isArray(tableModel.rows)) return;

        const idx = Number.isInteger(rowIndex) ? rowIndex : null;
        if (!skipPush) {
            try { cfg.pushPreview?.({ fileName: name, rowIndex: idx }); } catch { }
        }

        try { cfg.setLastPreviewState?.({ fileName: name, rowIndex: idx }); } catch { }

        let highlightedRowEl = null;
        try { highlightedRowEl = cfg.showPreview?.({ fileName: name, tableModel, highlightRowIndex: idx }); } catch { }

        try { if (highlightedRowEl && typeof highlightedRowEl.scrollIntoView === 'function') highlightedRowEl.scrollIntoView({ block: 'center' }); } catch { }
        try { cfg.queuePreviewReadyEvent?.(name); } catch { }
        try { cfg.logClientEvent?.('preview', { fileName: name, rowIndex: idx }); } catch { }
        try { cfg.requestScrollIndicatorUpdate?.(); } catch { }
    }

    /**
     * Przechodzi do widoku wyszukiwania.
     */
    function openSearch({ source } = {}) {
        try { cfg.showSearch?.(); } catch { }
        try { cfg.logClientEvent?.('navigate', { to: 'search', source: String(source || '') }); } catch { }
        try { cfg.requestScrollIndicatorUpdate?.(); } catch { }
    }

    return Object.freeze({ openPreview, openSearch });
}
