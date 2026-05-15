<p align="center">
  <picture>
    <img src="./assets/hero.png" alt="QuickEvo — hero" width="100%" style="pointer-events: none;" />
  </picture>
</p>

# QuickEvo

![Status](https://img.shields.io/badge/status-active-success)
![Version](https://img.shields.io/badge/version-2.5.0-blue)

Przeglądarkowe narzędzie do wyszukiwania i zarządzania danymi tras z plików Excel (.xlsx, .xls) oraz CSV.

***

## Krótki opis

QuickEvo to aplikacja PWA działająca w całości po stronie klienta w przeglądarce. Przetwarzanie plików, budowa indeksu wyszukiwania i przechowywanie danych odbywają się lokalnie z wykorzystaniem IndexedDB. Integracja z Google Drive umożliwia import dokumentów bezpośrednio z chmury.

***

## Architektura

- **Client-Side Only** — cała logika biznesowa działa w przeglądarce użytkownika
- **Modułowa struktura** — wydzielone moduły (m.in. integracja z Google Drive, debugger) oraz postępująca dekompozycja `app.js` do `js/modules/` (m.in. kontrolery UI w `ui-components.js`, w tym scroll-indicator)
- **Refaktoryzacja (instrukcja ciągła)** — `decomposition_next.md` opisuje dotychczasowy postęp i kolejne etapy do pełnej dekompozycji
- **Shadow DOM** — debugger korzysta z izolowanego Shadow DOM, co zapobiega konfliktom stylów

***

## Funkcjonalności

### Wyszukiwanie

- Wyszukiwanie rozmyte (fuzzy matching) z wykorzystaniem odległości Levenshteina
- Predykcyjne podpowiedzi inline podczas pisania z nawigacją klawiaturą (Tab/strzałki)
- Ważony indeks danych (adresy → obiekty → trasy)
- Buforowanie wyników z LRU cache
- Wyniki pogrupowane według plików źródłowych
- Zwijane sekcje kategorii tras (STANDARD, WIECZOREK, SOBOTA, NIEDZIELA)
- Automatyczne wyświetlanie kierowcy przypisanego do trasy na bieżący dzień na podstawie pliku grafiku (CSV/XLSX)
- Obsługa wielu kierowców przypisanych do tej samej trasy w jednym dniu (np. „Jan Kowalski i/lub Anna Nowak”) w formie estetycznych badge’y
- Automatyczna normalizacja zapytań (ignorowanie polskich znaków diakrytycznych i wielkości liter)

### Import danych

- Lokalny import wielu plików jednocześnie (pliki Excel i CSV)
- Integracja z Google Drive (Picker API + OAuth2)
- Synchronizacja folderów z rekursywnym pobieraniem plików .xlsx
- Rozwiązywanie konfliktów przy synchronizacji
- Obsługa grafiku kierowców: plik CSV/XLSX o nazwie „MIASTO MIESIĄC ROK” jest parsowany do przypisań trasa→kierowca, bez indeksowania w wyszukiwarce
- Rozwijalne kafelki zmian w oknie synchronizacji Google Drive + szybkie „Rozwiń/Zwiń wszystko”
- Widok różnic porównuje rekordy po stabilnym ID z pierwszej kolumny (Rxx), a nie po indeksie wiersza
- Widok różnic prezentuje unified diff (styl Git/VSCode), pokazuje kontekst (3 rekordy przed/po), wyrównuje kolumny i obsługuje przewijanie poziome
- Widok różnic wizualizuje zmiany per-komórka (cell-level) dla modyfikacji i move+modify, bez agresywnego kolorowania całych wierszy
- Przycisk różnic działa jako przełącznik „Pokaż/Ukryj różnice”, a dla nowych plików status jest sygnalizowany czerwonym „X”
- Niestandardowy pasek przewijania w oknie zmian Google Drive (premium overlay, pełna funkcjonalność przewijania)
- Diff jest automatycznie blokowany dla nowych plików (brak sensu porównania) oraz ograniczany dla bardzo dużych plików (ochrona wydajności)
- Trwałe przechowywanie w IndexedDB (praca offline)

### Interfejs

- Animacje wejścia/wyjścia wyników z efektem staggered
- Obsługa reduced motion (wyłączenie animacji dla użytkowników z wrażliwością na ruch)
- Responsywny design z obsługą urządzeń mobilnych
- Ekran powitalny z efektem glassmorphism
- Ciemny motyw (domyślny) oraz motyw Matrix (cyberpunk)
- Przełączanie motywów z zachowaniem stanu

***

## Struktura projektu

```
QuickEvo/
├── index.html           # Główny dokument HTML
├── css/
│   ├── style.css        # Style główne (jasny/ciemny motyw)
├── js/
│   ├── app.js           # Logika aplikacji
│   ├── googleDrive.js   # Moduł integracji z Google Drive
│   ├── modules/         # Moduły ESM (dekompozycja app.js)
│   │   ├── utils.js
│   │   ├── search-engine.js
│   │   ├── state.js
│   │   ├── excel-processor.js
│   │   ├── drive-service.js
│   │   ├── import/
│   │   │   └── import-service.js
│   │   ├── schedule/
│   │   │   └── schedule-service.js
│   │   └── storage/
│   │       └── docs-db.js
│   ├── qe-debugger.js   # Moduł debuggera (Shadow DOM)
│   └── tests.js         # Pakiet testów automatycznych
└── README.md
```

***

## Schema IndexedDB

**Baza danych:** `quickevo_docs_v2`

**Magazyn** **`files`:**

| Pole        | Typ    | Opis                            |
| ----------- | ------ | ------------------------------- |
| `name`      | String | Nazwa pliku (klucz główny)      |
| `blob`      | Blob   | Surowa zawartość binarna        |
| `size`      | Number | Rozmiar w bajtach               |
| `updatedAt` | Number | Timestamp ostatniej modyfikacji |

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

- Polityka CSP ogranicza źródła skryptów i połączeń sieciowych oraz blokuje osadzanie aplikacji w ramkach (ochrona przed clickjackingiem).
- Biblioteka SheetJS (XLSX) ładowana z CDN ma ustawioną integralność SRI, co utrudnia podmianę skryptu w łańcuchu dostaw.

***

## Optymalizacje wydajności

- Bufor LRU dla wyników wyszukiwania i podpowiedzi predykcyjnych
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
- Brak zewnętrznych zależności (poza SheetJS do parsowania Excel)
- Izolacja komponentów przez Shadow DOM
- Semantyczny HTML z dostępnością (progress elements, viewport-fit)

***
