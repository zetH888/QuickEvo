import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
import { getArrayBufferFromSource } from './excel-processor.js';

/**
 * Buduje prosty diff XLSX dla pierwszego arkusza, porównując komórki po indeksach
 * wiersza i kolumny. Moduł celowo nie obsługuje wielu arkuszy, stylów ani formuł.
 *
 * @param {{
 *   fileName?: string,
 *   oldSource: Blob|ArrayBuffer|ArrayBufferView|{ arrayBuffer: Function },
 *   newSource: Blob|ArrayBuffer|ArrayBufferView|{ arrayBuffer: Function }
 * }} input
 * @returns {Promise<{
 *   fileName: string,
 *   hasChanges: boolean,
 *   message: string,
 *   summary: {
 *     cellsAdded: number,
 *     cellsRemoved: number,
 *     cellsModified: number
 *   },
 *   changes: Array<{
 *     address: string,
 *     rowIndex: number,
 *     colIndex: number,
 *     type: 'added'|'removed'|'modified',
 *     oldValue: string,
 *     newValue: string
 *   }>
 * }>}
 */
export async function buildSimpleXlsxDiff(input) {
    const fileName = String(input?.fileName || '').trim();
    const oldMatrix = await readFirstSheetMatrix(input?.oldSource, fileName);
    const newMatrix = await readFirstSheetMatrix(input?.newSource, fileName);
    const maxRows = Math.max(oldMatrix.length, newMatrix.length);
    const summary = {
        cellsAdded: 0,
        cellsRemoved: 0,
        cellsModified: 0
    };
    const changes = [];

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
        const oldRow = Array.isArray(oldMatrix[rowIndex]) ? oldMatrix[rowIndex] : [];
        const newRow = Array.isArray(newMatrix[rowIndex]) ? newMatrix[rowIndex] : [];
        const maxCols = Math.max(oldRow.length, newRow.length);

        for (let colIndex = 0; colIndex < maxCols; colIndex += 1) {
            const oldValue = normalizeCellValue(oldRow[colIndex]);
            const newValue = normalizeCellValue(newRow[colIndex]);

            if (oldValue === '' && newValue === '') continue;
            if (oldValue === newValue) continue;

            let type = 'modified';
            if (oldValue === '' && newValue !== '') type = 'added';
            else if (oldValue !== '' && newValue === '') type = 'removed';

            if (type === 'added') summary.cellsAdded += 1;
            else if (type === 'removed') summary.cellsRemoved += 1;
            else summary.cellsModified += 1;

            changes.push({
                address: XLSX.utils.encode_cell({ r: rowIndex, c: colIndex }),
                rowIndex,
                colIndex,
                type,
                oldValue,
                newValue
            });
        }
    }

    const hasChanges = changes.length > 0;
    return {
        fileName,
        hasChanges,
        message: hasChanges
            ? ''
            : 'Timestamp pliku zmienił się na Google Drive, ale nie wykryto zmian w zawartości arkusza.',
        summary,
        changes
    };
}

/**
 * Odczytuje pierwszy arkusz i normalizuje go do postaci macierzy 2D.
 *
 * @param {unknown} source
 * @param {string} fileName
 * @returns {Promise<string[][]>}
 */
async function readFirstSheetMatrix(source, fileName) {
    const buffer = await getArrayBufferFromSource(source);
    const workbook = XLSX.read(buffer);
    const firstSheetName = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames[0] : '';
    if (!firstSheetName) {
        throw new Error(`Plik "${fileName || 'bez nazwy'}" nie zawiera arkusza do porównania.`);
    }
    const sheet = workbook?.Sheets?.[firstSheetName];
    if (!sheet) {
        throw new Error(`Nie udało się odczytać pierwszego arkusza pliku "${fileName || 'bez nazwy'}".`);
    }
    const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: true,
        defval: ''
    });
    return normalizeMatrix(matrix);
}

/**
 * Normalizuje wartości komórek do porównywalnej postaci tekstowej.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCellValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return String(value);
}

/**
 * Zapewnia prostokątną macierz, aby możliwe było porównanie po indeksach.
 *
 * @param {unknown[][]} matrix
 * @returns {string[][]}
 */
function normalizeMatrix(matrix) {
    const safeMatrix = Array.isArray(matrix) ? matrix : [];
    const maxCols = safeMatrix.reduce((acc, row) => Math.max(acc, Array.isArray(row) ? row.length : 0), 0);
    return safeMatrix.map((row) => {
        const normalizedRow = Array.isArray(row) ? row.map(normalizeCellValue) : [];
        while (normalizedRow.length < maxCols) normalizedRow.push('');
        return normalizedRow;
    });
}
