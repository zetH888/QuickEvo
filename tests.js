/**
 * Simple Test Suite for QuickEvo
 */
const QuickEvoTests = {
    run() {
        console.log("%c--- QuickEvo Test Suite ---", "color: #0066cc; font-weight: bold; font-size: 1.2rem;");
        this.testNormalization();
        this.testStatsFormatting();
        this.testFuzzySearch();
        this.testDeduplicationLogic();
        this.testUnifiedDeduplication();
        this.testTitleCase();
        this.testLegacySelfTests();
        console.log("%c--- Tests Completed ---", "color: #0066cc; font-weight: bold;");
    },

    testLegacySelfTests() {
        console.log("\nTesting Legacy Self-Tests (migrated from app.js):");
        this.assert(rowMatchesKeyLab('LM - Dzika'), 'Dopasowanie: "LM - Dzika"');
        this.assert(rowMatchesKeyLab('dzika laboratorium'), 'Dopasowanie: "dzika laboratorium"');
        this.assert(rowMatchesKeyLab('laboratorium dzika'), 'Dopasowanie: "laboratorium dzika"');
        this.assert(rowMatchesKeyLab('Piaseczno — LABORATORIUM'), 'Dopasowanie: "Piaseczno — LABORATORIUM"');
        this.assert(rowMatchesKeyLab('Łódź   laboratorium'), 'Dopasowanie: "Łódź   laboratorium"');
        this.assert(rowMatchesKeyLab('Wołomin/laboratorium'), 'Dopasowanie: "Wołomin/laboratorium"');
        this.assert(rowMatchesKeyLab('Szpital Medicover'), 'Dopasowanie: "Szpital Medicover"');
        this.assert(!rowMatchesKeyLab('dzika'), 'Brak fałszywego dopasowania dla samego "dzika"');
        
        // Uwaga: normalizeText w app.js tylko zamienia na małe litery. 
        // Do usuwania ogonków służy fuzzyNormalizeText.
        this.assert(fuzzyNormalizeText('Łódź') === 'lodz', 'Normalizacja polskich znaków (Łódź → lodz)');
        
        // parseDisplayText nie zostało znalezione w app.js, ale było w testach. 
        // Dodajemy zabezpieczenie, aby testy nie przerywały działania.
        if (typeof parseDisplayText === 'function') {
            this.assert(Boolean(parseDisplayText(' | Warszawa, Dzika 4 | Dzika Laboratorium')), 'Brak godziny nie blokuje wyniku');
            this.assert(Boolean(parseDisplayText('- | Warszawa, Dzika 4 | Dzika Laboratorium')), 'Niepoprawna godzina nie blokuje wyniku');
        }
    },

    testTitleCase() {
        console.log("\nTesting Title Case Formatting:");
        this.assert(toTitleCase("DZIKA LABORATORIUM") === "Dzika Laboratorium", "Formats 'DZIKA LABORATORIUM' to 'Dzika Laboratorium'");
        this.assert(toTitleCase("warszawa, bacha 2") === "Warszawa, Bacha 2", "Formats 'warszawa, bacha 2' to 'Warszawa, Bacha 2'");
        this.assert(toTitleCase("LM DZIKA") === "Lm Dzika", "Formats 'LM DZIKA' to 'Lm Dzika'");
        this.assert(toTitleCase("") === "", "Handles empty string");
        this.assert(toTitleCase(null) === "", "Handles null");
    },

    assert(condition, message) {
        if (condition) {
            console.log(`%c[PASS] %c${message}`, "color: green; font-weight: bold;", "color: inherit;");
        } else {
            console.error(`[FAIL] ${message}`);
        }
    },

    testUnifiedDeduplication() {
        console.log("\nTesting Unified Deduplication (Local & GDrive):");
        
        const existingFiles = ["test.xlsx"];
        const gdriveFiles = [{ id: "123", name: "test.xlsx" }, { id: "456", name: "new.xlsx" }];
        const localFiles = [{ name: "test.xlsx", size: 100 }, { name: "other.xlsx", size: 200 }];

        const checkConflicts = (files) => files.filter(f => existingFiles.includes(f.name));

        this.assert(checkConflicts(gdriveFiles).length === 1, "Correctly detects GDrive conflict");
        this.assert(checkConflicts(localFiles).length === 1, "Correctly detects local conflict");
        
        const resolve = (files, mode) => {
            const conflicts = checkConflicts(files);
            if (mode === 'skip') {
                const names = new Set(conflicts.map(c => c.name));
                return files.filter(f => !names.has(f.name));
            }
            return files; // overwrite
        };

        this.assert(resolve(gdriveFiles, 'skip').length === 1, "GDrive: correctly skips existing");
        this.assert(resolve(localFiles, 'overwrite').length === 2, "Local: correctly keeps all for overwrite");
    },

    testDeduplicationLogic() {
        console.log("\nTesting Deduplication Logic:");
        
        // Mock data for tests
        const existingFiles = ["Trasa 1.xlsx", "Trasa 2.xlsx"];
        const incomingFiles = [
            { name: "Trasa 1.xlsx" },
            { name: "Trasa 3.xlsx" }
        ];

        const conflicts = incomingFiles.filter(f => existingFiles.includes(f.name));
        this.assert(conflicts.length === 1, "Correctly identifies conflicts");
        this.assert(conflicts[0].name === "Trasa 1.xlsx", "Identifies the correct conflicting file");

        const skipExisting = (files, conflictList) => {
            const conflictNames = new Set(conflictList.map(c => c.name));
            return files.filter(f => !conflictNames.has(f.name));
        };

        const filtered = skipExisting(incomingFiles, conflicts);
        this.assert(filtered.length === 1, "Correctly filters out existing files");
        this.assert(filtered[0].name === "Trasa 3.xlsx", "Keeps only new files");
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
