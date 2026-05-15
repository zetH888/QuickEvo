/**
 * @module excel-processor
 *
 * @description
 * Moduł odpowiedzialny za przetwarzanie plików Excel/CSV (SheetJS/XLSX) do ustandaryzowanego modelu tabeli QuickEvo.
 * Jest to logika bezstanowa: moduł nie manipuluje DOM, nie dotyka IndexedDB i nie modyfikuje stanu aplikacji.
 *
 * Moduł jest zaprojektowany tak, aby mógł być użyty zarówno w standardowym imporcie danych (lokalny/dysk/Drive),
 * jak i w mechanizmach podglądu oraz diff.
 *
 * @zaleznosci
 * - utils.js — normalizacja i formatowanie wartości komórek (czas Excela).
 *
 * @wymaganiaSrodowiskowe
 * - Wymaga dostępu do modułu ESM SheetJS/XLSX.
 *
 * @publicznyInterfejs
 * - readWorkbook — odczyt skoroszytu z ArrayBuffer/Blob/File/string (CSV).
 * - getArrayBufferFromSource — normalizacja wejścia do ArrayBuffer.
 * - parseTableModelFromSource — source -> workbook -> matrix -> tableModel.
 * - buildTableModel — matrix -> tableModel.
 * - normalizeMatrix — wyrównanie macierzy do prostokąta.
 */

import { fuzzyNormalizeText, formatCellValue, parseTimeString } from './utils.js';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

/**
 * Odczytuje skoroszyt z różnych źródeł danych.
 * CSV jest czytany jako string, natomiast XLS/XLSX jako ArrayBuffer.
 *
 * @param {ArrayBuffer|ArrayBufferView|Blob|File|string|{arrayBuffer:Function,text?:Function}} source
 * @param {string} fileName
 * @returns {Promise<any>} Workbook SheetJS
 */
export async function readWorkbook(source, fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.csv')) {
        const csvContent = typeof source === 'string'
            ? source
            : (source && typeof source.text === 'function' ? await source.text() : '');
        return XLSX.read(csvContent, { type: 'string' });
    }
    const buffer = await getArrayBufferFromSource(source);
    return XLSX.read(buffer);
}

/**
 * Konwertuje różne typy wejścia na ArrayBuffer.
 *
 * @param {any} source
 * @returns {Promise<ArrayBuffer>}
 */
export async function getArrayBufferFromSource(source) {
    if (source instanceof ArrayBuffer) return source;
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    if (source && typeof source.arrayBuffer === 'function') return await source.arrayBuffer();
    throw new Error('Nieprawidłowe dane wejściowe do parsowania');
}

/**
 * Zwraca model tabeli bezpośrednio ze źródła danych.
 *
 * @param {any} source
 * @param {string} fileName
 * @returns {Promise<ReturnType<typeof buildTableModel>>}
 */
export async function parseTableModelFromSource(source, fileName) {
    const workbook = await readWorkbook(source, fileName);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const matrix = sheetToMatrix(worksheet);
    return buildTableModel(matrix);
}

export function sheetToMatrix(worksheet) {
    return XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true, defval: '' });
}

/**
 * Buduje model tabeli z surowej macierzy danych.
 *
 * @param {any[][]} matrix
 * @returns {{ headers: string[], rows: Array<{ originalRowIndex: number, cells: any[] }>, metaLines: string[], isCompleteStructure: boolean, headerMap?: Record<string, number> }}
 */
export function buildTableModel(matrix) {
    const rect = normalizeMatrix(matrix);
    const bounds = computeNonEmptyBounds(rect);
    if (!bounds) return { headers: [], rows: [], metaLines: [], isCompleteStructure: false };
    const cropped = rect.slice(bounds.minRow, bounds.maxRow + 1).map(row => row.slice(bounds.minCol, bounds.maxCol + 1));
    const headerRowRel = findHeaderRowIndex(cropped);
    const rawHeaders = cropped[headerRowRel].map(cellToHeaderText);
    const headerMap = mapRequiredHeaders(rawHeaders);
    const isCompleteStructure = Object.keys(headerMap).length === 5;
    const metaLines = extractMetaLines(cropped, headerRowRel);
    const dataRelRows = cropped.slice(headerRowRel + 1);
    const rawDataRows = processDataRows(dataRelRows, headerMap, bounds.minRow + headerRowRel + 1);
    return { headers: rawHeaders, rows: rawDataRows, metaLines, isCompleteStructure, headerMap };
}

/**
 * Normalizuje macierz danych do prostokąta.
 *
 * @param {any[][]} matrix
 * @returns {any[][]}
 */
export function normalizeMatrix(matrix) {
    const safe = Array.isArray(matrix) ? matrix : [];
    const maxCols = safe.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
    return safe.map((row) => {
        const r = Array.isArray(row) ? row.slice() : [];
        while (r.length < maxCols) r.push('');
        return r;
    });
}

