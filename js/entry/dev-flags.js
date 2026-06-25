/**
 * Warunkowo doładowuje narzędzia developerskie uruchamiane wyłącznie po flagach URL.
 *
 * Cel:
 * - nie pobierać cięższych skryptów developerskich w domyślnym runtime,
 * - zachować dotychczasową ścieżkę testów uruchamianych przez `?test=1` / `?test=true`.
 */
(function bootstrapDevFlags() {
    /**
     * Sprawdza, czy aktywna jest flaga `test`.
     *
     * @returns {boolean}
     */
    function shouldLoadBrowserTests() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const value = String(params.get('test') || '').trim().toLowerCase();
            return value === '1' || value === 'true';
        } catch {
            const search = String(window.location.search || '');
            return search.includes('test=1') || search.includes('test=true');
        }
    }

    /**
     * Dołącza zewnętrzny skrypt developerski tylko raz.
     *
     * @param {string} src
     * @returns {void}
     */
    function appendScriptOnce(src) {
        if (!src) return;
        if (document.querySelector(`script[src="${src}"]`)) return;
        const script = document.createElement('script');
        script.src = src;
        document.head.appendChild(script);
    }

    if (shouldLoadBrowserTests()) appendScriptOnce('js/tests/tests.js');
})();
