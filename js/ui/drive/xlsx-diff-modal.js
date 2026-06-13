/**
 * Renderuje stan ładowania podglądu różnic XLSX.
 *
 * @returns {string}
 */
export function renderXlsxDiffLoading() {
    return `<div class="qe-xlsx-diff">
        <div class="qe-xlsx-diff-loading">
            <div class="qe-spinner" aria-hidden="true"></div>
            <div class="qe-xlsx-diff-loading-text">Analizuję różnice XLSX...</div>
        </div>
    </div>`;
}

/**
 * Renderuje komunikat błędu podglądu różnic XLSX.
 *
 * @returns {string}
 */
export function renderXlsxDiffError() {
    return `<div class="qe-xlsx-diff">
        <div class="qe-xlsx-diff-message qe-xlsx-diff-message--error">
            Nie udało się wygenerować podglądu różnic. Nadal możesz nadpisać plik z głównego okna synchronizacji.
        </div>
    </div>`;
}

/**
 * Renderuje podgląd różnic komórek dla prostego diffu XLSX.
 *
 * @param {{
 *   hasChanges?: boolean,
 *   message?: string,
 *   summary?: { cellsAdded?: number, cellsRemoved?: number, cellsModified?: number },
 *   changes?: Array<{ address?: string, type?: string, oldValue?: string, newValue?: string }>
 * }} diff
 * @param {{ escapeHtml?: ((value: unknown) => string) | null }} [options]
 * @returns {string}
 */
export function renderXlsxDiff(diff, options = {}) {
    const escapeHtml = typeof options?.escapeHtml === 'function'
        ? options.escapeHtml
        : (value) => String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    const summary = diff?.summary && typeof diff.summary === 'object' ? diff.summary : {};
    const changes = Array.isArray(diff?.changes) ? diff.changes : [];
    const hasChanges = Boolean(diff?.hasChanges) && changes.length > 0;
    const infoMessage = String(diff?.message || '').trim()
        || 'Timestamp pliku zmienił się na Google Drive, ale nie wykryto zmian w zawartości arkusza.';

    const summaryHtml = `<div class="qe-xlsx-diff-summary">
        <div class="qe-xlsx-diff-stat qe-xlsx-diff-stat--added"><span>Dodane</span><strong>${escapeHtml(summary.cellsAdded ?? 0)}</strong></div>
        <div class="qe-xlsx-diff-stat qe-xlsx-diff-stat--removed"><span>Usunięte</span><strong>${escapeHtml(summary.cellsRemoved ?? 0)}</strong></div>
        <div class="qe-xlsx-diff-stat qe-xlsx-diff-stat--modified"><span>Zmienione</span><strong>${escapeHtml(summary.cellsModified ?? 0)}</strong></div>
    </div>`;

    if (!hasChanges) {
        return `<div class="qe-xlsx-diff">
            ${summaryHtml}
            <div class="qe-xlsx-diff-message qe-xlsx-diff-message--info">${escapeHtml(infoMessage)}</div>
        </div>`;
    }

    const rowsHtml = changes.map((change) => {
        const type = normalizeChangeType(change?.type);
        const oldValue = formatDiffCellValue(change?.oldValue, escapeHtml);
        const newValue = formatDiffCellValue(change?.newValue, escapeHtml);
        return `<tr class="qe-xlsx-diff-row qe-xlsx-diff-row--${type}">
            <td class="qe-xlsx-diff-col qe-xlsx-diff-col--address">${escapeHtml(String(change?.address || ''))}</td>
            <td class="qe-xlsx-diff-col">${oldValue}</td>
            <td class="qe-xlsx-diff-col">${newValue}</td>
            <td class="qe-xlsx-diff-col qe-xlsx-diff-col--type"><span class="qe-xlsx-diff-badge qe-xlsx-diff-badge--${type}">${escapeHtml(formatChangeTypeLabel(type))}</span></td>
        </tr>`;
    }).join('');

    return `<div class="qe-xlsx-diff">
        ${summaryHtml}
        <div class="qe-xlsx-diff-table-wrap">
            <table class="qe-xlsx-diff-table">
                <thead>
                    <tr>
                        <th>Komórka</th>
                        <th>Stara wartość</th>
                        <th>Nowa wartość</th>
                        <th>Typ</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    </div>`;
}

