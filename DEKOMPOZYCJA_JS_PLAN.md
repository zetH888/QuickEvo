# Plan dekompozycji i refaktoryzacji struktury JS w QuickEvo (Wersja MAX dla agenta trae.ai)

**WERSJA PLANU:** 2.0 (ulepszona maksymalnie pod kątem trae.ai IDE)
**Data:** bieżąca
**Aktualny rozmiar monolitu:** `js/entry/app.js` — **2799 linii** (stan po domknięciu końcówki Fazy 2)

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

### Największe pliki JS (stan na 2026-06-20)

| Plik                                           | Linie | KB   | Status                  | Priorytet dekomp. |
|------------------------------------------------|-------|------|-------------------------|-------------------|
| `js/entry/app.js`                              | 2799  | ~118 | **Główny monolit**      | ★★★★★            |
| `js/tests/tests.js`                            | ~835  | ~51  | Testy manualne          | Niski             |
| `js/ui/drive/drive-changes-modal.js`           | ~823  | ~43  | Duży UI + interakcje diff | ★★★★           |
| `js/services/schedule-service.js`              | ~592  | ~28  | Dobrze wydzielony       | Średni            |
| `js/devtools/qe-debugger.js`                   | ~570  | ~29  | Devtool (Shadow DOM)    | Niski             |
| `js/ui/schedule-controller.js`                 | ~450  | ~19  | Nadal płasko w `ui/`    | ★★                |
| `js/app/drive-unified-sync-application.js`     | ~365  | ~20  | Istnieje i jest używany | Niski             |
| `js/core/data-store.js`                        | ~170  | ~7   | Istnieje, ale nadal etapowy | ★★★         |

**Całkowita liczba plików .js:** ~35

**Główne problemy:**
- `entry/app.js` nadal jest centralnym miejscem dla zbyt wielu odpowiedzialności: ładowanie plików, stan danych, render wyników, widoki tras/kierowców/grafiku, część helperów i glue code.
- `data-store.js` istnieje, ale nie przejął jeszcze całej odpowiedzialności za mutację i udostępnianie stanu.
- Logika przetwarzania danych nadal jest wymieszana z entry (`processFile`, `parseSpreadsheet`, `addTableRows`, `createNormalizedRow`).
- Widoki `routes`, `drivers`, `schedule` nadal są renderowane bezpośrednio w `entry/app.js`.
- `drive-changes-modal.js` jest nadal duży i nadal żyje obok starego `simple-xlsx-diff.js`, zamiast czystego modułu `drive-diff.js`.
- Niespójna struktura `ui/` nadal występuje (`schedule-controller.js` leży płasko w `ui/`).
- Cleanup martwego kodu wokół synchronizacji Drive został już wykonany: usunięto `js/app/drive-sync-application.js` oraz zbędną zmienną `driveSyncApplication`.

**Mocne strony istniejącej architektury (zachowaj!):**
- Czysty `core/` (brak DOM).
- Wzorzec `createXxx(cfg)` + dependency injection.
- Barrel `ui-components.js`.
- Dobre JSDoc w nowszych modułach.

### Rzeczywiście wykonane do tej pory

- **Faza 0:** częściowo wykonana operacyjnie, ale plan nie był aktualizowany na bieżąco; README istnieje i opisuje dekompozycję, wersja projektu została już wcześniej podniesiona.
- **Faza 1:** wykonana. Istnieje `js/core/dom-refs.js`, a `entry/app.js` korzysta już z `getAppDomRefs()`.
- **Faza 2.1:** wykonana. Istnieje `js/core/data-store.js`.
- **Faza 2.2:** wykonana. `entry/app.js` korzysta z `dataStore`, a reset/usuwanie danych nie jest już właścicielskie po stronie entry.
- **Faza 2.3:** wykonana na obecnym etapie. `search-application` i główne ścieżki ładowania/usuwania używają mutacji z `dataStore`, choć część referencji do odczytu nadal pozostaje w entry dla kompatybilności.
- **Faza 2.4:** wykonana. Helpery `extractRouteCodeFromFileName`, `normalizeRouteCodeForLookup`, `buildRouteFileIndex` zostały wyniesione do `js/core/data-store.js`.
- **Fazy 3-9:** niewykonane jako osobne etapy; część UI i aplikacji została wcześniej rozbita niezależnie od tego planu, ale monolit `entry/app.js` nadal nie został sprowadzony do cienkiego koordynatora.

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

