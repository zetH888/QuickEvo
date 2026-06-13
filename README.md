<p align="center">
  <picture>
    <img src="./assets/hero.png" alt="QuickEvo — hero" width="100%" style="pointer-events: none;" />
  </picture>
</p>

# QuickEvo

![Status](https://img.shields.io/badge/status-active-success) ![Version](https://img.shields.io/badge/version-2.31.0-blue) 

![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=000) 
![HTML5](https://img.shields.io/badge/HTML5-markup-E34F26?logo=html5&logoColor=fff) 
![CSS3](https://img.shields.io/badge/CSS3-styles-1572B6?logo=css3&logoColor=fff) 
![IndexedDB](https://img.shields.io/badge/IndexedDB-storage-4479A1) 
![Google%20Drive](https://img.shields.io/badge/Google%20Drive-sync-4285F4?logo=googledrive&logoColor=fff)

Przeglądarkowe narzędzie do synchronizacji, wyszukiwania i podglądu tras z plików Excel (.xlsx, .xls) oraz CSV, z obsługą grafiku kierowców i Google Drive jako jedynego źródła danych.

***

## Krótki opis

QuickEvo to aplikacja webowa działająca w całości po stronie klienta w przeglądarce. Przetwarzanie plików, budowa indeksu wyszukiwania i przechowywanie danych odbywają się lokalnie z wykorzystaniem IndexedDB. Integracja z Google Drive umożliwia ręczną synchronizację dokumentów (trasy + grafik) bezpośrednio z chmury i stanowi jedyny wspierany kanał dostarczania plików.

***

## Architektura

- **Client-Side Only** — cała logika biznesowa działa w przeglądarce użytkownika
- **Modułowa struktura** — warstwowy podział `js/` (entry/app/core/services/ui/storage/features/config) oraz dalsza dekompozycja `js/entry/app.js` do wyspecjalizowanych modułów
- **ESM (bez bundlera)** — logika aplikacji jest ładowana jako moduły (`<script type="module">`); SheetJS/XLSX jest importowany jako ESM z `https://esm.sh/`
- **Shadow DOM** — debugger korzysta z izolowanego Shadow DOM, co zapobiega konfliktom stylów

***

## Plan dekompozycji JS

Dokument roboczy prowadzący refaktoryzację monolitu `js/entry/app.js` do mniejszych, wyspecjalizowanych modułów:

- Plan: `DEKOMPOZYCJA_JS_PLAN.md`
- Stan startowy: `js/entry/app.js` — **2331 linii**
- Aktualny stan: `js/entry/app.js` — **2679 linii**
- Cel: `js/entry/app.js` ≤ **400 linii** (docelowo ~300–350)
- Postęp:
  - Faza 1: centralizacja referencji DOM w `js/core/dom-refs.js`
  - Faza 2.1: dodany szkielet magazynu danych `js/core/data-store.js` (bez przepinania logiki)
  - Faza 2.2 (w toku): `allData`, `loadedFiles`, `fullFileData`, `routeFileIndexByCode`, `currentResults`, `matchedResults`, `lastRenderedSearch` stopniowo przepinane na `dataStore` (bez zmiany zachowania)

***

## Funkcjonalności

### Wyszukiwanie

- Wyszukiwanie rozmyte (fuzzy matching) z wykorzystaniem odległości Levenshteina
- Predykcyjne podpowiedzi inline (ghost) + lista sugestii (top 5) podczas pisania z nawigacją klawiaturą (Tab/Enter/→/Esc/strzałki); podpowiedzi ignorują nazwy tras
- Ważony indeks danych (adresy → obiekty → trasy)
- Buforowanie wyników z LRU cache
- Szybszy system predykcji oparty o Trie (drzewo prefiksowe) z aktualizacjami inkrementalnymi per plik (add/remove) oraz pełnym rebuildu w tle (Web Worker, bez zrywania działania starego indeksu)
- Ranking predykcji uwzględnia recencję importu oraz historię akceptacji sugestii (localStorage)
- Wyniki pogrupowane według plików źródłowych
- Przełącznik sortowania listy tras w wynikach: alfanumerycznie (A‑Z) lub „najbliższa następna godzina” (⏱); tryb ⏱ sortuje też trafienia w obrębie trasy
- Rekordy wyników w formie kafelków (hover „lift” + cień) oraz ikona telefonu dla punktów „na telefon” (brak godziny lub '-'); punkty „na telefon” są delikatnie wcięte i wizualnie mniejsze
- Zwijane sekcje kategorii tras (STANDARD, WIECZOREK, SOBOTA, NIEDZIELA)
- Automatyczne wyświetlanie kierowcy przypisanego do trasy na podstawie grafiku dla daty kontekstowej (ISO, YYYY-MM-DD; domyślnie „dziś”) w podglądzie trasy
- Obsługa wielu kierowców przypisanych do tej samej trasy w jednym dniu (np. „Jan Kowalski i/lub Anna Nowak”) w formie estetycznych badge’y
- Automatyczna normalizacja zapytań (ignorowanie polskich znaków diakrytycznych i wielkości liter)

### Synchronizacja danych

- Google Drive jest jedynym wspieranym źródłem danych dla tras i grafiku
- Limit rozmiaru importu: **5MB na plik** (dotyczy synchronizacji z Google Drive)
- Ulepszony widok podsumowania importu: rozróżnienie nowe vs nadpisane pliki (naprawione także dla importu z Google Drive), kafelki/chipy z podglądem poprzedniego i nowego timestampu na hover oraz możliwość przejścia do podglądu pliku
- Integracja z Google Drive (Picker API + OAuth2)
- Synchronizacja folderów z rekursywnym pobieraniem plików .xlsx
- Rozwiązywanie konfliktów przy synchronizacji
- Kategorie tras są wyznaczane z folderu pierwszego poziomu pod `ROUTES_FOLDER_ID`: `Baltic Medica`, `Dostawy`, `Dzika`, `Wilanów`, `Wołomin` -> `STANDARD`; `Wieczorki` -> `WIECZOREK`; `Soboty` -> `SOBOTA`; `Niedziele` -> `NIEDZIELA`
- Obsługa grafiku kierowców: plik o nazwie „MIASTO MIESIĄC ROK.(xlsx/xls/csv)” jest parsowany do przypisań trasa→kierowca (bez indeksowania w wyszukiwarce)
- API `schedule-service` umożliwia wydajne przeglądanie grafiku miesiąca (lista dni, lista tras, kierowcy per trasa/dzień) na podstawie cache `byIsoDate`, dat ISO (YYYY-MM-DD) oraz dynamicznego katalogu tras zbudowanego z plików zsynchronizowanych z Google Drive
- Wspólny mechanizm synchronizacji Google Drive (trasy + grafik) z jednym modalem zmian, listą nieaktualnych plików i diff dla tras; wykrywa także pliki usunięte z Google Drive, oznacza je jako wymagające lokalnego skasowania i przed wykonaniem pokazuje dodatkowe potwierdzenie; synchronizacja uruchamiana ręcznie; kolejne kliknięcie podczas trwającej synchronizacji jest kolejkowane i uruchamiane automatycznie po zakończeniu bieżącej sesji
- Rozwijalne kafelki zmian w oknie synchronizacji Google Drive + szybkie „Rozwiń/Zwiń wszystko”
- Widok różnic porównuje rekordy po stabilnym ID z pierwszej kolumny (Rxx), a nie po indeksie wiersza
- Widok różnic prezentuje unified diff (styl Git/VSCode), pokazuje kontekst (3 rekordy przed/po), wyrównuje kolumny i obsługuje przewijanie poziome
- Widok różnic wizualizuje zmiany per-komórka (cell-level) dla modyfikacji i move+modify, bez agresywnego kolorowania całych wierszy
- Przycisk różnic działa jako przełącznik „Pokaż/Ukryj różnice”, a dla nowych plików status jest sygnalizowany czerwonym „X”
- Niestandardowy pasek przewijania w oknie zmian Google Drive (premium overlay, pełna funkcjonalność przewijania)
- Diff jest automatycznie blokowany dla nowych plików (brak sensu porównania) oraz ograniczany dla bardzo dużych plików (ochrona wydajności)
- Trwałe przechowywanie w IndexedDB (dane lokalne; bez wysyłania na serwer)

### Interfejs

- Animacje wejścia/wyjścia wyników z efektem staggered
- Zreorganizowany header: nawigacja w jednej linii oraz pojedyncza akcja synchronizacji Google Drive dla lepszej czytelności
- Płynniejszy powrót z podglądu trasy do listy wyników (bez zbędnego ponownego renderowania wyników przy niezmienionym zapytaniu)
- Obsługa reduced motion (wyłączenie animacji dla użytkowników z wrażliwością na ruch)
- Responsywny design z obsługą urządzeń mobilnych
- Widoki aplikacji i nawigacja: TRASY, KIEROWCY, GRAFIK + ekran wyszukiwania/podglądu pliku
- Ekran „Grafik” do swobodnego przeglądania harmonogramu w formie tabeli zbliżonej do arkusza: kierowcy w kolejności z pliku, kolumny dni z akcentem weekendów, zaznaczanie całej kolumny dnia oraz klikalne kody tras otwierające podgląd w kontekście wybranej daty
- Ekran powitalny z efektem glassmorphism
- Ciemny motyw (domyślny)
- Przełączanie motywów z zachowaniem stanu

***

## Struktura projektu

```
QuickEvo/
├── assets/
│   └── hero.png           # Grafika do README
├── index.html           # Główny dokument HTML
├── css/
│   └── style.css        # Style główne
├── js/
│   ├── entry/           # Entrypointy ładowane w index.html
│   │   └── app.js       # Główny bootstrap aplikacji
│   ├── app/             # Warstwa aplikacyjna (orchestracja use-case)
│   │   ├── search-application.js
│   │   ├── preview-application.js
│   │   ├── drive-sync-application.js
│   │   ├── drive-unified-sync-application.js
│   │   ├── navigation-application.js
│   │   └── loading-application.js
│   ├── config/          # Konfiguracja i stałe
│   │   ├── constants.js
│   │   └── route-codes.js
│   ├── core/            # Silnik i czyste funkcje (bez DOM)
│   │   ├── formatters/
│   │   │   ├── file-name.js
│   │   │   ├── highlight.js
│   │   │   ├── route-categories.js
│   │   │   ├── route-name.js
│   │   │   └── title-case.js
│   │   ├── data-store.js
│   │   ├── dom-refs.js
│   │   ├── utils.js
│   │   ├── search-engine.js
│   │   ├── state.js
│   │   └── excel-processor.js
│   ├── features/        # Logika specyficzna dla funkcji
│   │   └── search/
│   │       ├── predictive-index-worker.js
│   │       ├── search-orchestrator.js
│   │       ├── predictive-trie-index.js
│   │       └── search-results-sort.js
│   ├── services/        # Integracje i efekty uboczne
│   │   ├── drive-service.js
│   │   ├── navigation-service.js
│   │   └── schedule-service.js
│   ├── storage/         # Persystencja (IndexedDB)
│   │   └── docs-db.js
│   ├── ui/              # Warstwa UI (DOM)
│   │   ├── ui-components.js
│   │   ├── schedule-controller.js
│   │   ├── import/
│   │   │   └── import-summary-renderer.js
│   │   ├── logo/
│   │   │   └── quickevo-logo.js
│   │   ├── loading/
│   │   │   ├── loading-title.js
│   │   │   ├── loading-progress-controller.js
│   │   │   ├── loading-overlay-dom.js
│   │   │   ├── welcome-progress-renderer.js
│   │   │   ├── logo-renderer.js
│   │   │   └── welcome-loading-overlay-controller.js
│   │   ├── results/
│   │   │   ├── results-dom.js
│   │   │   ├── results-category-controller.js
│   │   │   ├── results-renderer.js
│   │   ├── preview/
│   │   │   ├── modal-controller.js
│   │   │   ├── preview-controller.js
│   │   │   └── preview-labs-highlight.js
│   │   ├── drive/
│   │   │   └── drive-changes-modal.js
│   │   ├── search/
│   │   │   └── predictive-ghost.js
│   │   └── theme/
│   │       └── MatrixThemeToggle.js
│   ├── devtools/        # Narzędzia developerskie
│   │   └── qe-debugger.js
│   └── tests/           # Testy (uruchamiane opcjonalnie)
│       └── tests.js
└── README.md
```

***

## Schema IndexedDB

**Baza danych:** `quickevo_docs_v2`
**Wersja:** `2`

**Magazyn** **`files`:**

| Pole             | Typ    | Opis                                                    |
| ---------------- | ------ | ------------------------------------------------------- |
| `name`           | String | Nazwa pliku (klucz główny / `keyPath`)                  |
| `blob`           | Blob   | Surowa zawartość binarna                                |
| `size`           | Number | Rozmiar w bajtach                                       |
| `updatedAt`      | Number | Timestamp ostatniej modyfikacji (ms)                    |
| `driveModifiedAt`| Number | Timestamp modyfikacji z Google Drive (ms, opcjonalny)   |
| `routeCategory`  | String | Kategoria trasy wyliczona z folderu Google Drive        |
| `topLevelFolderName` | String | Nazwa folderu pierwszego poziomu pod `ROUTES_FOLDER_ID` |

***

## Debugger i diagnostyka

Moduł `qe-debugger.js` udostępnia:

- Panel floating w prawym górnym rogu (Shadow DOM)
- Przyciski testowe: `clear db` (czyści magazyn `files` w IndexedDB) oraz `clear rnd` (usuwa losowo \~20% rekordów z magazynu `files`)
- Debugger jest dostępny wyłącznie na desktopie (viewport >= 769px)
- Funkcja `window.logAction(action, payload, level)` do logowania zdarzeń
- Obiekt `window.QE_Debugger` z metodami: `open()`, `close()`, `toggle()`, `clear()`, `log()`, `benchmark()`
- Wbudowane testy automatyczne uruchamiane przez parametr URL (`?test=1` lub `?test=true`)

***

## Bezpieczeństwo (podstawy)

- Polityka CSP jest ustawiona przez `<meta http-equiv="Content-Security-Policy">` i ogranicza źródła skryptów/połączeń (w tym do Google Drive/OAuth) oraz zasoby statyczne (`'self'`, `blob:`, `data:`).
- SheetJS/XLSX jest ładowane jako moduł ESM z `https://esm.sh/` (brak lokalnej paczki/bundlera w repo).

***

## Optymalizacje wydajności

- Bufor LRU dla wyników wyszukiwania i podpowiedzi predykcyjnych
- Przygotowany moduł indeksu predykcyjnego Trie (szybsze wyszukiwanie prefiksów, podstawa pod aktualizacje inkrementalne)
- Porcjowanie renderowania z `requestAnimationFrame`
- Event delegation dla obsługi kliknięć na listach wyników
- `ResizeObserver`, `MutationObserver` i `IntersectionObserver` do wykrywania overflow
- Równoległy import z Google Drive z limitem 2 jednoczesnych połączeń
- Lazy rendering kosztownych elementów w oknie zmian Google Drive (diff generowany dopiero na żądanie)

***

## Testy użyteczności (okno zmian Google Drive)

- Lista zmian: przewijanie myszą/touchpadem, szybkie dojście do końca listy, brak „zacięć” przy 100+ plikach
- Kafelki: rozwijanie pojedyncze i zbiorcze, poprawny stan po wielokrotnym przełączaniu, zachowanie fokusu klawiatury
- Wydajność: sprawdzenie scenariusza 500+ plików (bez automatycznego generowania diff dla wszystkich)
- Dostępność: `prefers-reduced-motion`, nawigacja klawiaturą (Tab/Shift+Tab, Enter/Space na kafelkach), widoczny focus
- Czyszczenie indeksu z pamięci RAM przy usuwaniu plików

***

## Obsługiwane przeglądarki

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

***

## Zasady projektowe

- Całe przetwarzanie odbywa się lokalnie w przeglądarce
- Minimalne zależności zewnętrzne: SheetJS/XLSX (ESM z `esm.sh`) oraz integracja z Google APIs dla Drive/OAuth
- Izolacja komponentów przez Shadow DOM
- Semantyczny HTML z dostępnością (progress elements, viewport-fit)

***