/**
 * Konwertuje wartość komórki na tekst nagłówka.
 *
 * @param {any} cell
 * @returns {string}
 */
function cellToHeaderText(cell) {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') return cell.trim();
    return parseTimeString(String(cell)) || String(cell).trim();
}

/**
 * Mapuje wymagane nagłówki na ich indeksy w tabeli.
 *
 * @param {string[]} rawHeaders
 * @returns {Record<string, number>}
 */
function mapRequiredHeaders(rawHeaders) {
    const requiredHeaders = {
        'NR_POL': ['NR. PÓŁ', 'NR PÓŁ', 'NR. POL', 'NR POL', 'PÓŁKA', 'POLKA', 'NR'],
        'GODZ': ['GODZ', 'GODZINA', 'GODZ.'],
        'ADRES': ['ADRES', 'ULICA'],
        'NAZWA_PLACOWKI': ['NAZWA PLACÓWKI', 'PLACÓWKA', 'PLACOWKA', 'NAZWA'],
        'UWAGI': ['UWAGI']
    };
    const headerMap = {};
    Object.entries(requiredHeaders).forEach(([key, aliases]) => {
        const index = rawHeaders.findIndex(h => {
            const normH = fuzzyNormalizeText(h).toUpperCase();
            return aliases.some(alias => fuzzyNormalizeText(alias).toUpperCase() === normH);
        });
        if (index >= 0) headerMap[key] = index;
    });
    return headerMap;
}

/**
 * Wyodrębnia linie metadanych znajdujące się nad nagłówkiem.
 *
 * @param {any[][]} cropped
 * @param {number} headerRowRel
 * @returns {string[]}
 */
function extractMetaLines(cropped, headerRowRel) {
    const metaLines = [];
    for (let r = 0; r < headerRowRel; r++) {
        const parts = cropped[r].filter(v => !isEmptyCell(v)).map(v => String(formatCellValue(v)).trim()).filter(v => v.length > 0);
        if (parts.length > 0) metaLines.push(parts.join(' | '));
    }
    return metaLines;
}

/**
 * Przetwarza wiersze danych.
 *
 * @param {any[][]} dataRelRows
 * @param {Record<string, number>} headerMap
 * @param {number} startRowIndex
 * @returns {Array<{ originalRowIndex: number, cells: any[] }>}
 */
function processDataRows(dataRelRows, headerMap, startRowIndex) {
    const rawDataRows = [];
    for (let r = 0; r < dataRelRows.length; r++) {
        const row = dataRelRows[r];
        if (row.every(isEmptyCell)) continue;
        const cleanedCells = row.map((cell, idx) => formatCellContent(cell, idx, headerMap));
        rawDataRows.push({ originalRowIndex: startRowIndex + r, cells: cleanedCells });
    }
    return rawDataRows;
}

/**
 * Formatuje zawartość komórki zgodnie z jej typem i znaczeniem kolumny.
 *
 * @param {any} cell
 * @param {number} idx
 * @param {Record<string, number>} headerMap
 * @returns {any}
 */
function formatCellContent(cell, idx, headerMap) {
    if (idx === headerMap['NR_POL']) {
        const val = parseInt(cell);
        return isNaN(val) ? '' : val;
    }
    const formatted = formatCellValue(cell);
    if (idx === headerMap['GODZ']) return (formatted === '' || formatted === '-') ? '-' : formatted;
    return formatted;
}

/**
 * Oblicza granice niepustych komórek w macierzy.
 *
 * @param {any[][]} matrix
 * @returns {{ minRow: number, maxRow: number, minCol: number, maxCol: number } | null}
 */
function computeNonEmptyBounds(matrix) {
    let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
    for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r];
        for (let c = 0; c < row.length; c++) {
            if (!isEmptyCell(row[c])) {
                if (r < minRow) minRow = r;
                if (r > maxRow) maxRow = r;
                if (c < minCol) minCol = c;
                if (c > maxCol) maxCol = c;
            }
        }
    }
    return maxRow === -1 ? null : { minRow, maxRow, minCol, maxCol };
}

/**
 * Znajduje indeks wiersza nagłówkowego.
 *
 * @param {any[][]} cropped
 * @returns {number}
 */
function findHeaderRowIndex(cropped) {
    const counts = cropped.map(countNonEmpty);
    for (let i = 0; i < cropped.length; i++) {
        if (counts[i] < 2) continue;
        if (counts.slice(i + 1).some(c => c >= 2)) return i;
    }
    return 0;
}

/**
 * Liczy niepuste komórki w wierszu.
 *
 * @param {any[]} row
 * @returns {number}
 */
function countNonEmpty(row) {
    if (!Array.isArray(row)) return 0;
    let n = 0;
    for (const cell of row) if (!isEmptyCell(cell)) n += 1;
    return n;
}

/**
 * Sprawdza, czy komórka jest pusta.
 *
 * @param {any} cell
 * @returns {boolean}
 */
function isEmptyCell(cell) {
    return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
}
