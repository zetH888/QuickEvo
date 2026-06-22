/**
 * Renderuje stan ładowania podglądu różnic XLSX.
 *
 * @returns {string}
 */
let xlsxDiffViewInstanceId = 0;

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
    const changes = Array.isArray(diff?.changes) ? diff.changes : [];
    const preparedChanges = changes
        .map((change) => prepareDiffItem(change))
        .filter(Boolean);
    const groupedChanges = groupDiffsByRow(preparedChanges);
    const summary = buildVisibleSummary(preparedChanges);
    const hasChanges = preparedChanges.length > 0;
    const infoMessage = String(diff?.message || '').trim()
        || 'Timestamp pliku zmienił się na Google Drive, ale nie wykryto zmian w zawartości arkusza.';
    const message = changes.length > 0 && !hasChanges
        ? 'Nie wykryto istotnych zmian po ujednoliceniu pustych wartości i spacji.'
        : infoMessage;
    const viewSwitchId = `qe-xlsx-diff-view-${(xlsxDiffViewInstanceId += 1)}`;

    const summaryHtml = `<div class="qe-xlsx-diff-summary" aria-label="Podsumowanie zmian">
        <div class="qe-xlsx-diff-stat qe-xlsx-diff-stat--added"><span>Dodane</span><strong>${escapeHtml(summary.cellsAdded ?? 0)}</strong></div>
        <div class="qe-xlsx-diff-stat qe-xlsx-diff-stat--removed"><span>Usunięte</span><strong>${escapeHtml(summary.cellsRemoved ?? 0)}</strong></div>
        <div class="qe-xlsx-diff-stat qe-xlsx-diff-stat--modified"><span>Zmienione</span><strong>${escapeHtml(summary.cellsModified ?? 0)}</strong></div>
    </div>`;

    if (!hasChanges) {
        return `<div class="qe-xlsx-diff">
            <div class="qe-xlsx-diff-topbar">
                ${summaryHtml}
            </div>
            <div class="qe-xlsx-diff-message qe-xlsx-diff-message--info">${escapeHtml(message)}</div>
        </div>`;
    }

    return `<div class="qe-xlsx-diff">
        <div class="qe-xlsx-diff-topbar">
            ${summaryHtml}
            ${renderViewSwitch()}
        </div>
        <div class="qe-xlsx-diff-switch">
            <input class="qe-xlsx-diff-switch-input" type="radio" name="${escapeHtml(viewSwitchId)}" id="${escapeHtml(`${viewSwitchId}-list`)}" checked>
            <input class="qe-xlsx-diff-switch-input" type="radio" name="${escapeHtml(viewSwitchId)}" id="${escapeHtml(`${viewSwitchId}-side`)}">
            <div class="qe-xlsx-diff-switch-bar" role="radiogroup" aria-label="Widok różnic XLSX">
                <label class="qe-xlsx-diff-switch-option" for="${escapeHtml(`${viewSwitchId}-list`)}">Lista</label>
                <label class="qe-xlsx-diff-switch-option" for="${escapeHtml(`${viewSwitchId}-side`)}">Side by side</label>
            </div>
            <div class="qe-xlsx-diff-views">
                <section class="qe-xlsx-diff-view qe-xlsx-diff-view--list" aria-label="Widok listy">
                    ${renderListView(groupedChanges, escapeHtml)}
                </section>
                <section class="qe-xlsx-diff-view qe-xlsx-diff-view--side" aria-label="Widok side by side">
                    ${renderSideBySideView(groupedChanges, escapeHtml)}
                </section>
            </div>
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
 * Buduje górny pasek przełącznika widoków.
 *
 * @returns {string}
 */
function renderViewSwitch() {
    return `<div class="qe-xlsx-diff-topbar-meta">
        <div class="qe-xlsx-diff-topbar-label">Widok podglądu</div>
        <div class="qe-xlsx-diff-topbar-hint">Domyślnie: Lista</div>
    </div>`;
}

/**
 * Renderuje widok side by side pogrupowany po wierszach.
 *
 * @param {ReturnType<typeof groupDiffsByRow>} groups
 * @param {(value: unknown) => string} escapeHtml
 * @returns {string}
 */
function renderSideBySideView(groups, escapeHtml) {
    return groups.map((group) => `
        <section class="qe-xlsx-diff-group qe-xlsx-diff-group--side" aria-label="${escapeHtml(group.label)}">
            <header class="qe-xlsx-diff-group-header">
                <div>
                    <div class="qe-xlsx-diff-group-kicker">Porównanie</div>
                    <h3 class="qe-xlsx-diff-group-title">${escapeHtml(group.label)}</h3>
                </div>
                <div class="qe-xlsx-diff-group-meta">${escapeHtml(formatGroupCount(group.items.length))}</div>
            </header>
            <div class="qe-xlsx-diff-side-head">
                <div>Stara wartość</div>
                <div>Nowa wartość</div>
            </div>
            <div class="qe-xlsx-diff-side-list">
                ${group.items.map((item) => renderSideBySideRow(item, escapeHtml)).join('')}
            </div>
        </section>
    `).join('');
}

/**
 * Renderuje widok tabelaryczny jako fallback z poprawioną czytelnością.
 *
 * @param {ReturnType<typeof groupDiffsByRow>} groups
 * @param {(value: unknown) => string} escapeHtml
 * @returns {string}
 */
function renderListView(groups, escapeHtml) {
    const bodyHtml = groups.map((group) => `
        <tbody class="qe-xlsx-diff-table-group">
            <tr class="qe-xlsx-diff-table-group-row">
                <th colspan="5" scope="colgroup">${escapeHtml(group.label)}</th>
            </tr>
            ${group.items.map((item) => `
                <tr class="qe-xlsx-diff-row qe-xlsx-diff-row--${item.type}">
                    <td class="qe-xlsx-diff-col qe-xlsx-diff-col--column">${escapeHtml(item.columnHeader || '')}</td>
                    <td class="qe-xlsx-diff-col qe-xlsx-diff-col--address">${escapeHtml(item.address)}</td>
                    <td class="qe-xlsx-diff-col">${renderCellPreview(item.oldFormatted, escapeHtml)}</td>
                    <td class="qe-xlsx-diff-col">${renderCellPreview(item.newFormatted, escapeHtml)}</td>
                    <td class="qe-xlsx-diff-col qe-xlsx-diff-col--type"><span class="qe-xlsx-diff-badge qe-xlsx-diff-badge--${item.type}">${escapeHtml(formatChangeTypeLabel(item.type))}</span></td>
                </tr>
            `).join('')}
        </tbody>
    `).join('');

    return `<div class="qe-xlsx-diff-table-wrap qe-xlsx-diff-table-wrap--list">
        <table class="qe-xlsx-diff-table">
            <thead>
                <tr>
                    <th>Kolumna</th>
                    <th>Komórka</th>
                    <th>Stara wartość</th>
                    <th>Nowa wartość</th>
                    <th>Typ</th>
                </tr>
            </thead>
            ${bodyHtml}
        </table>
    </div>`;
}

/**
 * Renderuje pojedynczy wiersz w widoku side by side.
 *
 * @param {ReturnType<typeof prepareDiffItem>} item
 * @param {(value: unknown) => string} escapeHtml
 * @returns {string}
 */
function renderSideBySideRow(item, escapeHtml) {
    return `<div class="qe-xlsx-diff-side-row qe-xlsx-diff-side-row--${item.type}">
        <div class="qe-xlsx-diff-side-cell qe-xlsx-diff-side-cell--old${item.type === 'added' ? ' qe-xlsx-diff-side-cell--muted' : ''}">
            <div class="qe-xlsx-diff-side-meta">
                <span class="qe-xlsx-diff-entry-address">${escapeHtml(item.address)}</span>
            </div>
            ${renderCellPreview(item.oldFormatted, escapeHtml, item.type === 'added' ? 'Brak poprzedniej wartości' : '')}
        </div>
        <div class="qe-xlsx-diff-side-cell qe-xlsx-diff-side-cell--new${item.type === 'removed' ? ' qe-xlsx-diff-side-cell--muted' : ''}">
            <div class="qe-xlsx-diff-side-meta">
                <span class="qe-xlsx-diff-entry-address">${escapeHtml(item.address)}</span>
                <span class="qe-xlsx-diff-badge qe-xlsx-diff-badge--${item.type}">${escapeHtml(formatChangeTypeLabel(item.type))}</span>
            </div>
            ${renderCellPreview(item.newFormatted, escapeHtml, item.type === 'removed' ? 'Brak nowej wartości' : '')}
        </div>
    </div>`;
}

/**
 * Renderuje czytelną prezentację komórki z tooltipem dla surowej wartości.
 *
 * @param {ReturnType<typeof formatCellValue>} formatted
 * @param {(value: unknown) => string} escapeHtml
 * @param {string} [emptyLabel]
 * @returns {string}
 */
function renderCellPreview(formatted, escapeHtml, emptyLabel = '') {
    const previewText = formatted?.displayText || emptyLabel || 'Pusta wartość';
    const titleText = formatted?.raw || previewText;
    const emptyClass = formatted?.isEmpty ? ' qe-xlsx-diff-cell--empty' : '';
    return `<span class="qe-xlsx-diff-cell${emptyClass}" title="${escapeHtml(titleText)}">${escapeHtml(previewText)}</span>`;
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
 * Normalizuje wartość komórki do spójnej postaci porównawczej.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCellValue(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value).replaceAll('\u00A0', ' ');
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    return collapsed;
}

/**
 * Formatuje wartość komórki do czytelnej postaci dla UI diff.
 *
 * @param {unknown} value
 * @param {{
 *   address?: string,
 *   peerValue?: unknown,
 *   type?: 'added'|'removed'|'modified',
 *   side?: 'old'|'new'
 * }} [context]
 * @returns {{ raw: string, normalized: string, displayText: string, isEmpty: boolean }}
 */
function formatCellValue(value, context = {}) {
    const raw = value === null || value === undefined ? '' : String(value);
    const normalized = normalizeCellValue(raw);
    const timePreview = formatExcelTimeIfNeeded(normalized, context);
    const previewSource = timePreview || normalized;
    const preview = truncateText(previewSource || 'Pusta wartość', 180);
    return {
        raw,
        normalized,
        displayText: preview.text,
        isEmpty: !normalized
    };
}

/**
 * Parsuje adres komórki Excel do postaci strukturalnej.
 *
 * @param {unknown} cell
 * @returns {{ address: string, columnLabel: string, rowNumber: number | null, columnIndex: number | null }}
 */
function parseCellAddress(cell) {
    const address = String(cell || '').trim().toUpperCase();
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    if (!match) {
        return {
            address,
            columnLabel: '',
            rowNumber: null,
            columnIndex: null
        };
    }
    return {
        address,
        columnLabel: match[1],
        rowNumber: Number.parseInt(match[2], 10),
        columnIndex: decodeColumnLabel(match[1])
    };
}

/**
 * Grupuje zmiany po numerze wiersza Excela.
 *
 * @param {Array<ReturnType<typeof prepareDiffItem>>} items
 * @returns {Array<{ rowNumber: number, label: string, shortLabel: string, items: Array<ReturnType<typeof prepareDiffItem>> }>}
 */
function groupDiffsByRow(items) {
    const groups = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
        const rowNumber = Number(item?.rowNumber) || 0;
        if (!groups.has(rowNumber)) groups.set(rowNumber, []);
        groups.get(rowNumber).push(item);
    });

    return Array.from(groups.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([rowNumber, rowItems]) => ({
            rowNumber,
            label: `Wiersz ${rowNumber || '?'}`,
            shortLabel: String(rowNumber || '?'),
            items: rowItems.sort((left, right) => (left.columnIndex ?? Number.MAX_SAFE_INTEGER) - (right.columnIndex ?? Number.MAX_SAFE_INTEGER))
        }));
}

/**
 * Przygotowuje pojedynczy wpis diff do renderowania w różnych widokach.
 *
 * @param {any} change
 * @returns {{
 *   address: string,
 *   rowNumber: number,
 *   columnIndex: number | null,
 *   columnHeader: string,
 *   type: 'added'|'removed'|'modified',
 *   oldFormatted: ReturnType<typeof formatCellValue>,
 *   newFormatted: ReturnType<typeof formatCellValue>
 * } | null}
 */
function prepareDiffItem(change) {
    const fallbackAddress = buildFallbackAddress(change);
    const parsed = parseCellAddress(change?.address || fallbackAddress);
    const address = parsed.address || fallbackAddress;
    const oldFormatted = formatCellValue(change?.oldValue, {
        address,
        peerValue: change?.newValue,
        type: normalizeChangeType(change?.type),
        side: 'old'
    });
    const newFormatted = formatCellValue(change?.newValue, {
        address,
        peerValue: change?.oldValue,
        type: normalizeChangeType(change?.type),
        side: 'new'
    });

    if (oldFormatted.normalized === '' && newFormatted.normalized === '') return null;
    if (oldFormatted.normalized === newFormatted.normalized) return null;

    let type = normalizeChangeType(change?.type);
    if (!oldFormatted.normalized && newFormatted.normalized) type = 'added';
    else if (oldFormatted.normalized && !newFormatted.normalized) type = 'removed';
    else type = 'modified';

    return {
        address,
        rowNumber: parsed.rowNumber || Number(change?.rowIndex) + 1 || 0,
        columnIndex: parsed.columnIndex ?? (Number.isFinite(change?.colIndex) ? Number(change.colIndex) : null),
        columnHeader: String(change?.columnHeader || '').trim(),
        type,
        oldFormatted,
        newFormatted
    };
}

/**
 * Buduje podsumowanie na podstawie rzeczywiście widocznych zmian.
 *
 * @param {Array<ReturnType<typeof prepareDiffItem>>} items
 * @returns {{ cellsAdded: number, cellsRemoved: number, cellsModified: number }}
 */
function buildVisibleSummary(items) {
    return (Array.isArray(items) ? items : []).reduce((acc, item) => {
        if (item?.type === 'added') acc.cellsAdded += 1;
        else if (item?.type === 'removed') acc.cellsRemoved += 1;
        else acc.cellsModified += 1;
        return acc;
    }, {
        cellsAdded: 0,
        cellsRemoved: 0,
        cellsModified: 0
    });
}

/**
 * Formatuje licznik zmian w grupie wiersza.
 *
 * @param {number} count
 * @returns {string}
 */
function formatGroupCount(count) {
    const safeCount = Math.max(0, Number(count) || 0);
    if (safeCount === 1) return '1 zmiana';
    if (safeCount % 10 >= 2 && safeCount % 10 <= 4 && (safeCount % 100 < 10 || safeCount % 100 >= 20)) {
        return `${safeCount} zmiany`;
    }
    return `${safeCount} zmian`;
}

/**
 * Buduje awaryjny adres komórki, gdy diff nie zawiera poprawnego `A1`.
 *
 * @param {any} change
 * @returns {string}
 */
function buildFallbackAddress(change) {
    const rowIndex = Number.isFinite(change?.rowIndex) ? Number(change.rowIndex) : 0;
    const colIndex = Number.isFinite(change?.colIndex) ? Number(change.colIndex) : 0;
    return `${encodeColumnIndex(colIndex)}${rowIndex + 1}`;
}

/**
 * Dekoduje etykietę kolumny Excela do indeksu zero-based.
 *
 * @param {string} label
 * @returns {number | null}
 */
function decodeColumnLabel(label) {
    const safe = String(label || '').trim().toUpperCase();
    if (!safe) return null;
    let value = 0;
    for (let index = 0; index < safe.length; index += 1) {
        const code = safe.charCodeAt(index);
        if (code < 65 || code > 90) return null;
        value = (value * 26) + (code - 64);
    }
    return value - 1;
}

/**
 * Koduje indeks kolumny do etykiety Excela (`0 -> A`).
 *
 * @param {number} index
 * @returns {string}
 */
function encodeColumnIndex(index) {
    let value = Math.max(0, Number(index) || 0);
    let label = '';
    do {
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return label;
}

/**
 * Formatuje liczbę z Excela jako godzinę, gdy kontekst sugeruje wartość czasu.
 *
 * @param {string} normalized
 * @param {{ address?: string, peerValue?: unknown }} context
 * @returns {string}
 */
function formatExcelTimeIfNeeded(normalized, context = {}) {
    if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return '';
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric >= 1) return '';
    if (!shouldInterpretAsTime(normalized, context)) return '';

    const totalMinutes = Math.round(numeric * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = Math.abs(totalMinutes % 60);
    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Określa, czy liczba z Excela powinna zostać pokazana jako godzina.
 *
 * @param {string} normalized
 * @param {{ address?: string, peerValue?: unknown }} context
 * @returns {boolean}
 */
function shouldInterpretAsTime(normalized, context = {}) {
    const peerValue = normalizeCellValue(context?.peerValue);
    const address = String(context?.address || '').toLowerCase();
    if (looksLikeTime(peerValue)) return true;
    if (looksLikeExcelTimeSerial(peerValue)) return true;
    if (/\b(czas|godz|hour|time|min)\b/.test(address)) return true;
    if (looksLikeExcelTimeSerial(normalized)) return true;
    return false;
}

/**
 * Sprawdza, czy tekst przypomina wartość godziny.
 *
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeTime(value) {
    return /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:AM|PM))?$/i.test(String(value || '').trim());
}

/**
 * Sprawdza, czy liczba wygląda jak excelowy zapis czasu jako ułamek doby.
 *
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeExcelTimeSerial(value) {
    const normalized = normalizeCellValue(value);
    if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return false;

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric >= 1) return false;

    const totalMinutes = numeric * 24 * 60;
    const roundedMinutes = Math.round(totalMinutes);
    const isMinutePrecise = Math.abs(totalMinutes - roundedMinutes) < 1e-7;
    if (!isMinutePrecise) return false;

    const fractionalDigits = (normalized.split('.')[1] || '').length;
    const hasSerialPrecision = fractionalDigits >= 6;
    const isQuarterHour = roundedMinutes % 15 === 0;
    const isFiveMinuteStep = roundedMinutes % 5 === 0;

    return hasSerialPrecision || isQuarterHour || isFiveMinuteStep;
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
