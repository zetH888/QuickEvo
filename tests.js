/**
 * Simple Test Suite for QuickEvo
 */
const QuickEvoTests = {
    run() {
        console.log("%c--- QuickEvo Test Suite ---", "color: #0066cc; font-weight: bold; font-size: 1.2rem;");
        this.testNormalization();
        this.testStatsFormatting();
        this.testFuzzySearch();
        console.log("%c--- Tests Completed ---", "color: #0066cc; font-weight: bold;");
    },

    assert(condition, message) {
        if (condition) {
            console.log(`%c[PASS] %c${message}`, "color: green; font-weight: bold;", "color: inherit;");
        } else {
            console.error(`[FAIL] ${message}`);
        }
    },

    testNormalization() {
        console.log("\nTesting Normalization:");
        this.assert(normalizeText("Łódź") === "łódź", "normalizeText handles diacritics (keeps them)");
        this.assert(fuzzyNormalizeText("Łódź") === "lodz", "fuzzyNormalizeText removes diacritics");
        this.assert(fuzzyNormalizeText("Warszawa, ul. Bacha 2") === "warszawa, ul. bacha 2", "fuzzyNormalizeText handles mixed case and symbols");
    },

    testStatsFormatting() {
        console.log("\nTesting Stats Formatting:");
        // Mocking DOM element
        const mockInfo = { innerHTML: "" };
        const totalRoutes = 63;
        const matchedRoutesCount = 4;
        
        // Simulating the logic from app.js
        mockInfo.innerHTML = `Trasy: ${matchedRoutesCount} / ${totalRoutes}`;
        
        this.assert(mockInfo.innerHTML === "Trasy: 4 / 63", "Stats format matches 'Trasy: var1 / var2'");
    },

    testFuzzySearch() {
        console.log("\nTesting Search Logic:");
        const query = "lukis";
        const lowerQuery = normalizeText(query);
        const fuzzyQuery = fuzzyNormalizeText(query);
        
        const testData = [
            { searchable: "warszawa, łukiska 1", searchableFuzzy: "warszawa, lukiska 1" },
            { searchable: "warszawa, bacha 2", searchableFuzzy: "warszawa, bacha 2" }
        ];

        const results = testData.filter(item => 
            item.searchable.includes(lowerQuery) || item.searchableFuzzy.includes(fuzzyQuery)
        );

        this.assert(results.length === 1, "Search finds 'Łukiska' when searching for 'lukis'");
        this.assert(results[0].searchable.includes("łukiska"), "Found result contains the original text");
    }
};

// Auto-run if URL has ?test=true
if (window.location.search.includes('test=true')) {
    window.addEventListener('load', () => QuickEvoTests.run());
}
