# Plan dekompozycji i refaktoryzacji struktury JS w QuickEvo (Wersja MAX dla agenta trae.ai)

**WERSJA PLANU:** 2.0 (ulepszona maksymalnie pod kątem trae.ai IDE)
**Data:** bieżąca
**Aktualny rozmiar monolitu:** `js/entry/app.js` — **2331 linii** (~101 KB)

---

## ⚠️ PROTOKÓŁ DLA AGENTA trae.ai IDE — OBOWIĄZKOWY (NIE POMIJAJ)

Ten dokument jest **specyfikacją wykonania** dla agenta trae.ai. Musisz traktować go jako ścisłą instrukcję operacyjną.

### 1. Zawsze przestrzegaj reguł `.trae/rules/`

**Przed KAŻDĄ modyfikacją pliku (nawet 1 linia, nawet nowy plik):**
- Wyświetl **dokładnie** w tej formie:

```
**PRE-IMPLEMENTATION CHECK (Faza X.Y — Nazwa fazy)**
- Pliki, których dotyczy zmiana: 
  - Nowe: ...
  - Modyfikowane: ...
  - Usuwane: ...
- Podsumowanie zmiany: (1-2 zdania, co dokładnie robisz i dlaczego)
- Poziom ryzyka: Low / Medium / High + krótkie uzasadnienie (szczególnie dla fragile obszarów)
- Czy wymagana jest explicit approval użytkownika przed edycją? Tak / Nie
- Moja pewność co do tego kroku: XX/100
```

- Jeśli pewność < 85% lub ryzyko = High — **ZATRZYMAJ SIĘ** i użyj mechanizmu pytania użytkownika (ask_user / widget).

**Po KAŻDEJ zmianie kodu (nawet małej):**
- **Zawsze** wykonaj procedurę testową **dokładnie** według `.trae/rules/http-server-8000-monitor.md`:
  1. Użyj widocznego terminala (nie background, nie detached).
  2. Wejdź do katalogu projektu: `Set-Location "d:\Desktop\Projects\QuickEvo"`
  3. Zabij poprzedni proces na porcie 8000.
  4. Uruchom: `py -m http.server 8000`
  5. Otwórz http://localhost:8000/ w przeglądarce.
  6. Przetestuj kluczowe scenariusze.
  7. Zrestartuj serwer po każdej kolejnej zmianie.

**Aktualizacja README i wersji (obowiązkowa):**
- Przy każdej **nietrywialnej** zmianie (nowy plik, przeniesienie logiki, zmiana struktury, usunięcie martwego kodu) — **zawsze** aktualizuj `README.md`.
- Zwiększ badge wersji według ścisłych reguł z `readme-updates.md`:
  - Refaktoryzacja strukturalna / znacząca dekompozycja = **Minor** (np. 2.26.18 → 2.27.0 lub 2.27.1).
  - Drobne sprzątanie / usuwanie martwego kodu = Patch (wybierz 1-20).
- Dodaj sekcję po polsku opisującą co zostało zrobione.

### 2. Styl pracy agenta (Zero zgadywania)

- **Zawsze najpierw eksploruj** (grep + read_file z limitami + read podobnych modułów jako wzorców).
- Rób **bardzo małe, atomowe zmiany** — maksymalnie 1-2 pliki na "rundę".
- Po każdym znaczącym kroku podawaj:
  - Aktualną liczbę linii w `js/entry/app.js`
  - Status weryfikacji (server 8000 + konkretne testy)
  - Czy README został zaktualizowany
- **Nigdy** nie zgaduj zachowania kruchych części (patrz sekcja "Obszary wysokiego ryzyka").
- Wszystkie nowe komentarze, JSDoc i opisy modułów **wyłącznie po polsku**, w stylu istniejących plików (patrz `search-application.js`, `preview-application.js`, `core/utils.js`).
- Zwracaj obiekty `Object.freeze(...)` w `createXxx`.
- Używaj wzorca `cfg` z walidacją na początku funkcji.

### 3. Cele tego planu (mierzalne)

