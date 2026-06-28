/**
 * @module utils
 *
 * @description
 * Moduł narzędziowy współdzielony między pozostałymi częściami aplikacji QuickEvo.
 * Zawiera wyłącznie logikę niezależną od DOM (funkcje czyste i małe klasy pomocnicze),
 * dzięki czemu może być bezpiecznie importowany przez inne moduły bez efektów ubocznych.
 *
 * @zaleznosci
 * Brak (moduł nie importuje innych modułów aplikacji).
 *
 * @publicznyInterfejs
 * - LRUCache — prosty cache LRU oparty o Map.
 * - normalizeText / fuzzyNormalizeText — normalizacja tekstu do wyszukiwania.
 * - formatCellValue / parseTimeString / formatTimeFromDayFraction — formatowanie wartości z Excela.
 * - escapeHtml — minimalna ochrona przed XSS podczas budowania HTML.
 * - debounce — opóźnianie wywołań funkcji w czasie (np. input).
 * - clampNumber / parseCssNumber — bezpieczne operacje na liczbach.
 */
 
/**
 * Implementacja prostego cache'u LRU (Least Recently Used).
 *
 * @template K,V
 */
export class LRUCache {
    /**
     * @param {number} [limit=100] Maksymalna liczba wpisów w cache.
     */
    constructor(limit = 100) {
        /** @type {number} */
        this.limit = limit;
        /** @type {Map<K, V>} */
        this.cache = new Map();
    }
 
    /**
     * Pobiera wartość dla klucza i oznacza wpis jako ostatnio użyty.
     *
     * @param {K} key
     * @returns {V | undefined}
     */
    get(key) {
        if (!this.cache.has(key)) return undefined;
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }
 
    /**
     * Ustawia wartość dla klucza, pilnując limitu.
     *
     * @param {K} key
     * @param {V} value
     */
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.limit) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, value);
    }
 
    /**
     * @param {K} key
     * @returns {boolean}
     */
    has(key) { return this.cache.has(key); }
 
    /**
     * Czyści całą zawartość cache.
     */
    clear() { this.cache.clear(); }
}
 
/**
 * Bezpiecznie ogranicza liczbę do przedziału [min, max].
 *
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampNumber(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}
 
/**
 * Normalizuje tekst do postaci:
 * - string,
 * - małe litery,
 * - bez spacji na początku i końcu.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeText(text) {
    return String(text ?? '').toLowerCase().trim();
}
 
/**
 * Normalizuje tekst usuwając polskie znaki diakrytyczne.
 * Wykorzystywane m.in. do wyszukiwania rozmytego oraz predykcji.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function fuzzyNormalizeText(text) {
    return normalizeText(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
}

/**
 * Formatuje pojedynczy człon nazwy własnej do postaci prezentacyjnej.
 *
 * @param {string} token
 * @returns {string}
 */
function formatNameToken(token) {
    const safeToken = String(token ?? '').trim();
    if (!safeToken) return '';
    const [firstChar = ''] = Array.from(safeToken);
    const rest = safeToken.slice(firstChar.length);
    return firstChar.toLocaleUpperCase('pl-PL') + rest.toLocaleLowerCase('pl-PL');
}

/**
 * Normalizuje nazwę kierowcy do wspólnej postaci prezentacyjnej.
 *
 * Zasady:
 * - usuwa dopiski w nawiasach, np. `Adam (-2)` -> `Adam`,
 * - usuwa znaki specjalne i cyfry,
 * - redukuje separatory do pojedynczych odstępów między członami nazwy,
 * - ujednolica wielkość liter.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeDriverDisplayName(value) {
    const raw = String(value ?? '')
        .normalize('NFKC')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\{[^}]*\}/g, ' ');
    const tokens = raw.match(/\p{L}+/gu) ?? [];
    if (tokens.length === 0) return '';
    return tokens.map(formatNameToken).join(' ').trim();
}

/**
 * Buduje znormalizowany klucz porównawczy dla nazwy kierowcy.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function buildNormalizedDriverLookupKey(value) {
    return fuzzyNormalizeText(normalizeDriverDisplayName(value))
        .replace(/\s+/g, ' ')
        .trim();
}
 
/**
 * Uzupełnia liczbę do 2 cyfr.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function pad2(value) {
    return String(value).padStart(2, '0');
}
 
/**
 * Parsuje ciąg znaków do formatu czasu HH:MM.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseTimeString(value) {
    const match = String(value).trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?(?:[.,]\d+)?$/);
    if (!match) return null;
    const hours = Number(match[1]), minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${pad2(hours)}:${pad2(minutes)}`;
}
 
/**
 * Konwertuje ułamek doby (Excel) na format czasu HH:MM.
 *
 * @param {number} fraction
 * @returns {string}
 */
export function formatTimeFromDayFraction(fraction) {
    const totalMinutes = Math.round(fraction * 24 * 60);
    const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}
 
/**
 * Formatuje wartość komórki (obsługa typowych reprezentacji czasu z Excela).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function formatCellValue(value) {
    if (value === null || value === undefined) return '';
    let num = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed !== '' && /^-?\d*\.?\d+$/.test(trimmed)) num = parseFloat(trimmed);
    }
    if (typeof num === 'number' && Number.isFinite(num)) {
        if (num > 0 && num < 1) return formatTimeFromDayFraction(num);
        if (num >= 1000 && num < 60000) {
            const frac = num % 1;
            if (frac > 0 && frac < 1) return formatTimeFromDayFraction(frac);
        }
    }
    const asString = String(value).trim(), timeParsed = parseTimeString(asString);
    return timeParsed || asString;
}
 
/**
 * Minimalna ucieczka HTML pod kątem XSS.
 * Uwaga: funkcja nie sanitizuje złożonego HTML — służy wyłącznie do wstawiania tekstu.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
 
/**
 * Parsuje wartość liczbową z CSS (np. "12px" -> 12).
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseCssNumber(value, fallback) {
    const n = parseFloat(String(value ?? '').trim());
    return Number.isFinite(n) ? n : fallback;
}
 
/**
 * Funkcja debounce — opóźnia wykonanie funkcji do czasu, aż użytkownik przestanie wywoływać ją przez `delayMs`.
 *
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {number} delayMs
 * @returns {F & { cancel: () => void }}
 */
export function debounce(fn, delayMs) {
    let timerId = null;
    const debounced = (...args) => {
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(() => fn(...args), delayMs);
    };
    debounced.cancel = () => {
        if (timerId) clearTimeout(timerId);
        timerId = null;
    };
    return debounced;
}
