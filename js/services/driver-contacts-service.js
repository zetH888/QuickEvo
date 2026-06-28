import { buildNormalizedDriverLookupKey, fuzzyNormalizeText, normalizeDriverDisplayName } from '../core/utils.js';

/**
 * @module driver-contacts-service
 *
 * @description
 * Serwis odpowiedzialny za wczytywanie i indeksowanie kontaktów kierowców
 * z osobnego pliku arkusza synchronizowanego z Google Drive.
 *
 * Źródłem prawdy są kolumny:
 * - B: `PRACOWNIK`
 * - C: `NR TELEFONU`
 * - D: dopisek roli/notatki (opcjonalny)
 *
 * Serwis:
 * - parsuje pierwszy arkusz pliku,
 * - znajduje wiersz nagłówka po kolumnach B/C,
 * - buduje indeks kontaktów po wielu bezpiecznych wariantach nazwy kierowcy,
 * - obsługuje wiele numerów telefonu przypisanych do jednej osoby,
 * - dopasowuje także odwróconą kolejność członów nazwy (np. `Imię Nazwisko` <-> `Nazwisko Imię`),
 * - klasyfikuje kontakty specjalne po słowach kluczowych: `szef`, `kierownik`, `koordynator`, `dyspozytor`.
 *
 * @param {{
 *   listFiles: (() => Promise<any[]>) | null,
 *   getBlob: ((fileName: string) => Promise<Blob|null>) | null,
 *   readWorkbook: ((source: any, fileName: string) => Promise<any>) | null,
 *   sheetToMatrix: ((worksheet: any) => any[][]) | null,
 *   logAction?: ((scope: string, payload?: any, level?: string) => void) | null
 * }} cfg
 * @returns {{
 *   loadDriverContactsFiles: (opts?: { fullReload?: boolean }) => Promise<void>,
 *   processDriverContactsFile: (fileName: string) => Promise<void>,
 *   invalidateDriverContactsFile: (fileName: string) => void,
 *   getContactForDriverName: (driverName: string) => ({ driverName: string, lookupKeys: string[], matchedKeys: string[], phones: Array<{ phoneDisplay: string, phoneHref: string, sourceFileName: string, sourceDriverName: string, roleCategory: string, roleNote: string }>, roleCategory: string, roleNote: string } | null),
 *   getContactsByRole: (roleCategory: string) => Array<{ driverName: string, lookupKeys: string[], phones: Array<{ phoneDisplay: string, phoneHref: string, sourceFileName: string, sourceDriverName: string, roleCategory: string, roleNote: string }>, roleCategory: string, roleNote: string }>,
 *   buildDriverLookupKey: (value: unknown) => string,
 *   buildDriverLookupKeys: (value: unknown) => string[],
 *   clearCache: () => void
 * }}
 */