- **Główny cel:** `js/entry/app.js` ≤ **400 linii** (najlepiej ~300-350).
- Zachować **100%** istniejącej funkcjonalności i zachowań (w tym bardzo kruchy mechanizm restore scroll po preview, kolejkowanie Drive sync, diff, grafik z wieloma kierowcami, reduced-motion, itd.).
- Zero regresji w kluczowych przepływach.
- Poprawa separacji odpowiedzialności (SOLID).
- Łatwiejsze przyszłe utrzymanie i testowanie.

---

## 1. Aktualny stan (snapshot)

### Największe pliki JS (stan na teraz)

| Plik                                           | Linie | KB   | Status                  | Priorytet dekomp. |
|------------------------------------------------|-------|------|-------------------------|-------------------|
| `js/entry/app.js`                              | 2331  | 101  | **Główny monolit**      | ★★★★★            |
| `js/tests/tests.js`                            | 835   | 51   | Testy manualne          | Niski             |
| `js/ui/drive/drive-changes-modal.js`           | 823   | 43   | Duży + logika diff      | ★★★★              |
| `js/services/schedule-service.js`              | 592   | 28   | Dobrze wydzielony       | Średni            |
| `js/devtools/qe-debugger.js`                   | 570   | 29   | Devtool (Shadow DOM)    | Niski             |
| `js/ui/schedule-controller.js`                 | 450   | 19   | Leży płasko w ui/       | ★★                |
| `js/app/drive-unified-sync-application.js`     | 365   | 20   | OK                      | Niski             |
| `js/ui/loading/welcome-loading-overlay-controller.js` | ~380 | 19 | OK                      | Niski             |

**Całkowita liczba plików .js:** ~45

**Główne problemy:**
- Ogromny stan w closure `entry/app.js` (`allData`, `fullFileData`, `routeFileIndexByCode`, pending scroll restore, busy locks itp.).
- Logika przetwarzania danych wymieszana z UI wiring i inicjalizacją.
- Renderowanie widoków (routes, drivers, schedule, results) w entry.
- Logika diff w pliku UI.
- Niespójna struktura `ui/`.
- Martwy kod: `drive-sync-application.js` + nieużywana zmienna.

**Mocne strony istniejącej architektury (zachowaj!):**
- Czysty `core/` (brak DOM).
- Wzorzec `createXxx(cfg)` + dependency injection.
- Barrel `ui-components.js`.
- Dobre JSDoc w nowszych modułach.

---

## 2. Docelowa architektura (po dekompozycji)

```
js/
├── core/
│   ├── dom-refs.js                 # NOWY — wszystkie getElementById w jednym miejscu
│   ├── data-store.js               # NOWY — właściciel całego stanu danych (allData + metadane + rewizje)
│   ├── file-processor.js           # NOWY — normalizacja wierszy, createNormalizedRow, addTableRows, process*
│   ├── drive-diff.js               # NOWY — czysty silnik diff (LCS, cell diff, context)
│   └── utils.js                    # ROZSZERZONY o runWithConcurrency, pickRandomSample, clearElement itd.
├── app/
│   ├── routes-application.js       # NOWY
│   ├── drivers-application.js      # NOWY
│   ├── schedule-application.js     # NOWY (lub wzmocnienie istniejącego)
│   ├── search-application.js       # ISTNIEJĄCY (ew. drobne zmiany cfg)
│   ├── ... (pozostałe istniejące)
├── features/
│   └── search/                     # istniejące
├── ui/
│   ├── schedule/
│   │   └── schedule-controller.js  # PRZENIESIONY
│   ├── drive/
│   │   ├── drive-changes-modal.js  # ZMNIEJSZONY (tylko UI + interakcja)
│   │   └── (opcjonalnie renderer)
│   └── ...
├── entry/
│   └── app.js                      # ZMNIEJSZONY DO KOORDYNATORA (~300-400 linii)
└── config/
    └── route-codes.js              # ewentualnie zmodernizowany (ESM zamiast window)
```

**Zasady nazewnictwa i struktury:**
- Nowe pliki w `app/` → `createRoutesApplication(cfg)`, JSDoc po polsku.
- Nowe pliki w `core/` → czyste funkcje + ewentualnie klasy (np. DataStore), zero DOM.
- Zawsze `Object.freeze(returnObject)`.

---

## 3. Szczegółowy plan wykonania — Fazy (bardzo drobnoziarniste)

