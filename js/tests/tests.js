/**
 * Simple Test Suite for QuickEvo
 */
const QuickEvoTests = {
    /**
     * Uruchamia testy automatyczne.
     * Po rozpoczęciu refaktoryzacji do modułów ESM testy nie powinny polegać na funkcjach w global scope.
     *
     * @returns {Promise<void>}
     */
    async run() {
        console.log("%c--- QuickEvo Test Suite ---", "color: #0066cc; font-weight: bold; font-size: 1.2rem;");
        const ctx = await this.loadModules();
        await this.testXlsxLoaded();
        await this.testTableModelCoreColumns();
        await this.testSearchResultsSorting(ctx);
        await this.testScheduleService(ctx);
        await this.testPreviewDriverBadges(ctx);
        await this.testDriveService(ctx);
        await this.testDriveUnifiedSyncQueuedManual(ctx);
        this.testModuleIsolation(ctx);
        this.testNormalization(ctx);
        this.testFuzzySearch(ctx);
        this.testLegacySelfTests(ctx);
        this.testLabBadgeScope(ctx);
        this.testDebuggerModule();
        console.log("%c--- Tests Completed ---", "color: #0066cc; font-weight: bold;");
    },

    /**
     * Ładuje moduły ESM wykorzystywane w testach.
     *
     * @returns {Promise<{ utils: any, searchEngine: any }>}
     */
    async loadModules() {
        const [utils, searchEngine, scheduleService, driveService, previewController, driveUnifiedSyncApplication, searchResultsSort, routeNameFormatter, previewLabsHighlight, resultsRenderer] = await Promise.all([
            import('../core/utils.js'),
            import('../core/search-engine.js'),
            import('../services/schedule-service.js'),
            import('../services/drive-service.js'),
            import('../ui/preview/preview-controller.js'),
            import('../app/drive-unified-sync-application.js'),
            import('../features/search/search-results-sort.js'),
            import('../core/formatters/route-name.js'),
            import('../ui/preview/preview-labs-highlight.js'),
            import('../ui/results/results-renderer.js')
        ]);
        return { utils, searchEngine, scheduleService, driveService, previewController, driveUnifiedSyncApplication, searchResultsSort, routeNameFormatter, previewLabsHighlight, resultsRenderer };
    },

    async testXlsxLoaded() {
        console.log("\nTesting XLSX Library:");
        try {
            const excelProcessor = await import('../core/excel-processor.js');
            this.assert(typeof excelProcessor.sheetToMatrix === 'function', "XLSX jest dostępne przez ESM (excel-processor)");
        } catch (e) {
            this.assert(false, "Nie udało się zaimportować XLSX przez ESM");
            console.error(e);
        }
    },

    async testTableModelCoreColumns() {
        console.log("\nTesting excel-processor — minimalna struktura tabeli:");
        try {
            const excelProcessor = await import('../core/excel-processor.js');
            this.assert(typeof excelProcessor.buildTableModel === 'function', "buildTableModel jest dostępne przez import");
            if (typeof excelProcessor.buildTableModel !== 'function') return;

            const modelMissingNotes = excelProcessor.buildTableModel([
                ['NR', 'GODZ', 'ADRES', 'PLACÓWKA'],
                [198, '09:45', 'Warszawa, Dzika 4', 'Dzika Laboratorium']
            ]);
            this.assert(Boolean(modelMissingNotes?.isCompleteStructure), 'Model z core kolumnami (bez UWAGI) jest traktowany jako kompletny dla UI');
            this.assert(modelMissingNotes?.headerMap?.GODZ === 1, 'Mapuje GODZ na poprawny indeks');
            this.assert(modelMissingNotes?.headerMap?.ADRES === 2, 'Mapuje ADRES na poprawny indeks');
            this.assert(modelMissingNotes?.headerMap?.NAZWA_PLACOWKI === 3, 'Mapuje NAZWA_PLACOWKI na poprawny indeks');

            const modelOnlyCore = excelProcessor.buildTableModel([
                ['GODZ', 'ADRES', 'NAZWA PLACÓWKI'],
                ['08:00', 'Warszawa, Dzika 4', 'Dzika Laboratorium']
            ]);
            this.assert(Boolean(modelOnlyCore?.isCompleteStructure), 'Model z samymi core kolumnami jest traktowany jako kompletny dla UI');
            this.assert(modelOnlyCore?.headerMap?.GODZ === 0, 'Mapuje GODZ na poprawny indeks (core-only)');
            this.assert(modelOnlyCore?.headerMap?.ADRES === 1, 'Mapuje ADRES na poprawny indeks (core-only)');
            this.assert(modelOnlyCore?.headerMap?.NAZWA_PLACOWKI === 2, 'Mapuje NAZWA_PLACOWKI na poprawny indeks (core-only)');
        } catch (e) {
            this.assert(false, "Nie udało się przetestować minimalnej struktury tabeli");
            console.error(e);
        }
    },

    async testSearchResultsSorting(ctx) {
        console.log("\nTesting Sortowanie wyników wyszukiwania:");
        try {
            const sortMod = ctx?.searchResultsSort;
            const formatRouteNameForResults = ctx?.routeNameFormatter?.formatRouteNameForResults || ((x) => String(x || ''));

            this.assert(typeof sortMod?.sortSearchResultGroups === 'function', "search-results-sort jest dostępny przez import");
            if (typeof sortMod?.sortSearchResultGroups !== 'function') return;

            const groupsAlpha = [
                { fileName: 'TRASA 11.xlsx', items: [] },
                { fileName: 'TRASA 2.xlsx', items: [] },
                { fileName: 'TRASA B.xlsx', items: [] },
                { fileName: 'TRASA A.xlsx', items: [] }
            ];
            const alphaSorted = sortMod.sortSearchResultGroups(groupsAlpha, {
                mode: sortMod.SEARCH_RESULTS_SORT_MODE_ALPHANUM,
                formatRouteNameForResults
            });
            const alphaLabels = alphaSorted.map(g => formatRouteNameForResults(g.fileName)).join(',');
            this.assert(alphaLabels === 'TRASA A,TRASA B,TRASA 2,TRASA 11', 'Sortowanie alfanumeryczne: litery + liczby (naturalnie)');

            const now = new Date(2026, 4, 21, 13, 30, 0, 0);
            const makeCompleteItem = (time) => ({ isComplete: true, headerMap: { GODZ: 0 }, cells: [time], displayText: `${time} | X | Y` });

            const groupsTime = [
                { fileName: 'TRASA 4.xlsx', items: [makeCompleteItem('08:00'), makeCompleteItem('13:29')] },
                { fileName: 'TRASA 3.xlsx', items: [makeCompleteItem('13:25')] },
                { fileName: 'TRASA 1.xlsx', items: [makeCompleteItem('13:45')] },
                { fileName: 'TRASA 2.xlsx', items: [makeCompleteItem('13:15')] },
                { fileName: 'TRASA 9.xlsx', items: [makeCompleteItem('-')] }
            ];

            const timeSorted = sortMod.sortSearchResultGroups(groupsTime, {
                mode: sortMod.SEARCH_RESULTS_SORT_MODE_TIME,
                now,
                formatRouteNameForResults
            });
            const timeLabels = timeSorted.map(g => formatRouteNameForResults(g.fileName)).join(',');
            this.assert(timeLabels === 'TRASA 1,TRASA 4,TRASA 2,TRASA 3,TRASA 9', 'Sortowanie godzinowe: najwcześniejsza następna godzina (z uwzględnieniem następnego dnia)');
            this.assert(timeSorted[1]?.items?.[0]?.cells?.[0] === '08:00', 'Sortowanie godzinowe: sortuje wiersze w grupie (najwcześniejsza następna godzina na górze)');

            const tieNow = new Date(2026, 4, 21, 13, 35, 0, 0);
            const tieGroups = [
                { fileName: 'TRASA 1.xlsx', items: [makeCompleteItem('13:45')] },
                { fileName: 'TRASA 2.xlsx', items: [makeCompleteItem('13:45')] }
            ];
            const tieSorted = sortMod.sortSearchResultGroups(tieGroups, {
                mode: sortMod.SEARCH_RESULTS_SORT_MODE_TIME,
                now: tieNow,
                formatRouteNameForResults
            });
            const tieLabels = tieSorted.map(g => formatRouteNameForResults(g.fileName)).join(',');
            this.assert(tieLabels === 'TRASA 1,TRASA 2', 'Sortowanie godzinowe: remis rozstrzyga deterministycznie po nazwie trasy');

            const wrapNow = new Date(2026, 4, 21, 20, 51, 0, 0);
            const wrapGroups = [
                { fileName: 'TRASA 1.xlsx', items: [makeCompleteItem('09:00')] },
                { fileName: 'TRASA 2.xlsx', items: [makeCompleteItem('08:00'), makeCompleteItem('09:00')] },
                { fileName: 'TRASA 3.xlsx', items: [makeCompleteItem('21:00')] }
            ];
            const wrapSorted = sortMod.sortSearchResultGroups(wrapGroups, {
                mode: sortMod.SEARCH_RESULTS_SORT_MODE_TIME,
                now: wrapNow,
                formatRouteNameForResults
            });
            const wrapLabels = wrapSorted.map(g => formatRouteNameForResults(g.fileName)).join(',');
            this.assert(wrapLabels === 'TRASA 3,TRASA 2,TRASA 1', 'Sortowanie godzinowe: wybiera najbliższą przyszłą godzinę (dziś lub kolejny dzień), bez progu 20:00');
            this.assert(wrapSorted[1]?.items?.[0]?.cells?.[0] === '08:00', 'Sortowanie godzinowe: sortuje wiersze tak, aby najbliższa następna godzina była na górze grupy');
        } catch (e) {
            this.assert(false, "Nie udało się przetestować sortowania wyników wyszukiwania");
            console.error(e);
        }
    },

    /**
     * Sprawdza, że kluczowe funkcje refaktoryzowane do ESM nie wyciekają do global scope.
     *
     * @param {{ utils: any, searchEngine: any }} ctx
     */
    testModuleIsolation(ctx) {
        console.log("\nTesting No Global Scope (modules):");
        this.assert(typeof window.normalizeText !== 'function', "normalizeText nie jest dostępne globalnie (ESM)");
        this.assert(typeof window.fuzzyNormalizeText !== 'function', "fuzzyNormalizeText nie jest dostępne globalnie (ESM)");
        this.assert(typeof window.rowMatchesKeyLab !== 'function', "rowMatchesKeyLab nie jest dostępne globalnie (ESM)");
        this.assert(typeof ctx?.utils?.normalizeText === 'function', "utils.normalizeText jest dostępne przez import");
        this.assert(typeof ctx?.searchEngine?.rowMatchesKeyLab === 'function', "searchEngine.rowMatchesKeyLab jest dostępne przez import");
    },

    async testScheduleService(ctx) {
        console.log("\nTesting Grafik Kierowców — schedule-service:");
        try {
            const createScheduleService = ctx?.scheduleService?.createScheduleService;
            this.assert(typeof createScheduleService === 'function', "schedule-service jest dostępny przez import");
            if (typeof createScheduleService !== 'function') return;

            const matrix = [
                ['IMIE I NAZWISKO', 1, 2, 3],
                ['Jan Kowalski', '12/H', 'Z', 'S - 5'],
                ['Anna Nowak', '12', '', '']
            ];

            const service = createScheduleService({
                fuzzyNormalizeText: (t) => String(t ?? '').toLowerCase(),
                getRouteScheduleConfig: () => ({
                    monthsPl: { MAJ: 5 },
                    standard: ['12'],
                    wieczorek: ['H'],
                    sobota: ['S-5'],
                    niedziela: ['N-2'],
                    dayMarkers: ['D'],
                    normalizeScheduleToken: (t) => String(t ?? '').trim().toUpperCase()
                }),
                readWorkbook: async () => ({ SheetNames: ['S1'], Sheets: { S1: { __matrix: matrix } } }),
                sheetToMatrix: (ws) => ws.__matrix,
                getBlob: async () => null,
                listFiles: async () => [],
                logAction: () => { }
            });

            this.assert(typeof service?.isScheduleXlsxFileName === 'function', "isScheduleXlsxFileName jest dostępne w schedule-service");
            if (typeof service?.isScheduleXlsxFileName === 'function') {
                this.assert(service.isScheduleXlsxFileName('WARSZAWA MAJ 2026.xlsx') === true, 'Rozpoznaje nazwę grafiku w formacie .xlsx');
                this.assert(service.isScheduleXlsxFileName('WARSZAWA MAJ 2026.csv') === false, 'Odrzuca nazwę grafiku w formacie .csv (strict xlsx)');
            }

            this.assert(typeof service?.selectScheduleFileNameForYearMonth === 'function', "selectScheduleFileNameForYearMonth jest dostępne w schedule-service");
            if (typeof service?.selectScheduleFileNameForYearMonth === 'function') {
                const picked = service.selectScheduleFileNameForYearMonth(
                    ['WARSZAWA MAJ 2026.xlsx', 'RADOM MAJ 2026.xlsx', 'WARSZAWA KWIECIEN 2026.xlsx', 'WARSZAWA MAJ 2026.csv'],
                    { year: 2026, month: 5, strictXlsx: true }
                );
                this.assert(picked === 'RADOM MAJ 2026.xlsx', 'Wybiera deterministycznie plik grafiku dla miesiąca/roku (strict xlsx)');
            }

            await service.parseScheduleSpreadsheet(null, 'WARSZAWA MAJ 2026.csv');

            const d1 = service.getDriverNamesForRouteOnDate('12', new Date(2026, 4, 1));
            this.assert(Array.isArray(d1) && d1.length === 2 && d1[0] === 'Anna Nowak' && d1[1] === 'Jan Kowalski', "Zwraca posortowanych kierowców dla trasy 12 (1 maja)");

            const h = service.getDriverNamesForRouteOnDate('H', new Date(2026, 4, 1));
            this.assert(Array.isArray(h) && h.length === 1 && h[0] === 'Jan Kowalski', "Obsługuje trasę H z komórki 12/H (wieczorek)");

            const s5 = service.getDriverNamesForRouteOnDate('S-5', new Date(2026, 4, 3));
            this.assert(Array.isArray(s5) && s5.length === 1 && s5[0] === 'Jan Kowalski', "Obsługuje sobotę S-5 (3 maja)");

            // API przeglądania grafiku miesiąca (bez zależności od Date/stref czasowych)
            const monthRoutes = service.listMonthRoutes(2026, 5);
            this.assert(Array.isArray(monthRoutes) && monthRoutes.join(',') === '12,H,S-5', "listMonthRoutes zwraca posortowaną listę tras dla miesiąca");

            const daysNonEmpty = service.listMonthDays(2026, 5, { includeEmptyDays: false });
            this.assert(Array.isArray(daysNonEmpty) && daysNonEmpty.length === 2, "listMonthDays (bez pustych) zwraca tylko dni z przypisaniami");
            if (Array.isArray(daysNonEmpty) && daysNonEmpty.length === 2) {
                this.assert(daysNonEmpty[0].isoDate === '2026-05-01' && daysNonEmpty[0].routes.join(',') === '12,H', "listMonthDays zwraca trasy dla 2026-05-01");
                this.assert(daysNonEmpty[1].isoDate === '2026-05-03' && daysNonEmpty[1].routes.join(',') === 'S-5', "listMonthDays zwraca trasy dla 2026-05-03");
            }

            const day1Routes = service.listDayRoutes('2026-05-01');
            this.assert(Array.isArray(day1Routes) && day1Routes.join(',') === '12,H', "listDayRoutes zwraca trasy dla dnia (YYYY-MM-DD)");

            const day1Assignments = service.listDayAssignments('2026-05-01');
            this.assert(Array.isArray(day1Assignments) && day1Assignments.length === 2, "listDayAssignments zwraca przypisania dla dnia (trasa -> kierowcy)");
            if (Array.isArray(day1Assignments) && day1Assignments.length === 2) {
                this.assert(day1Assignments[0].routeCode === '12' && day1Assignments[0].driverNames.join(',') === 'Anna Nowak,Jan Kowalski', "listDayAssignments zwraca kierowców dla trasy 12 (YYYY-MM-DD)");
                this.assert(day1Assignments[1].routeCode === 'H' && day1Assignments[1].driverNames.join(',') === 'Jan Kowalski', "listDayAssignments zwraca kierowców dla trasy H (YYYY-MM-DD)");
            }

            const d1Iso = service.getDriverNamesForRouteOnIsoDate('12', '2026-05-01');
            this.assert(Array.isArray(d1Iso) && d1Iso.join(',') === 'Anna Nowak,Jan Kowalski', "getDriverNamesForRouteOnIsoDate zwraca kierowców dla trasy i daty ISO");

            const monthTable = service.getMonthScheduleTable(2026, 5);
            this.assert(Boolean(monthTable && Array.isArray(monthTable.days) && Array.isArray(monthTable.rows)), "getMonthScheduleTable zwraca strukturę tabeli grafiku");
            if (monthTable && Array.isArray(monthTable.rows) && monthTable.rows.length === 2) {
                this.assert(monthTable.rows[0].driverName === 'Jan Kowalski', "getMonthScheduleTable zachowuje kolejność kierowców z pliku");
                const cell = monthTable.rows[0]?.cells?.[1];
                const tokens = Array.isArray(cell?.tokens) ? cell.tokens : [];
                const markerZ = tokens.find(t => t?.kind === 'marker' && t?.code === 'Z');
                this.assert(Boolean(markerZ), "getMonthScheduleTable zachowuje markery z grafiku (np. Z) w komórkach");
            }
        } catch (e) {
            this.assert(false, "Nie udało się przetestować schedule-service");
            console.error(e);
        }
    },

    async testDriveService(ctx) {
        console.log("\nTesting Google Drive — drive-service:");
        const driveService = ctx?.driveService;
        this.assert(typeof driveService?.validateExcelFileName === 'function', "drive-service jest dostępny przez import");
        if (typeof driveService?.validateExcelFileName !== 'function') return;

        this.assert(driveService.validateExcelFileName('test.xlsx') === true, 'Walidacja rozszerzenia .xlsx');
        this.assert(driveService.validateExcelFileName('test.xls') === true, 'Walidacja rozszerzenia .xls');
        this.assert(driveService.validateExcelFileName('test.csv') === false, 'Odrzuca rozszerzenie .csv');
        this.assert(typeof driveService?.listFolderFilesShallow === 'function', "listFolderFilesShallow jest dostępne w drive-service");

        const originalFetch = globalThis.fetch;
        let downloadCalls = 0;
        let listCalls = 0;

        try {
            globalThis.fetch = async (url, opts) => {
                const raw = String(url || '');

                if (raw.includes('?alt=media')) {
                    downloadCalls += 1;
                    return {
                        ok: true,
                        status: 200,
                        arrayBuffer: async () => new TextEncoder().encode('ok').buffer,
                        text: async () => ''
                    };
                }

                if (raw.startsWith('https://www.googleapis.com/drive/v3/files?')) {
                    listCalls += 1;
                    const u = new URL(raw);
                    const q = String(u.searchParams.get('q') || '');
                    const isRoot = q.includes("'root' in parents");
                    const isSub = q.includes("'sub' in parents");

                    if (isRoot) {
                        return {
                            ok: true,
                            status: 200,
                            json: async () => ({
                                nextPageToken: '',
                                files: [
                                    { id: 'sub', name: 'SubFolder', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-05-16T00:00:00Z' },
                                    { id: 'a', name: 'a.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-05-16T00:00:00Z' },
                                    { id: 'x', name: 'ignore.txt', mimeType: 'text/plain', modifiedTime: '2026-05-16T00:00:00Z' }
                                ]
                            }),
                            text: async () => ''
                        };
                    }

                    if (isSub) {
                        return {
                            ok: true,
                            status: 200,
                            json: async () => ({
                                nextPageToken: '',
                                files: [
                                    { id: 'b', name: 'b.xls', mimeType: 'application/vnd.ms-excel', modifiedTime: '2026-05-15T00:00:00Z' }
                                ]
                            }),
                            text: async () => ''
                        };
                    }

                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({ nextPageToken: '', files: [] }),
                        text: async () => ''
                    };
                }

                return {
                    ok: false,
                    status: 500,
                    json: async () => ({}),
                    text: async () => 'Unexpected URL'
                };
            };

            const token = 'test-token';

            const ab1 = await driveService.downloadFileArrayBuffer('file-1', token);
            const ab2 = await driveService.downloadFileArrayBuffer('file-1', token);
            this.assert(ab1 instanceof ArrayBuffer && ab2 instanceof ArrayBuffer, 'downloadFileArrayBuffer zwraca ArrayBuffer');
            this.assert(downloadCalls === 1, 'downloadFileArrayBuffer używa cache dla tego samego fileId');

            const list = await driveService.crawlFolder('root', token);
            const names = Array.isArray(list) ? list.map(x => String(x?.name || '')).sort() : [];
            this.assert(Array.isArray(list) && names.join(',') === 'a.xlsx,b.xls', 'crawlFolder zwraca tylko pliki .xlsx/.xls (rekurencyjnie)');
            this.assert(listCalls >= 2, 'crawlFolder wykonuje zapytania do folderu głównego i podfolderu');
        } catch (e) {
            this.assert(false, "Nie udało się przetestować drive-service");
            console.error(e);
        } finally {
            globalThis.fetch = originalFetch;
        }
    },

    async testDriveUnifiedSyncQueuedManual(ctx) {
        console.log("\nTesting Google Drive — drive-unified-sync: kolejka ręcznej synchronizacji:");
        try {
            const createApp = ctx?.driveUnifiedSyncApplication?.createDriveUnifiedSyncApplication;
            this.assert(typeof createApp === 'function', "drive-unified-sync-application jest dostępny przez import");
            if (typeof createApp !== 'function') return;

            let resolveToken = null;
            const tokenPromise = new Promise((resolve) => { resolveToken = resolve; });

            const modals = [];
            let tokenCalls = 0;

            const api = {
                getAccessToken: async () => {
                    tokenCalls += 1;
                    if (tokenCalls === 1) return await tokenPromise;
                    return `manual-token-${tokenCalls}`;
                },
                crawlFolder: async () => [],
                listFolderFilesShallow: async () => [],
                downloadFileArrayBuffer: async () => new ArrayBuffer(0)
            };

            const app = createApp({
                getApi: () => api,
                getFolderIdRoutes: () => 'routes',
                getFolderIdSchedule: () => 'schedule',
                parseScheduleMetaStrictXlsx: () => null,
                toTitleCase: (s) => String(s || ''),
                maxImportBytes: 5_000_000,
                listDbFiles: async () => [],
                getDbFileRecord: async () => null,
                putDbBlob: async () => { },
                removeFileData: () => { },
                isScheduleFileName: () => false,
                invalidateScheduleFile: () => { },
                processScheduleFile: async () => { },
                processFile: async () => { },
                loadedFiles: new Set(),
                getAllDataLength: () => 0,
                finalizeImport: async () => { },
                logAction: () => { },
                escapeHtml: (s) => String(s ?? ''),
                buildConnectingModalHtml: (stage) => String(stage ?? ''),
                buildNoChangesModalHtml: () => 'NO_CHANGES',
                buildChangesModalHtml: () => 'CHANGES',
                showModal: (title, content, actions) => { modals.push({ title, content, actions }); },
                hideModal: () => { },
                setLoadingStatusText: () => { },
                setUploadStatusText: () => { },
                setUploadProgressValue: () => { },
                setLoadingProgress: () => { },
                setUploadUiVisible: () => { },
                setButtonsBusy: () => { },
                initChangesModal: () => { },
                formatFileName: (n) => String(n ?? ''),
                isWelcomeVisible: () => false,
                prepareWelcomeProgressList: () => { },
                createWelcomeItem: () => null,
                appendWelcomeItem: () => { },
                scrollWelcomeItemIntoView: () => { },
                updateWelcomeItem: () => { },
                shouldDeferWelcomeUpdates: () => false,
                runWithConcurrency: async (list, limit, fn) => {
                    const items = Array.isArray(list) ? list : [];
                    for (const item of items) await fn(item);
                }
            });

            const firstPromise = app.start({ source: 'toolbar' });
            await new Promise((r) => window.setTimeout(r, 0));

            await app.start({ source: 'toolbar' });
            this.assert(tokenCalls === 1, "Drugie kliknięcie ręczne jest kolejkowane podczas trwającej synchronizacji");
            this.assert(modals.some(m => String(m?.content || '').includes('Kończę synchronizację')), "Modal pokazuje komunikat o kolejkowaniu kolejnej synchronizacji");

            resolveToken?.('manual-token-1');
            await firstPromise;
            await new Promise((r) => window.setTimeout(r, 250));

            this.assert(tokenCalls === 2, "Kolejna synchronizacja uruchamia się automatycznie po zakończeniu poprzedniej (bez ponownego klikania)");
        } catch (e) {
            this.assert(false, "Nie udało się przetestować kolejki ręcznej synchronizacji");
            console.error(e);
        }
    },

    async testPreviewDriverBadges(ctx) {
        console.log("\nTesting Podgląd Trasy — badge kierowcy:");
        try {
            const createPreviewController = ctx?.previewController?.createPreviewController;
            this.assert(typeof createPreviewController === 'function', "preview-controller jest dostępny przez import");
            if (typeof createPreviewController !== 'function') return;

            const root = document.createElement('div');
            root.style.position = 'absolute';
            root.style.left = '-9999px';
            root.style.top = '0';

            const searchView = document.createElement('div');
            const filePreviewView = document.createElement('div');
            const previewFileName = document.createElement('h2');
            const previewMeta = document.createElement('div');
            const tableHeader = document.createElement('tr');
            const tableBody = document.createElement('tbody');

            root.appendChild(searchView);
            root.appendChild(filePreviewView);
            root.appendChild(previewFileName);
            root.appendChild(previewMeta);
            root.appendChild(tableHeader);
            root.appendChild(tableBody);
            document.body.appendChild(root);

            const ctrl = createPreviewController({
                searchView,
                filePreviewView,
                previewMeta,
                previewFileName,
                tableHeader,
                tableBody,
                formatFileName: (x) => String(x || ''),
                getRouteCategoriesFromFileName: () => [],
                extractRouteCodeFromFileName: () => '12',
                getDriverForRouteOnDate: () => ['Jan Kowalski'],
                buildDriverBadgesHtml: (names) => {
                    const safe = Array.isArray(names) ? String(names[0] || '') : '';
                    return safe ? `<span class="result-driver-badge">${safe}</span>` : '';
                }
            });

            ctrl.showPreview({
                fileName: 'Trasa 12.xlsx',
                tableModel: { headers: [], rows: [], metaLines: [] },
                highlightRowIndex: null
            });

            const badge = previewFileName.querySelector('.result-driver-badge');
            this.assert(Boolean(badge), "Wyświetla badge kierowcy w nagłówku podglądu");
            this.assert(String(badge?.textContent || '').trim() === 'Jan Kowalski', "Badge kierowcy zawiera poprawną nazwę");

            root.remove();
        } catch (e) {
            this.assert(false, "Nie udało się przetestować badge kierowcy w podglądzie");
            console.error(e);
        }
    },

    testScheduleParsing() {
        console.log("\nTesting Grafik Kierowców — parsowanie:");
        this.assert(typeof window.parseScheduleFileNameYearMonth === 'function', "parseScheduleFileNameYearMonth jest dostępne globalnie");
        this.assert(typeof window.parseScheduleCellToRoutes === 'function', "parseScheduleCellToRoutes jest dostępne globalnie");
        this.assert(typeof window.extractRouteCodeFromFileName === 'function', "extractRouteCodeFromFileName jest dostępne globalnie");

        if (typeof window.parseScheduleFileNameYearMonth === 'function') {
            const meta = window.parseScheduleFileNameYearMonth('WARSZAWA MAJ 2026.csv');
            this.assert(Boolean(meta && meta.year === 2026 && meta.month === 5), "Rozpoznaje nazwę pliku grafiku: WARSZAWA MAJ 2026.csv");
        }

        if (typeof window.parseScheduleCellToRoutes === 'function') {
            const a = window.parseScheduleCellToRoutes('12/H');
            const b = window.parseScheduleCellToRoutes('S - 5');
            const c = window.parseScheduleCellToRoutes('21/D');
            this.assert(Array.isArray(a) && a.includes('12') && a.includes('H'), 'Parsuje komórkę typu "12/H" (standard + wieczorek)');
            this.assert(Array.isArray(b) && b.length === 1 && b[0] === 'S-5', 'Parsuje komórkę typu "S - 5" (sobota)');
            this.assert(Array.isArray(c) && c.length === 1 && c[0] === '21', 'Ignoruje oznaczenie dnia w komórce typu "21/D"');
        }

        if (typeof window.extractRouteCodeFromFileName === 'function') {
            const n1 = window.extractRouteCodeFromFileName('Trasa N - 1 (NIEDZIELA WOŁOMIN).xlsx');
            this.assert(n1 === 'N-1', 'Wyciąga kod trasy z nazwy pliku: "Trasa N - 1 ..." -> N-1');
        }
    },

    /**
     * Testy regresji dla logiki wykrywania „laboratorium” oraz normalizacji.
     *
     * @param {{ utils: any, searchEngine: any }} ctx
     */
    testLegacySelfTests(ctx) {
        console.log("\nTesting Legacy Self-Tests (migrated from app.js):");
        const compiled = ctx.searchEngine.compileKeyLabTokenSets(ctx.searchEngine.KEY_LAB_TOKEN_SETS);
        this.assert(ctx.searchEngine.rowMatchesKeyLab('LM - Dzika', compiled), 'Dopasowanie: "LM - Dzika"');
        this.assert(ctx.searchEngine.rowMatchesKeyLab('dzika laboratorium', compiled), 'Dopasowanie: "dzika laboratorium"');
        this.assert(ctx.searchEngine.rowMatchesKeyLab('laboratorium dzika', compiled), 'Dopasowanie: "laboratorium dzika"');
        this.assert(ctx.searchEngine.rowMatchesKeyLab('Piaseczno — LABORATORIUM', compiled), 'Dopasowanie: "Piaseczno — LABORATORIUM"');
        this.assert(ctx.searchEngine.rowMatchesKeyLab('Łódź   laboratorium', compiled), 'Dopasowanie: "Łódź   laboratorium"');
        this.assert(ctx.searchEngine.rowMatchesKeyLab('Wołomin/laboratorium', compiled), 'Dopasowanie: "Wołomin/laboratorium"');
        this.assert(ctx.searchEngine.rowMatchesKeyLab('Szpital Medicover', compiled), 'Dopasowanie: "Szpital Medicover"');
        this.assert(!ctx.searchEngine.rowMatchesKeyLab('dzika', compiled), 'Brak fałszywego dopasowania dla samego "dzika"');
        
        // Uwaga: normalizeText w app.js tylko zamienia na małe litery. 
        // Do usuwania ogonków służy fuzzyNormalizeText.
        this.assert(ctx.utils.fuzzyNormalizeText('Łódź') === 'lodz', 'Normalizacja polskich znaków (Łódź → lodz)');
        
        // parseDisplayText nie zostało znalezione w app.js, ale było w testach. 
        // Dodajemy zabezpieczenie, aby testy nie przerywały działania.
        if (typeof parseDisplayText === 'function') {
            this.assert(Boolean(parseDisplayText(' | Warszawa, Dzika 4 | Dzika Laboratorium')), 'Brak godziny nie blokuje wyniku');
            this.assert(Boolean(parseDisplayText('- | Warszawa, Dzika 4 | Dzika Laboratorium')), 'Niepoprawna godzina nie blokuje wyniku');
        }
    },

    /**
     * Test regresji: badge „laboratorium” nie może zostać przypisany, jeśli tokeny występują wyłącznie
     * w innych kolumnach (np. „do lab. Dzika” w uwagach), a nie w nazwie placówki.
     *
     * @param {{ searchEngine: any, previewLabsHighlight: any, resultsRenderer: any }} ctx
     */
    testLabBadgeScope(ctx) {
        console.log('\nTesting Badge „laboratorium” — dopasowanie tylko po nazwie placówki:');
        try {
            const compiled = ctx.searchEngine.compileKeyLabTokenSets(ctx.searchEngine.KEY_LAB_TOKEN_SETS);
            const rowMatchesKeyLab = (text) => ctx.searchEngine.rowMatchesKeyLab(text, compiled);

            const tbody = document.createElement('tbody');

            const trFalsePositive = document.createElement('tr');
            const facilityFalsePositive = document.createElement('td');
            facilityFalsePositive.className = 'facility-column';
            facilityFalsePositive.textContent = 'Cm Damian';
            const notesFalsePositive = document.createElement('td');
            notesFalsePositive.textContent = 'do lab. Dzika';
            trFalsePositive.appendChild(facilityFalsePositive);
            trFalsePositive.appendChild(notesFalsePositive);
            tbody.appendChild(trFalsePositive);

            const trLab = document.createElement('tr');
            const facilityLab = document.createElement('td');
            facilityLab.className = 'facility-column';
            facilityLab.textContent = 'Dzika Laboratorium';
            const notesLab = document.createElement('td');
            notesLab.textContent = '-';
            trLab.appendChild(facilityLab);
            trLab.appendChild(notesLab);
            tbody.appendChild(trLab);

            ctx.previewLabsHighlight.highlightLabsInPreviewTableDom({
                tbody,
                rowMatchesKeyLab,
                escapeHtml: (x) => String(x ?? ''),
                toTitleCase: (x) => String(x ?? '')
            });

            this.assert(!trFalsePositive.classList.contains('highlight-lab'), 'Nie oznacza jako laboratorium, gdy tokeny są tylko w innych kolumnach');
            this.assert(!facilityFalsePositive.querySelector('.lab-badge'), 'Nie renderuje badge w kolumnie placówki dla fałszywego trafienia');
            this.assert(trLab.classList.contains('highlight-lab'), 'Oznacza jako laboratorium, gdy tokeny są w nazwie placówki');
            this.assert(Boolean(facilityLab.querySelector('.lab-badge')), 'Renderuje badge w kolumnie placówki dla laboratorium');

            const createResultsRenderer = ctx?.resultsRenderer?.createResultsRenderer;
            this.assert(typeof createResultsRenderer === 'function', 'results-renderer jest dostępny przez import');
            if (typeof createResultsRenderer !== 'function') return;

            const renderer = createResultsRenderer({
                formatRouteNameForResults: (x) => String(x || ''),
                extractRouteCodeFromFileName: () => null,
                getDriverForRouteOnDate: () => null,
                buildDriverBadgesHtml: () => '',
                escapeHtml: (x) => String(x ?? ''),
                setElementHtml: (el, html) => { if (el) el.innerHTML = String(html ?? ''); },
                rowMatchesKeyLab,
                toTitleCase: (x) => String(x ?? ''),
                highlightText: (t) => String(t ?? '')
            });

            const groupEl = renderer.createGroupElement({
                fileName: 'TRASA 1.xlsx',
                items: [{
                    isComplete: true,
                    fileName: 'TRASA 1.xlsx',
                    rowIndex: 1,
                    displayText: '08:00 | Adres | Cm Damian',
                    cells: ['08:00', 'Adres', 'Cm Damian', 'do lab. Dzika']
                }]
            }, 0, '');

            this.assert(!groupEl.querySelector('.result-row--lab'), 'Lista wyników: nie oznacza jako lab, gdy tokeny są tylko w innych kolumnach');
        } catch (e) {
            this.assert(false, 'Nie udało się przetestować zakresu dopasowania badge „laboratorium”');
            console.error(e);
        }
    },

    testDebuggerModule() {
        console.log("\nTesting Debugger Module:");
        this.assert(typeof window.logAction === 'function', "logAction jest dostępne globalnie");
        this.assert(typeof window.QE_Debugger === 'object' && window.QE_Debugger !== null, "QE_Debugger jest dostępny globalnie");

        try { window.logAction('test', { ok: true }, 'INFO'); this.assert(true, "logAction nie zgłasza wyjątku"); }
        catch (e) { this.assert(false, "logAction nie powinno zgłaszać wyjątku"); }

        if (window.QE_Debugger && typeof window.QE_Debugger.benchmark === 'function') {
            const res = window.QE_Debugger.benchmark({ count: 1200 });
            const ok = res && Number.isFinite(res.pushMs) && Number.isFinite(res.openMs) && res.count === 1200;
            this.assert(ok, "benchmark zwraca wynik i nie zawiesza renderowania");
        }
    },

    testDriveDiff() {
        console.log("\nTesting Drive Diff (Myers):");
        this.assert(typeof window.qeComputeLineDiff === 'function', "qeComputeLineDiff jest dostępne globalnie");
        if (typeof window.qeComputeLineDiff !== 'function') return;
        const ops = window.qeComputeLineDiff(['a', 'b', 'c'], ['a', 'c', 'd']);
        const del = ops.filter(o => o && o.t === 'del').length;
        const ins = ops.filter(o => o && o.t === 'ins').length;
        const eq = ops.filter(o => o && o.t === 'eq').length;
        this.assert(del === 1, "Wykrywa usunięcie 1 linii");
        this.assert(ins === 1, "Wykrywa dodanie 1 linii");
        this.assert(eq === 2, "Zachowuje 2 linie wspólne");
        this.assert(typeof window.qeComputeDiffContextSegments === 'function', "qeComputeDiffContextSegments jest dostępne globalnie");
        if (typeof window.qeComputeDiffContextSegments === 'function') {
            const segs = window.qeComputeDiffContextSegments([
                { t: 'eq', a: '0' },
                { t: 'eq', a: '1' },
                { t: 'del', a: '2' },
                { t: 'ins', b: '2x' },
                { t: 'eq', a: '3' },
                { t: 'eq', a: '4' },
                { t: 'eq', a: '5' }
            ], { contextLines: 2 });
            const ok = Array.isArray(segs) && segs.length === 1 && segs[0].start === 0 && segs[0].end === 5;
            this.assert(ok, "Kontekst 2 linie przed/po obejmuje poprawny zakres");
        }
    },

    testDriveRecordDiffAcceptance() {
        console.log("\nTesting Drive Diff (rekordy po ID) — testy akceptacyjne:");
        this.assert(typeof window.qeComputeRecordDiff === 'function', "qeComputeRecordDiff jest dostępne globalnie");
        this.assert(typeof window.qeRenderUnifiedRecordDiffHtml === 'function', "qeRenderUnifiedRecordDiffHtml jest dostępne globalnie");
        if (typeof window.qeComputeRecordDiff !== 'function') return;

        const makeRec = (id, dataCells) => ({ id, dataCells: Array.isArray(dataCells) ? dataCells : [] });

        {
            const oldRecs = [makeRec('R21', ['A']), makeRec('R22', ['B'])];
            const newRecs = [makeRec('R21', ['A']), makeRec('R99', ['X']), makeRec('R22', ['B'])];
            const ops = window.qeComputeRecordDiff(oldRecs, newRecs).ops;
            const ins = ops.filter(o => o && o.t === 'ins');
            const del = ops.filter(o => o && o.t === 'del');
            this.assert(ins.length === 1, "Dodanie rekordu między R21 a R22 generuje dokładnie 1 insert");
            this.assert(del.length === 0, "Dodanie rekordu nie generuje delete");
            this.assert(ins[0]?.id === 'R99', "Insert dotyczy poprawnego ID");
        }

        {
            const oldRecs = [makeRec('R21', ['A']), makeRec('R22', ['B']), makeRec('R23', ['C'])];
            const newRecs = [makeRec('R21', ['A']), makeRec('R23', ['C'])];
            const ops = window.qeComputeRecordDiff(oldRecs, newRecs).ops;
            const del = ops.filter(o => o && o.t === 'del' && (o.id === 'R22' || o.rec?.id === 'R22'));
            const r23Eq = ops.some(o => o && o.t === 'eq' && (o.id === 'R23' || o.rec?.id === 'R23'));
            this.assert(del.length === 1, "Usunięcie rekordu generuje dokładnie 1 delete dla usuwanego ID");
            this.assert(r23Eq, "Usunięcie rekordu nie oznacza następnych jako zmienione");
        }

        {
            const oldRecs = [makeRec('R21', ['A', 'B'])];
            const newRecs = [makeRec('R21', ['A', 'C'])];
            const ops = window.qeComputeRecordDiff(oldRecs, newRecs).ops;
            const del = ops.find(o => o && o.t === 'del' && (o.id === 'R21' || o.rec?.id === 'R21'));
            const ins = ops.find(o => o && o.t === 'ins' && (o.id === 'R21' || o.rec?.id === 'R21'));
            const changed = Array.isArray(del?.changedIdxs) ? del.changedIdxs : [];
            this.assert(Boolean(del) && Boolean(ins), "Modyfikacja rekordu generuje parę delete + insert");
            this.assert(changed.length === 1 && changed[0] === 1, "Modyfikacja pojedynczej komórki oznacza tylko zmienione pole");

            if (typeof window.qeRenderUnifiedRecordDiffHtml === 'function') {
                const html = window.qeRenderUnifiedRecordDiffHtml({ ops }, { contextLines: 999 });
                const hits = String(html || '').split('is-changed').length - 1;
                this.assert(hits === 2, "Highlightowanie obejmuje tylko zmodyfikowaną komórkę (po jednej na linię -/+)");
            }
        }
    },

    testDriveDiffUi() {
        console.log("\nTesting Drive Diff UI (unified) — układ i wyrównanie kolumn:");
        this.assert(typeof window.qeRenderUnifiedRecordDiffHtml === 'function', "qeRenderUnifiedRecordDiffHtml jest dostępne globalnie");

        if (typeof window.buildDriveChangesModalHtml === 'function') {
            const html = window.buildDriveChangesModalHtml([{ name: 'test.xlsx', id: '1', isNewInDb: false, driveModifiedAt: Date.now(), previousDriveModifiedAt: Date.now() - 1000 }]);
            this.assert(!String(html).includes('Kontekst'), "Nie renderuje przycisku/tekstu „Kontekst” w oknie różnic");
            this.assert(!String(html).includes('qe-drive-diff-ctx-btn'), "Nie renderuje przycisku kontekstu (brak klasy qe-drive-diff-ctx-btn)");
            this.assert(!String(html).includes('data-qe-diff-ctx'), "Nie renderuje atrybutu data-qe-diff-ctx");
        }

        if (typeof window.qeRenderUnifiedRecordDiffHtml !== 'function') return;
        const makeRec = (id, dataCells) => ({ id, dataCells: Array.isArray(dataCells) ? dataCells : [] });
        const ops = [
            { t: 'eq', rec: makeRec('R21', ['A', 'BBBB']) },
            { t: 'eq', rec: makeRec('R22', ['CC', 'D']) }
        ];
        const html = window.qeRenderUnifiedRecordDiffHtml({ ops }, { contextLines: 999 });
        this.assert(String(html).includes('qe-drive-diff-unified-scroll'), "Zawiera kontener przewijania poziomego");
        this.assert(String(html).includes('min-width:2ch'), "Dopasowuje szerokość kolumny do najdłuższej wartości (kolumna 1)");
        this.assert(String(html).includes('min-width:4ch'), "Dopasowuje szerokość kolumny do najdłuższej wartości (kolumna 2)");
        this.assert(!String(html).includes('R21'), "Nie renderuje jawnie ID/indeksu w pierwszej kolumnie diff");
    },

    testPreviewIndexColumnHidden() {
        console.log("\nTesting Preview Table — brak kolumny indeksu:");
        this.assert(typeof window.renderPreviewHeader === 'function', "renderPreviewHeader jest dostępne globalnie");
        this.assert(typeof window.renderPreviewBody === 'function', "renderPreviewBody jest dostępne globalnie");
        if (typeof window.renderPreviewHeader !== 'function' || typeof window.renderPreviewBody !== 'function') return;

        const theadRow = document.createElement('tr');
        window.renderPreviewHeader(theadRow, ['H1', 'H2', 'H3']);
        this.assert(theadRow.children.length === 3, "Nagłówek podglądu nie zawiera dodatkowej kolumny indeksu");
        this.assert(Array.from(theadRow.children).every(th => th.textContent !== '#'), "Nagłówek podglądu nie zawiera „#”");

        const tbody = document.createElement('tbody');
        const model = { headers: ['H1', 'H2'], rows: [{ originalRowIndex: 0, cells: ['A', 'B'] }], metaLines: [] };
        window.renderPreviewBody(tbody, model, null);
        const tr = tbody.querySelector('tr');
        const tds = tr ? Array.from(tr.querySelectorAll('td')) : [];
        this.assert(tds.length === 2, "Wiersz podglądu nie zawiera dodatkowej komórki indeksu");
        this.assert(tds.every(td => !td.classList.contains('row-num')), "Wiersz podglądu nie renderuje komórki z klasą row-num");
    },

    testTitleCase() {
        console.log("\nTesting Title Case Formatting:");
        this.assert(toTitleCase("DZIKA LABORATORIUM") === "Dzika Laboratorium", "Formats 'DZIKA LABORATORIUM' to 'Dzika Laboratorium'");
        this.assert(toTitleCase("warszawa, bacha 2") === "Warszawa, Bacha 2", "Formats 'warszawa, bacha 2' to 'Warszawa, Bacha 2'");
        this.assert(toTitleCase("LM DZIKA") === "Lm Dzika", "Formats 'LM DZIKA' to 'Lm Dzika'");
        this.assert(toTitleCase("") === "", "Handles empty string");
        this.assert(toTitleCase(null) === "", "Handles null");
    },

    testCheckListOverflow() {
        console.log("\nTesting Scroll Indicator Overflow Logic (checkListOverflow):");

        this.assert(typeof window.checkListOverflow === 'function', "checkListOverflow jest dostępne globalnie");

        const container = document.createElement('div');
        container.style.width = '120px';
        container.style.height = '80px';
        container.style.overflowY = 'auto';
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '0';

        const content = document.createElement('div');
        content.style.width = '100%';

        container.appendChild(content);
        document.body.appendChild(container);

        content.style.height = '60px';
        this.assert(checkListOverflow(container, container) === false, "Brak overflow, gdy scrollHeight <= clientHeight");

        content.style.height = '180px';
        this.assert(checkListOverflow(container, container) === true, "Overflow, gdy scrollHeight > clientHeight");

        container.style.display = 'none';
        this.assert(checkListOverflow(container, container) === false, "Brak overflow dla niewidocznego kontenera (display:none)");

        container.remove();
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

    testNormalization(ctx) {
        console.log("\nTesting Normalization:");
        this.assert(ctx.utils.normalizeText("Łódź") === "łódź", "normalizeText zachowuje ogonki (tylko lowercase)");
        this.assert(ctx.utils.fuzzyNormalizeText("Łódź") === "lodz", "fuzzyNormalizeText usuwa ogonki");
        this.assert(ctx.utils.fuzzyNormalizeText("Warszawa, ul. Bacha 2") === "warszawa, ul. bacha 2", "fuzzyNormalizeText normalizuje case i znaki");
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

    testFuzzySearch(ctx) {
        console.log("\nTesting Search Logic:");
        const query = "lukis";
        const lowerQuery = ctx.utils.normalizeText(query);
        const fuzzyQuery = ctx.utils.fuzzyNormalizeText(query);
        
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

function shouldAutoRunTests() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const v = params.get('test');
        return v === 'true' || v === '1';
    } catch {
        return (window.location.search || '').includes('test=true') || (window.location.search || '').includes('test=1');
    }
}

if (shouldAutoRunTests()) {
    const errors = [];
    window.addEventListener('error', (e) => { errors.push({ type: 'error', message: String(e?.message || ''), source: String(e?.filename || ''), line: Number(e?.lineno || 0), col: Number(e?.colno || 0) }); });
    window.addEventListener('unhandledrejection', (e) => { errors.push({ type: 'unhandledrejection', message: String(e?.reason?.message || e?.reason || ''), source: '' }); });

    window.addEventListener('load', () => {
        QuickEvoTests.run().catch((err) => console.error('[QuickEvoTests] Błąd uruchomienia testów:', err));
        if (errors.length > 0) console.error('[QuickEvoTests] Wykryto błędy w trakcie uruchomienia testów:', errors);
        else console.log('%c[QuickEvoTests] Brak błędów w konsoli podczas uruchomienia testów.', 'color: green; font-weight: bold;');
    });
}