export function createDriverContactsService(cfg = {}) {
    const SOURCE_KIND = 'driver_contacts';
    const ROLE_CATEGORIES = Object.freeze(['szef', 'kierownik', 'koordynator', 'dyspozytor']);

    /** @type {Map<string, Map<string, { phoneDisplay: string, phoneHref: string, sourceFileName: string, sourceDriverName: string, roleCategory: string, roleNote: string }>>} */
    let contactsByLookupKey = new Map();

    /** @type {Map<string, { driverName: string, lookupKeys: string[], phonesByIdentity: Map<string, { phoneDisplay: string, phoneHref: string, sourceFileName: string, sourceDriverName: string, roleCategory: string, roleNote: string }>, roleCategory: string, roleNote: string }>} */
    let contactsByCanonicalName = new Map();

    /** @type {Set<string>} */
    let loadedDriverContactFiles = new Set();

    /**
     * Buduje klucz porównawczy kierowcy odporny na diakrytyki, wielkość liter
     * oraz niestandardowe separatory.
     *
     * @param {unknown} value
     * @returns {string}
     */
    function buildDriverLookupKey(value) {
        return buildNormalizedDriverLookupKey(value);
    }

    /**
     * Generuje bezpieczne warianty kluczy dopasowania dla tej samej osoby.
     *
     * @param {unknown} value
     * @returns {string[]}
     */
    function buildDriverLookupKeys(value) {
        const baseKey = buildDriverLookupKey(value);
        if (!baseKey) return [];

        const tokens = baseKey.split(' ').map((token) => token.trim()).filter(Boolean);
        if (tokens.length <= 1) return [baseKey];

        const variants = new Set([baseKey, tokens.slice().reverse().join(' ')]);

        const permute = (arr, startIndex) => {
            if (startIndex >= arr.length - 1) {
                variants.add(arr.join(' '));
                return;
            }

            const usedAtDepth = new Set();
            for (let i = startIndex; i < arr.length; i += 1) {
                const token = arr[i];
                if (usedAtDepth.has(token)) continue;
                usedAtDepth.add(token);
                [arr[startIndex], arr[i]] = [arr[i], arr[startIndex]];
                permute(arr, startIndex + 1);
                [arr[startIndex], arr[i]] = [arr[i], arr[startIndex]];
            }
        };

        if (tokens.length <= 4) permute(tokens.slice(), 0);
        return Array.from(variants).filter(Boolean);
    }

    /**
     * Normalizuje numer telefonu do postaci czytelnej dla UI.
     *
     * @param {unknown} value
     * @returns {string}
     */
    function normalizePhoneDisplay(value) {
        const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        return raw.replace(/\.0+$/g, '');
    }

    /**
     * Normalizuje dopisek roli/notatki.
     *
     * @param {unknown} value
     * @returns {string}
     */
    function normalizeRoleNote(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Buduje numer do atrybutu `tel:`.
     *
     * @param {string} phoneDisplay
     * @returns {string}
     */
    function buildPhoneHref(phoneDisplay) {
        const normalized = String(phoneDisplay ?? '')
            .replace(/[^\d+]/g, '')
            .replace(/(?!^)\+/g, '');
        return normalized ? `tel:${normalized}` : '';
    }

    /**
     * Klasyfikuje kategorię roli z kolumny D.
     *
     * @param {unknown} value
     * @returns {string}
     */
    function classifyRoleCategory(value) {
        const note = fuzzyNormalizeText(value);
        if (!note) return '';
        if (note.includes('szef')) return 'szef';
        if (note.includes('kierownik')) return 'kierownik';
        if (note.includes('koordynator')) return 'koordynator';
        if (note.includes('dyspozytor')) return 'dyspozytor';
        return '';
    }

    /**
     * Sprawdza, czy wiersz zawiera nagłówki wymagane przez parser kontaktów.
     *
     * @param {any[]} row
     * @returns {boolean}
     */
    function isDriverContactsHeaderRow(row) {
        const safeRow = Array.isArray(row) ? row : [];
        const employeeHeader = fuzzyNormalizeText(safeRow[1]);
        const phoneHeader = fuzzyNormalizeText(safeRow[2]);
        return employeeHeader === 'pracownik' && phoneHeader === 'nr telefonu';
    }

    /**
     * Znajduje indeks wiersza nagłówka w macierzy.
     *
     * @param {any[][]} matrix
     * @returns {number}
     */
    function findDriverContactsHeaderRowIndex(matrix) {
        const rows = Array.isArray(matrix) ? matrix : [];
        for (let i = 0; i < rows.length; i += 1) {
            if (isDriverContactsHeaderRow(rows[i])) return i;
        }
        return -1;
    }

    /**
     * Czyści cały cache kontaktów.
     *
     * @returns {void}
     */
    function clearCache() {
        contactsByLookupKey = new Map();
        contactsByCanonicalName = new Map();
        loadedDriverContactFiles = new Set();
    }

    /**
     * Dodaje lub aktualizuje kontakt w indeksie.
     *
     * @param {{ driverName: string, lookupKeys: string[], phoneDisplay: string, phoneHref: string, sourceFileName: string, roleCategory?: string, roleNote?: string }} entry
     * @returns {void}
     */
    function upsertContact(entry) {
        const lookupKeys = Array.isArray(entry?.lookupKeys) ? entry.lookupKeys.map((key) => String(key ?? '').trim()).filter(Boolean) : [];
        const nextPhone = String(entry?.phoneDisplay ?? '').trim();
        if (lookupKeys.length === 0 || !nextPhone) return;

        const roleCategory = String(entry?.roleCategory ?? '').trim();
        const roleNote = normalizeRoleNote(entry?.roleNote);
        const canonicalKey = lookupKeys.slice().sort().join('||');
        if (!canonicalKey) return;

        const nextEntry = Object.freeze({
            phoneDisplay: nextPhone,
            phoneHref: String(entry?.phoneHref ?? '').trim(),
            sourceFileName: String(entry?.sourceFileName ?? '').trim(),
            sourceDriverName: String(entry?.driverName ?? '').trim(),
            roleCategory,
            roleNote
        });

        if (!contactsByCanonicalName.has(canonicalKey)) {
            contactsByCanonicalName.set(canonicalKey, {
                driverName: String(entry?.driverName ?? '').trim(),
                lookupKeys: lookupKeys.slice(),
                phonesByIdentity: new Map(),
                roleCategory,
                roleNote
            });
        }

        const canonicalEntry = contactsByCanonicalName.get(canonicalKey);
        if (canonicalEntry) {
            const phoneIdentity = `${nextEntry.phoneDisplay}::${nextEntry.phoneHref}`;
            if (!canonicalEntry.phonesByIdentity.has(phoneIdentity)) {
                canonicalEntry.phonesByIdentity.set(phoneIdentity, nextEntry);
            }
            if (!canonicalEntry.roleCategory && roleCategory) canonicalEntry.roleCategory = roleCategory;
            if (!canonicalEntry.roleNote && roleNote) canonicalEntry.roleNote = roleNote;
        }

        for (const lookupKey of lookupKeys) {
            if (!contactsByLookupKey.has(lookupKey)) contactsByLookupKey.set(lookupKey, new Map());
            const bucket = contactsByLookupKey.get(lookupKey);
            if (!(bucket instanceof Map)) continue;
            const phoneIdentity = `${nextEntry.phoneDisplay}::${nextEntry.phoneHref}`;
            if (!bucket.has(phoneIdentity)) bucket.set(phoneIdentity, nextEntry);
        }
    }

    /**
     * Parsuje skoroszyt kontaktów kierowców.
     *
     * @param {any} source
     * @param {string} fileName
     * @returns {Promise<void>}
     */
    async function parseDriverContactsSpreadsheet(source, fileName) {
        const safeFileName = String(fileName ?? '').trim();
        if (!safeFileName) throw new Error('Brak nazwy pliku kontaktów kierowców.');
        if (typeof cfg.readWorkbook !== 'function' || typeof cfg.sheetToMatrix !== 'function') {
            throw new Error('Brak zależności readWorkbook/sheetToMatrix w driver-contacts-service.');
        }

        const workbook = await cfg.readWorkbook(source, safeFileName);
        const firstSheetName = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames[0] : '';
        if (!firstSheetName) throw new Error('Plik kontaktów nie zawiera arkusza.');

        const worksheet = workbook?.Sheets?.[firstSheetName];
        const matrix = cfg.sheetToMatrix(worksheet);
        const headerRowIndex = findDriverContactsHeaderRowIndex(matrix);
        if (headerRowIndex < 0) {
            throw new Error('Nie znaleziono nagłówków kontaktów w kolumnach B/C: PRACOWNIK, NR TELEFONU.');
        }

        for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
            const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
            const driverName = normalizeDriverDisplayName(row[1]);
            const phoneDisplay = normalizePhoneDisplay(row[2]);
            const roleNote = normalizeRoleNote(row[3]);

            if (!driverName && !phoneDisplay) continue;
            if (!driverName) continue;

            const lookupKeys = buildDriverLookupKeys(driverName);
            if (lookupKeys.length === 0) continue;

            upsertContact({
                driverName,
                lookupKeys,
                phoneDisplay,
                phoneHref: buildPhoneHref(phoneDisplay),
                sourceFileName: safeFileName,
                roleCategory: classifyRoleCategory(roleNote),
                roleNote
            });
        }

        loadedDriverContactFiles.add(safeFileName);
    }

    /**
     * Przetwarza jeden plik kontaktów zapisany lokalnie w IndexedDB.
     *
     * @param {string} fileName
     * @returns {Promise<void>}
     */
    async function processDriverContactsFile(fileName) {
        const safeFileName = String(fileName ?? '').trim();
        if (!safeFileName) return;
        if (typeof cfg.getBlob !== 'function') throw new Error('Brak getBlob w driver-contacts-service.');

        const blob = await cfg.getBlob(safeFileName);
        if (!blob) throw new Error('Nie można odczytać pliku kontaktów z bazy.');

        await parseDriverContactsSpreadsheet(blob, safeFileName);
    }

    /**
     * Ładuje wszystkie lokalne pliki oznaczone jako źródło kontaktów kierowców.
     *
     * @param {{ fullReload?: boolean }} [opts]
     * @returns {Promise<void>}
     */
    async function loadDriverContactsFiles({ fullReload = false } = {}) {
        if (fullReload) clearCache();
        if (typeof cfg.listFiles !== 'function') return;

        const list = await cfg.listFiles();
        const files = Array.isArray(list)
            ? list.filter((file) => String(file?.sourceKind ?? '').trim() === SOURCE_KIND)
            : [];

        for (const file of files) {
            const fileName = String(file?.name ?? '').trim();
            if (!fileName) continue;
            if (!fullReload && loadedDriverContactFiles.has(fileName)) continue;
            try {
                await processDriverContactsFile(fileName);
            } catch (err) {
                try {
                    cfg.logAction?.('driver_contacts', {
                        phase: 'process_error',
                        fileName,
                        message: err?.message ? String(err.message) : 'Błąd przetwarzania kontaktów kierowców'
                    }, 'WARN');
                } catch { }
            }
        }
    }

    /**
     * Unieważnia cache kontaktów po zmianie/usunięciu pliku.
     *
     * @param {string} _fileName
     * @returns {void}
     */
    function invalidateDriverContactsFile(_fileName) {
        clearCache();
    }

    /**
     * Zwraca wszystkie kontakty dopasowane do nazwy kierowcy z grafiku.
     *
     * @param {string} driverName
     * @returns {{ driverName: string, lookupKeys: string[], matchedKeys: string[], phones: Array<{ phoneDisplay: string, phoneHref: string, sourceFileName: string, sourceDriverName: string, roleCategory: string, roleNote: string }>, roleCategory: string, roleNote: string } | null}
     */
    function getContactForDriverName(driverName) {
        const lookupKeys = buildDriverLookupKeys(driverName);
        if (lookupKeys.length === 0) return null;

        const matchedKeys = [];
        const phonesByIdentity = new Map();
        for (const lookupKey of lookupKeys) {
            const bucket = contactsByLookupKey.get(lookupKey);
            if (!(bucket instanceof Map) || bucket.size === 0) continue;
            matchedKeys.push(lookupKey);
            for (const [phoneIdentity, phoneEntry] of bucket.entries()) {
                if (!phonesByIdentity.has(phoneIdentity)) phonesByIdentity.set(phoneIdentity, phoneEntry);
            }
        }

        if (phonesByIdentity.size === 0) return null;

        const phones = Array.from(phonesByIdentity.values()).sort((a, b) => {
            const byPhone = String(a?.phoneDisplay ?? '').localeCompare(String(b?.phoneDisplay ?? ''), 'pl', { sensitivity: 'base' });
            if (byPhone !== 0) return byPhone;
            return String(a?.sourceDriverName ?? '').localeCompare(String(b?.sourceDriverName ?? ''), 'pl', { sensitivity: 'base' });
        });

        return Object.freeze({
            driverName: normalizeDriverDisplayName(driverName),
            lookupKeys,
            matchedKeys,
            phones,
            roleCategory: String(phones[0]?.roleCategory ?? '').trim(),
            roleNote: String(phones[0]?.roleNote ?? '').trim()
        });
    }

    /**
     * Zwraca listę kontaktów specjalnych przypisanych do wskazanej kategorii roli.
     *
     * @param {string} roleCategory
     * @returns {Array<{ driverName: string, lookupKeys: string[], phones: Array<{ phoneDisplay: string, phoneHref: string, sourceFileName: string, sourceDriverName: string, roleCategory: string, roleNote: string }>, roleCategory: string, roleNote: string }>}
     */
    function getContactsByRole(roleCategory) {
        const targetRole = String(roleCategory ?? '').trim().toLowerCase();
        if (!ROLE_CATEGORIES.includes(targetRole)) return [];

        const items = [];
        for (const entry of contactsByCanonicalName.values()) {
            if (String(entry?.roleCategory ?? '').trim() !== targetRole) continue;
            const phones = Array.from(entry?.phonesByIdentity?.values?.() ?? []).sort((a, b) => {
                const byPhone = String(a?.phoneDisplay ?? '').localeCompare(String(b?.phoneDisplay ?? ''), 'pl', { sensitivity: 'base' });
                if (byPhone !== 0) return byPhone;
                return String(a?.sourceDriverName ?? '').localeCompare(String(b?.sourceDriverName ?? ''), 'pl', { sensitivity: 'base' });
            });
            if (phones.length === 0) continue;
            items.push(Object.freeze({
                driverName: String(entry?.driverName ?? '').trim(),
                lookupKeys: Array.isArray(entry?.lookupKeys) ? entry.lookupKeys.slice() : [],
                phones,
                roleCategory: targetRole,
                roleNote: String(entry?.roleNote ?? '').trim()
            }));
        }

        items.sort((a, b) => String(a?.driverName ?? '').localeCompare(String(b?.driverName ?? ''), 'pl', { sensitivity: 'base' }));
        return items;
    }

    return {
        loadDriverContactsFiles,
        processDriverContactsFile,
        invalidateDriverContactsFile,
        getContactForDriverName,
        getContactsByRole,
        buildDriverLookupKey,
        buildDriverLookupKeys,
        clearCache
    };
}