### Faza 0 — Przygotowanie i baseline (Low risk)

**PRE-IMPLEMENTATION CHECK (zawsze wyświetl przed edycją):**
```
**PRE-IMPLEMENTATION CHECK (Faza 0 — Przygotowanie)**
- Pliki: README.md (modyfikacja), ewentualnie branch/git
- Podsumowanie: Utworzenie baseline'u, link do planu, testy startowe
- Ryzyko: Low
- Pewność: 95/100
```

Zadania:
1. Utwórz branch (np. `refactor/js-decomposition-v1`).
2. Zaktualizuj `README.md` — dodaj sekcję "Plan dekompozycji JS" z linkiem do tego pliku + aktualny stan linii.
3. Zwiększ wersję (mały patch, np. +2 lub +3).
4. Uruchom pełny baseline testów:
   - `py -m http.server 8000` (zgodnie z regułą)
   - `?test=1`
   - Ręczne scenariusze: import lokalny, Drive (jeśli możliwe), wyszukiwanie, preview + powrót (scroll), grafik, sortowanie, reduced motion.

**Success criteria Fazy 0:**
- README zaktualizowany.
- Branch utworzony.
- Wszystkie testy przechodzą na baseline.
- W odpowiedzi agenta: "Baseline gotowy. app.js = 2331 linii."

**Po fazie:** Zapytaj użytkownika o "GO" przed Faza 1.

---

### Faza 1 — Centralny dostęp do DOM (dom-refs.js) — Low risk, szybki win

**Obowiązkowy PRE-CHECK przed jakąkolwiek edycją.**

Exploracja obowiązkowa (zrób to najpierw):
- Przeczytaj linie 173-231 w `entry/app.js` (wszystkie `const xxx = document.getElementById`).
- Przeczytaj `js/ui/ui-components.js` i 1-2 moduły w `ui/` jako wzorzec.

Zadania:
1. Utwórz `js/core/dom-refs.js` z funkcją `getAppDomRefs()`.
   - Zbierz **wszystkie** elementy z app.js + dodatkowe, które są pobierane później (preview table, itd.).
   - Dodaj JSDoc po polsku.
2. W `entry/app.js`:
   - Zaimportuj.
   - `const dom = getAppDomRefs();`
   - Zamień wszystkie bezpośrednie stałe na `dom.xxx`.
   - Usuń stare deklaracje.
3. Zaktualizuj miejsca przekazywania elementów w cfg do ensure/create (rozważ przekazanie `dom` lub podzbioru).

**Szablon nowego pliku (użyj tego stylu):**

```js
/**
 * @module core/dom-refs
 *
 * @description
 * Centralne pobieranie referencji do elementów DOM aplikacji QuickEvo.
 * Dzięki temu unikamy powtarzania document.getElementById w wielu miejscach
 * i ułatwiamy testowanie/mocking.
 */
export function getAppDomRefs() {
    return Object.freeze({
        searchInput: document.getElementById('search-input'),
        // ... wszystkie
    });
}
```

**Verification checklist:**
- Uruchom `py -m http.server 8000` + przetestuj wyszukiwanie, nawigację, preview, schedule.
- Sprawdź, czy nie ma błędów "cannot read of null".
- Podaj nową liczbę linii w app.js.

**Success:** app.js zmniejszony o ~50-70 linii. Zero regresji.

---

### Faza 2 — Enkapsulacja stanu danych (data-store.js) — **Medium-High risk** (kluczowa)

**Ten krok ma najwyższy priorytet i ryzyko. Rób go bardzo ostrożnie, najlepiej w podfazach.**

**Obowiązkowy PRE-CHECK + potwierdzenie użytkownika przed edycją (ryzyko High).**

Exploracja obowiązkowa:
- Przeczytaj całą sekcję "KLUCZOWY STAN APLIKACJI" (ok. linie 256-380).
- Przeczytaj `core/state.js` (jako istniejący wzorzec stanu).
- Przeczytaj `search-orchestrator.js` (jak dostaje dane).
- Znajdź wszystkie miejsca używające `allData`, `currentResults`, `matchedResults`, `loadedFiles`, `fullFileData`, `routeFileIndexByCode`, `allDataRevision`, `lastRenderedSearch`, `pendingResultsScrollRestore*`.

