/**
 * Konfiguracja kodów tras i oznaczeń grafiku.
 * Plik jest celowo wydzielony, aby aktualizacja list nie wymagała zmian w logice aplikacji.
 */
(function initQeRouteScheduleConfig() {
    'use strict';

    /**
     * Normalizuje token trasy/oznaczenia z grafiku do postaci porównywalnej.
     * Przykłady:
     * - "S - 8" -> "S-8"
     * - "N - 2" -> "N-2"
     * - " 16 "  -> "16"
     */
    function qeNormalizeScheduleToken(token) {
        const raw = token === null || token === undefined ? '' : String(token);
        const compact = raw
            .trim()
            .replace(/[–—]/g, '-')
            .replace(/\s+/g, ' ')
            .replace(/\s*-\s*/g, '-')
            .replace(/\s*\/\s*/g, '/');
        return compact.toUpperCase();
    }

    /**
     * Miesiące w nazwie pliku grafiku: "MIASTO MIESIĄC ROK.xlsx".
     * Klucze są przechowywane bez polskich znaków i w uppercase.
     */
    const QE_MONTHS_PL = Object.freeze({
        STYCZEN: 1,
        LUTY: 2,
        MARZEC: 3,
        KWIECIEN: 4,
        MAJ: 5,
        CZERWIEC: 6,
        LIPIEC: 7,
        SIERPIEN: 8,
        WRZESIEN: 9,
        PAZDZIERNIK: 10,
        LISTOPAD: 11,
        GRUDZIEN: 12
    });

    const QE_ROUTE_CODES_STANDARD = Object.freeze([
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
        '21', '26', '28', '29', '30', '31', '32', '33', '34', '35',
        '36', '37', '38', '39', '40', '41',
        'O', 'J'
    ]);

    const QE_ROUTE_CODES_WIECZOREK = Object.freeze([
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
        '22', '23', '24', '25'
    ]);

    const QE_ROUTE_CODES_SOBOTA = Object.freeze([
        'S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6', 'S-7', 'S-8', 'S-9', 'S-10', 'S-11', 'S-12'
    ]);

    const QE_ROUTE_CODES_NIEDZIELA = Object.freeze([
        'N-1', 'N-2'
    ]);

    const QE_DAY_MARKERS = Object.freeze([
        'Z', 'UŻ', 'UZ', 'U', 'DK', '*D', '*P'
    ]);

    window.QE_RouteScheduleConfig = Object.freeze({
        monthsPl: QE_MONTHS_PL,
        standard: QE_ROUTE_CODES_STANDARD,
        wieczorek: QE_ROUTE_CODES_WIECZOREK,
        sobota: QE_ROUTE_CODES_SOBOTA,
        niedziela: QE_ROUTE_CODES_NIEDZIELA,
        dayMarkers: QE_DAY_MARKERS,
        normalizeScheduleToken: qeNormalizeScheduleToken
    });
})();