## 3. Zaktualizowany plan wykonania — stan obecny + 3 większe wdrożenia

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
- `data-store.js` staje się właścicielem mutacji dla `allData`, `loadedFiles`, `fullFileData`, `routeFileIndexByCode`, `currentResults`, `matchedResults`, `lastRenderedSearch` i `lastQuery`.
- Helpery `extractRouteCodeFromFileName`, `normalizeRouteCodeForLookup`, `buildRouteFileIndex` są poza `entry/app.js`.
- `entry/app.js` może nadal tymczasowo trzymać niektóre referencje/aliasy tylko do odczytu, ale nie powinien już być właścicielem mutacji tego stanu.
- Zero regresji w restore scroll, cache i szybkim odświeżaniu wyników po imporcie/usunięciu.

---

### Wdrożenie A — Dane, ingestia i synchronizacja

To wdrożenie zastępuje dawne Fazy 3, 4 i część 6.

Zakres:
1. Utwórz `js/core/file-processor.js` i przenieś do niego:
   - `processFile`
   - `parseSpreadsheet`
   - `addTableRows`
   - `createNormalizedRow`
   - `getRowDisplayText`
   - `readWorkbook`
   - małe helpery typu `countNonEmpty`, `isEmptyCell` (jeśli pasują semantycznie)
2. Dopnij przepływ „plik -> parser -> store -> indeks wyszukiwania”, tak aby `entry/app.js` nie przetwarzał już bezpośrednio danych arkuszy.
3. Uprość `ui/drive/drive-changes-modal.js` do lekkiego modułu UI i wynieś logikę diff do dedykowanego modułu (`core/drive-diff.js` albo zachowaj `simple-xlsx-diff.js` jako warstwę przejściową, ale bez dokładania logiki do UI).
4. Zweryfikuj, czy po cleanupie synchronizacji Drive nie zostały jeszcze lokalne duplikaty lub pomocnicze wrappery do dalszego uproszczenia.
5. Jeżeli w trakcie wyjdzie potrzeba, przenieś małe czyste helpery do `core/utils.js`, ale tylko te bezpieczne i rzeczywiście współdzielone.

Success criteria:
- `entry/app.js` nie zawiera już głównej logiki parsowania arkuszy.
- `drive-changes-modal.js` jest lżejszy i nie staje się miejscem dla logiki domenowej.
- Stary mechanizm `drive-sync-application.js` został już usunięty z aktywnej architektury.

---

### Wdrożenie B — Widoki, nawigacja i porządek strukturalny

To wdrożenie zastępuje dawne Fazy 5, 7 i dużą część 8.

Zakres:
1. Wydziel aplikacje widoków:
   - `js/app/routes-application.js`
   - `js/app/drivers-application.js`
   - `js/app/schedule-application.js`
2. Przenieś do nich logikę `render*View`, `show*Shell`, `open*View`, `openRouteFromSchedule`, `handleBackFromSchedule` i powiązane fragmenty nawigacji.
3. Przenieś `js/ui/schedule-controller.js` do `js/ui/schedule/schedule-controller.js` i zaktualizuj barrel `ui-components.js`.
4. Oczyść `entry/app.js` z helperów renderujących i z glue, które da się bezpiecznie wynieść do modułów `app/`, `ui/` i `core/`.

Success criteria:
- `entry/app.js` nie renderuje już bezpośrednio widoków tras, kierowców i grafiku.
- Struktura `ui/` jest spójniejsza i odzwierciedla podział odpowiedzialności.
- `entry/app.js` zaczyna pełnić realnie rolę koordynatora.

---

### Wdrożenie C — Finalne odchudzenie entrypointu i pełna regresja

To wdrożenie zastępuje końcówkę dawnej Fazy 8 i całą Fazę 9.

Zakres:
1. Ostatecznie odchudź `entry/app.js` do koordynatora:
   - importy,
   - tworzenie aplikacji,
   - cienkie `ensure*`,
   - `setupEventListeners`,
   - `init`, `performInitialDataLoad`, `qeBootstrap`,
   - niezbędny glue code.
2. Dokończ przenoszenie drobnych helperów do `core/utils.js` lub innych właściwych modułów.
3. Wykonaj pełną regresję ręczną przez `http.server 8000`:
   - wyszukiwanie,
   - predictive,
   - preview + restore scroll,
   - Drive sync + diff + kolejka,
   - grafik,
   - nawigacja,
   - czyszczenie DB / usuwanie plików,
   - reduced motion,
   - `?test=1`
4. Zaktualizuj `README.md`, wersję i opis architektury po zakończeniu całości.

Success criteria:
- `entry/app.js` jest cienkim entrypointem/koordynatorem.
- Kluczowe scenariusze regresyjne przechodzą.
- Dokumentacja repo odpowiada rzeczywistemu stanowi kodu.

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
- `isEmptyCell` (2572)
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