**Podział na podfazy (zalecane):**

**2.1** — Stwórz szkielet `js/core/data-store.js` + podstawowe metody (getAllData, addNormalizedRows, reset, getRevision, buildRouteFileIndex...).
- Zdecyduj o interfejsie (zrób go bogatym, ale prostym).
- Zwróć frozen obiekt.

**2.2** — Podłącz `dataStore` w `entry/app.js`:
  - Zastąp wszystkie bezpośrednie `let allData = []` itd.
  - Zaktualizuj `resetAppData`, `removeFileData`.

**2.3** — Zaktualizuj konsumentów:
  - `search-orchestrator` cfg (`getAllData`)
  - `import-application.js`
  - `drive-unified-sync-application.js` i inne drive
  - Miejsca w app.js używające bezpośrednio stanu (performSearch, renderResults, finalizeLoad itp.)

**2.4** — Przenieś `buildRouteFileIndex`, `extractRouteCodeFromFileName`, `normalizeRouteCodeForLookup` do data-store lub file-processor.

**Obszary szczególnej uwagi w tej fazie:**
- Mechanizm `pendingResultsScrollRestore` i wszystkie funkcje z nim związane (linie ~1597-1686).
- `setCurrentResults` wewnątrz ensureSearchApplication.
- Rewizja danych używana do cache invalidation.

**Verification po każdej podfazie:**
- Pełny cykl http.server 8000.
- Szczególny test: wyszukiwanie → kliknięcie wyniku → powrót (sprawdź czy scroll i pozycja się przywracają).
- Import pliku → natychmiastowe wyszukiwanie.
- Usunięcie pliku.

**Success criteria Fazy 2:**
- `allData` i pokrewne zmienne zniknęły z closure app.js (lub są tylko przez dataStore).
- app.js zmniejszony o ~150-250 linii.
- Zero regresji w restore scroll i cache.

---

### Faza 3 — Wydzielenie procesora plików (file-processor.js) — Medium risk

Exploracja:
- Przeczytaj funkcje: `processFile`, `parseSpreadsheet`, `addTableRows`, `createNormalizedRow`, `getRowDisplayText`, `readWorkbook`, `loadAllFiles`, `processFilesWithConcurrency` itd.
- Przeczytaj `core/excel-processor.js` i `core/formatters/*` (jako zależności).

Zadania:
1. Utwórz `js/core/file-processor.js`.
2. Przenieś:
   - `createNormalizedRow`
   - `getRowDisplayText`
   - `addTableRows`
   - Logikę `processFile` / `parseSpreadsheet`
   - `readWorkbook`
3. Stwórz czyste API, np.:
   - `normalizeAndStoreRows(tableModel, fileName, { dataStore, getRouteCategoriesFromFileName, ... })`
   - `processFileContent(...)`
4. Zaktualizuj `import-application.js`, drive apps i entry (loadAllFiles itp.).
5. Przenieś też helpery typu `countNonEmpty`, `isEmptyCell` jeśli pasują.

**Success:** Logika "plik → znormalizowane wiersze w store" jest całkowicie poza entry/app.js.

---

### Faza 4 — Uproszczenie modalu zmian Google Drive — Medium risk

Exploracja:
- Cały plik `ui/drive/drive-changes-modal.js` — obecnie tylko renderer listy zmian, rozwijanie kafelkow i pasek przewijania.

Zadania:
1. Trzymaj `drive-changes-modal.js` jako lekki modul UI bez porownywania rekordow.
2. Rozszerzaj modal tylko o liste plikow, powody zmian i metadane synchronizacji.
3. Pilnuj, aby logika pobierania i kwalifikowania zmian pozostawala w warstwie aplikacyjnej, a nie w UI.
4. Dodaj JSDoc po polsku w nowym module.

**Success:** Plik modalu wyraźnie mniejszy, diff jest testowalny w izolacji.

---

### Faza 5 — Aplikacje widoków (routes, drivers, schedule) — Medium risk

**Rozbij na trzy osobne podfazy.**