/**
 * Tworzy prosty kontroler prezentacji drugiego modala XLSX diff.
 *
 * @param {{
 *   modalController?: { showSecondary?: Function, updateSecondary?: Function, hideSecondary?: Function } | null,
 *   formatFileName?: ((name: string) => string) | null,
 *   escapeHtml?: ((value: unknown) => string) | null,
 *   onClose?: (() => void) | null
 * }} cfg
 * @returns {{ openLoading: (fileName: string) => void, showDiff: (fileName: string, diff: any) => void, showError: (fileName: string) => void, close: () => void }}
 */
export function createXlsxDiffModalController(cfg = {}) {
    const modalController = cfg?.modalController || null;
    const formatFileName = typeof cfg?.formatFileName === 'function' ? cfg.formatFileName : ((name) => String(name || ''));
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : null;
    const onClose = typeof cfg?.onClose === 'function' ? cfg.onClose : null;

    /**
     * Zwraca tytuł drugiego modala.
     *
     * @param {string} fileName
     * @returns {string}
     */
    const buildTitle = (fileName) => String(formatFileName(String(fileName || '').trim()) || fileName || 'Podgląd różnic');

    return {
        openLoading(fileName) {
            modalController?.showSecondary?.({
                title: buildTitle(fileName),
                content: renderXlsxDiffLoading(),
                className: 'qe-xlsx-diff-modal',
                closeLabel: 'Zamknij podgląd różnic',
                onClose
            });
        },
        showDiff(fileName, diff) {
            modalController?.updateSecondary?.({
                title: buildTitle(fileName),
                content: renderXlsxDiff(diff, { escapeHtml }),
                className: 'qe-xlsx-diff-modal'
            });
        },
        showError(fileName) {
            modalController?.updateSecondary?.({
                title: buildTitle(fileName),
                content: renderXlsxDiffError(),
                className: 'qe-xlsx-diff-modal'
            });
        },
        close() {
            modalController?.hideSecondary?.();
        }
    };
}

/**
 * Normalizuje typ zmiany do wspieranych wariantów UI.
 *
 * @param {unknown} type
 * @returns {'added'|'removed'|'modified'}
 */
function normalizeChangeType(type) {
    const safe = String(type || '').trim().toLowerCase();
    if (safe === 'added' || safe === 'removed') return safe;
    return 'modified';
}

/**
 * Zamienia typ zmiany na etykietę czytelną dla użytkownika.
 *
 * @param {'added'|'removed'|'modified'} type
 * @returns {string}
 */
function formatChangeTypeLabel(type) {
    if (type === 'added') return 'Dodano';
    if (type === 'removed') return 'Usunięto';
    return 'Zmieniono';
}

/**
 * Formatuje wartość komórki do czytelnej, bezpiecznej postaci HTML.
 *
 * @param {unknown} value
 * @param {(value: unknown) => string} escapeHtml
 * @returns {string}
 */
function formatDiffCellValue(value, escapeHtml) {
    const raw = String(value ?? '');
    const preview = truncateText(raw, 140);
    const safeFull = escapeHtml(raw);
    const safePreview = escapeHtml(preview.text);
    const emptyClass = raw ? '' : ' qe-xlsx-diff-cell--empty';
    return `<span class="qe-xlsx-diff-cell${emptyClass}" title="${safeFull}">${safePreview || '&mdash;'}</span>`;
}

/**
 * Skraca długą zawartość komórki do postaci wygodnej w tabeli.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {{ text: string, truncated: boolean }}
 */
function truncateText(text, maxLength) {
    const safeText = String(text ?? '');
    const limit = Math.max(12, Number(maxLength) || 140);
    if (safeText.length <= limit) return { text: safeText, truncated: false };
    return {
        text: `${safeText.slice(0, Math.max(0, limit - 1)).trimEnd()}…`,
        truncated: true
    };
}