**5.1 routes-application.js**
- Przenieś: `renderRoutesView`, `renderTileGrid`, `showRoutesShell`, `openRoutesView`, `setPrimaryNavActive` (części), logikę kafelków tras.

**5.2 drivers-application.js**
- Analogicznie dla kierowców.

**5.3 schedule-application.js**
- Przenieś logikę otwierania widoku grafiku: `openScheduleView`, `handleBackFromSchedule`, `showScheduleShell`, `openRouteFromSchedule`.
- Wiring `ensureScheduleController` można zostawić cienki w entry lub przenieść więcej do schedule-application.

W każdej podfazie:
- Najpierw przeczytaj istniejące `preview-application.js` i `search-application.js` jako wzorzec cfg.
- Przekazuj `dataStore` (lub jego metody) + `dom` + potrzebne formatters.
- Zaktualizuj `navigation-application.js` i listenery w entry.

**Success:** Funkcje `render*View`, `open*View` (poza search i preview) zniknęły z entry/app.js.

---

### Faza 6 — Przeniesienie helperów i czyszczenie (core/utils + entry)

- Przenieś do `core/utils.js` (jeśli jeszcze nie ma):
  - `runWithConcurrency`
  - `pickRandomSample`
  - `clearElement`, `setElementHtml`, `setElementSvg`
  - `focusBodySafely`
  - `queuePreviewReadyEvent`
  - Inne małe czyste funkcje.
- Usuń delegaty/wrappery z app.js (`normalizeText`, `fuzzyNormalizeText`, `escapeHtml`, `debounce` itd.) — używaj bezpośrednio importu z utils.
- Usuń martwy kod: `drive-sync-application.js` + zmienna `driveSyncApplication`.
- Wyczyść sekcje "FUNKCJE FORMATOWANIA..." i "UTILITY / FALLBACK".

**Protocol usuwania martwego kodu:**
- Najpierw grep całego projektu.
- Potem PRE-CHECK z "Usuwanie martwego kodu".
- Potem usunięcie.

---

### Faza 7 — Uporządkowanie struktury ui/ i config

- Przenieś `js/ui/schedule-controller.js` → `js/ui/schedule/schedule-controller.js`
- Zaktualizuj wszystkie importy + barrel `ui-components.js`.
- (Opcjonalnie, niżej priorytet) Zmodernizuj `config/route-codes.js` na ESM + dependency injection (zamiast window global).

---

### Faza 8 — Finalne czyszczenie entry/app.js do koordynatora

Cel: app.js powinien zawierać głównie:
- Importy
- `const dom = ...; const dataStore = ...;`
- Tworzenie wszystkich aplikacji (ensure* — cienkie)
- `setupEventListeners()` (delegujące do app.*)
- `init()`, `performInitialDataLoad()` (cienkie orkiestratory)
- `qeBootstrap()`
- Kilka glue functions (continueToApp, resetToInitialState — delegujące)

Usuń wszystko co zostało przeniesione. Zaktualizuj JSDoc na górze pliku.

**Target:** ≤ 400 linii.

---

### Faza 9 — Pełna weryfikacja + dokumentacja

1. Pełny regression test przez http.server 8000:
   - Import lokalny + nadpisanie
   - Google Drive sync (jeśli możliwe) + diff + kolejka
   - Wyszukiwanie + sortowanie + predictive
   - Preview + powrót (scroll restore w różnych warunkach)
   - Grafik (miesiące, klikanie tras, kierowcy)
   - Nawigacja TRASY / KIEROWCY / GRAFIK
   - Usuwanie plików, czyszczenie DB
   - Reduced motion
   - ?test=1
2. Sprawdź rozmiar `entry/app.js`.
3. **Obowiązkowa** aktualizacja `README.md`:
   - Nowa struktura projektu
   - Opis zmian architektonicznych (po polsku)
   - Bump wersji (prawdopodobnie Minor — 2.27.x)
4. Opcjonalnie: dodaj proste testy jednostkowe dla nowych core modułów (data-store, file-processor, drive-diff).

---

## 4. Obszary wysokiego ryzyka — szczególną uwagę!

1. **Restore scroll po preview** (`pendingResultsScrollRestore*` + observery) — najkruchsza część.
2. **Kolejkowanie ręcznej synchronizacji Drive** w `drive-unified-sync-application.js`.
3. **Diff** — musi zachować dokładnie to samo zachowanie (ID-based, cell-level, context 3, unified style).
4. **Grafik + schedule-service + routeFileIndex** — zależność między danymi tras a grafikiem.
5. **Cache LRU + rewizja danych** po imporcie/usunięciu.
6. **Eventy i stan nawigacji** (popstate, home link itp.).

W tych obszarach — zawsze czytaj kod 2-3 razy, rób mniejsze kroki, testuj natychmiast.

---

## 5. Szablony (używaj ich)

**Szablon createXxxApplication (app/):**

```js
/**
 * @module app/xxx-application
 *
 * @description
 * Warstwa aplikacyjna (use-case) dla ...
 *
 * Cel:
 * - wydzielenie ... z `app.js`
 * - zachowanie czystej granicy: ...
 */

/**
 * Tworzy serwis aplikacyjny...
 *
 * @param {Object} cfg
 * @param {...} cfg....
 */
export function createXxxApplication(cfg) {
    if (!cfg || typeof cfg.xxx !== 'function') throw new Error('xxx-application: brak ...');

    // logika

    return Object.freeze({ metoda1, metoda2 });
}
```

Podobny szablon dla core/ (patrz utils.js i search-engine.js).

---

## 6. Finalny protokół weryfikacji (po Fazie 9)

- app.js ≤ 400 linii
- Wszystkie manualne scenariusze przechodzą
- Serwer testowy używany po każdej zmianie (potwierdzenie w logach)
- README zaktualizowany z nową wersją i opisem
- Brak martwego kodu
- Agent w ostatniej odpowiedzi podaje podsumowanie + pewność

---

## 7. Szczegółowa inwentaryzacja funkcji z entry/app.js (Appendix — aktualizuj przed użyciem)

**Instrukcja dla agenta:** Przed rozpoczęciem każdej fazy **zawsze** re-sprawdź aktualne linie funkcjami za pomocą grep/read_file, bo linie mogą się zmieniać podczas refaktoryzacji.

### Kategorie i rekomendowane cele

**Zostają w entry/app.js (cienkie glue / bootstrap):**
- `qeBootstrap` (76)
- `init` (461)
- `performInitialDataLoad` (498)
- `finalizeBoot` (528)
- `setupEventListeners` (647) + wszystkie `setup*Listeners` (662-740)
- `ensureNavigationApplication`, `ensureNavigationService`
- `ensureSearchApplication`, `ensureImportApplication`, `ensurePreviewApplication`, `ensureDriveUnifiedSyncApplication`, `ensureLoadingApplication` (cienkie wersje po dekomp)
- `qeDevClearDbFilesStore`, `qeDevClearRandomFiles` (dev)
- `handleSearchInput`, `handleSearchShortQuery`, `schedulePredictiveIndexRebuild` (jeśli nie przeniesione wyżej)
- Małe glue: `continueToApp`, `goHome`, `resetToInitialState`, `logClientEvent`

**Do core/data-store.js:**
- Zmienne stanu: allData, fullFileData, loadedFiles, routeFileIndexByCode, allDataRevision, lastRenderedSearch, pendingResultsScrollRestore*, googleDriveSyncBusyLocks
- Funkcje: `resetAppData` (1512), `removeFileData` (1499), `buildRouteFileIndex` (1225), `normalizeRouteCodeForLookup` (1209), `extractRouteCodeFromFileName` (1188)

**Do core/file-processor.js:**
- `loadAllFiles` (935)
- `getRouteSpreadsheetFiles` (972)
- `processFilesWithConcurrency` (989)
- `processFile` (1020)
- `parseSpreadsheet` (1029)
- `readWorkbook` (1241)
- `addTableRows` (1346)
- `createNormalizedRow` (1364)
- `getRowDisplayText` (1383)
- `countNonEmpty` (2565), `isEmptyCell` (2572)
- Wrappery schedule processing: `processScheduleFile` (1069), `parseScheduleSpreadsheet` (1065), `loadScheduleFiles` (1077), `invalidateScheduleFile` (1073)

**Do UI Google Drive:**
- `buildDriveConnectingModalHtml` (1321), `buildDriveNoChangesModalHtml` (1326) — częściowo
- Lekki renderer `drive-changes-modal.js` odpowiedzialny za HTML, rozwijanie kafelkow i pasek przewijania

**Do app/routes-application.js:**
- `renderRoutesView` (2137)
- `renderTileGrid` (2112)
- `showRoutesShell` (2191)
- `openRoutesView` (2209)
- Część `setPrimaryNavActive` (2079)

**Do app/drivers-application.js:**
- `renderDriversView` (2167)
- `showDriversShell` (2200)
- `openDriversView` (2216)

**Do app/schedule-application.js (lub schedule view logic):**
- `openScheduleView` (2253)
- `handleBackFromSchedule` (2298)
- `showScheduleShell` (2239)
- `openRouteFromSchedule` (2229)
- Duża część `ensureScheduleController` (1829) — wiring

**Do ui/results/* lub dedykowanego results logic (opcjonalnie w tej dekomp):**
- `renderResults` (1526) — **bardzo ważna i krucha**
- `updateResultsCountInfo` (1770)
- `clearResults` (1974)
- `handleNoSearchResults` (1987), `handleNoResultsToRender` (1994), `handleSearchError` (2001)
- Cały blok scroll restore: `cssEscapeAttrValue` (1574), `findResultRowElement` (1580), `clearActiveResultRow` (1589), `cancelResultsScrollRestore` (1597), `applyResultsScrollRestoreOnce` (1603), `requestResultsScrollRestore` (1653), `capturePendingResultsScrollRestore` (1686)
- `syncRouteCategorySectionHeights` (1723), `toggleRouteCategorySection` (1727), `isRouteCategoryCollapsed` (1731)

**Do istniejących ensure / preview / modal logic (entry zostaje cienki):**
- `showFilePreview` (1740)
- `ensurePreviewController` (1810), `ensureModalController` (1795), `ensureResultsCategoryController` (1852), `ensureResultsRenderer` (1869) itd.
- `highlightLabsInPreviewTable` (1922)
- `displayImportSummary` (1915)

**Przenieść do core/utils.js (lub zostawić jeśli już są):**
- `runWithConcurrency` (2489)
- `pickRandomSample` (2498)
- `clearElement` (2459)
- `setElementHtml` (2464)
- `setElementSvg` (2473)
- `focusBodySafely` (2577)
- `queuePreviewReadyEvent` (2586)
- `normalizeText` (2327), `fuzzyNormalizeText` (2334), `formatCellValue` (2341), `parseTimeString` (2348), `escapeHtml` (2355), `formatCellContent` (2363) — usunąć delegaty

**Inne / dev / specjalne:**
- `qeDev*` — zostawić w entry lub przenieść do devtools
- `ensureFetchPolyfill`, `storageGet`, `storageSet` — rozważyć utils lub zostawić
- `handleLoadError`, `finalizeLoad`, `setUploadStatusText`, `setImportLoadingState` — często glue do aplikacji

**Uwaga:** Wiele `ensureXxxController` / `ensureXxxRenderer` zostanie w entry jako fabryki konfiguracji, ale ich ciężka logika ma być w docelowych modułach.

---

**Ten plan jest teraz maksymalnie szczegółowy, preskryptywny, z wymuszonymi protokołami trae.ai i dużą ilością konkretnych wskazówek.**

Jeśli chcesz, mogę teraz:
- Wygenerować **gotowe szkielety** wszystkich nowych plików (`data-store.js`, `file-processor.js`, `dom-refs.js`, `drive-diff.js`, `routes-application.js` itd.) z pełnym polskim JSDoc.
- Rozpocząć realizację **krok po kroku** (zaczynając od Fazy 0), ściśle przestrzegając PRE-IMPLEMENTATION CHECK i testów 8000.
- Dodać jeszcze jedną tabelę z priorytetami i szacowanym zmniejszeniem linii na fazę.

Daj znać komendą, np.:
- "wygeneruj szkielety"
- "zacznij od fazy 0"
- "dodaj tabelę priorytetów linii"

Powodzenia — z tą wersją agent trae.ai powinien mieć bardzo wysokie szanse na poprawne wykonanie dekompozycji.
