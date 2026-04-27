# QuickEvo

![CI](https://img.shields.io/badge/CI-not_configured-lightgrey)
![License](https://img.shields.io/badge/license-TBD-blue)
![Status](https://img.shields.io/badge/status-active-success)

## Overview
QuickEvo to lekka aplikacja webowa (frontend-only) do szybkiego przeszukiwania tras i dokumentów na podstawie plików `.xlsx` i `.csv`. Umożliwia import plików, buduje indeks do wyszukiwania oraz pozwala podejrzeć zawartość arkuszy bezpośrednio w przeglądarce.

Aplikacja działa jako statyczna strona (bez backendu). Dane z importu są przechowywane lokalnie w przeglądarce (IndexedDB), dzięki czemu nie trzeba ponownie importować plików przy każdym uruchomieniu (dopóki nie wyczyścisz danych witryny / nie zmienisz profilu przeglądarki).

## Key Features
- [x] Import plików `.xlsx` i `.csv` (multi-import)
- [x] Drag & drop plików do okna aplikacji
- [x] Walidacja limitu rozmiaru (limit per plik)
- [x] Budowa indeksu wyszukiwania po imporcie
- [x] Wyszukiwanie tras (z debouncingiem)
- [x] Podgląd pliku (tabela + metadane)
- [x] Tryb jasny/ciemny (toggle)
- [x] Wbudowany DebugLog w prawym dolnym rogu
- [x] Działanie offline po imporcie (cache w IndexedDB)
- [x] Bezpieczniejszy CSP (Content Security Policy)

## Tech Stack
- HTML + CSS
- JavaScript (Vanilla)
- [SheetJS/xlsx](https://github.com/SheetJS/sheetjs) (ładowany z CDN) do parsowania `.xlsx`
- IndexedDB do trwałego przechowywania importowanych plików w przeglądarce

## System Requirements
- Przeglądarka: aktualny Chrome / Edge / OperaGX / Firefox
- Zalecane uruchamianie przez lokalny serwer HTTP (a nie `file://`), aby uniknąć ograniczeń przeglądarki
- Opcjonalnie: Python 3 lub Node.js do uruchomienia lokalnego serwera

## Installation (step-by-step)
1. Sklonuj repozytorium lub pobierz katalog projektu.
2. Uruchom statyczny serwer HTTP w katalogu projektu.
   - Python:
     ```bat
     cd /d d:\Desktop\Projects\QuickEvo
     py -m http.server 3000
     ```
   - Node.js (alternatywnie, jeśli masz zainstalowane):
     ```bat
     npx http-server . -p 3000
     ```
3. Otwórz aplikację:
   - `http://localhost:3000/`

## Usage
### Import plików
1. Kliknij ikonę importu w prawym górnym rogu lub upuść pliki na stronę (drag & drop).
2. Wybierz pliki `.xlsx`/`.csv`.
3. Po imporcie aplikacja zbuduje indeks i włączy wyszukiwarkę.

### Wyszukiwanie
- Wpisz minimum 3 znaki w pole wyszukiwania.
- Kliknij wynik, aby otworzyć podgląd pliku i wiersza.

### Podgląd pliku
- Widok podglądu wyświetla tabelę pierwszego arkusza z pliku.
- Możesz wrócić do wyszukiwania przyciskiem „← Powrót do wyszukiwania”.

### DebugLog
- Panel w prawym dolnym rogu umożliwia podejrzenie zdarzeń aplikacji (np. import, nawigacja, błędy wczytywania).
- Zawiera wyszukiwarkę logów i kopiowanie do schowka.

## Directory Structure
```text
QuickEvo/
  index.html        # Strona aplikacji
  style.css         # Style UI
  app.js            # Logika aplikacji
  docs/             # (Opcjonalnie) przykładowe pliki .xlsx/.csv do bootstrapu
```

## Configuration / Environment Variables
Ta aplikacja nie wymaga zmiennych środowiskowych (brak backendu).
Jeśli hostujesz aplikację na serwerze, zadbaj o:
- poprawne serwowanie plików statycznych (HTML/CSS/JS),
- poprawne nagłówki MIME,
- zachowanie CSP zdefiniowanego w `index.html`.

## API
Brak publicznego API HTTP (frontend-only).

## Security Notes
- Projekt wykorzystuje Content Security Policy. Jeśli dodajesz zewnętrzne zasoby (CDN / API), zaktualizuj CSP w `index.html`.
- Importowane pliki są przechowywane lokalnie w przeglądarce (IndexedDB) i nie są wysyłane na serwer.

## Contributing (CONTRIBUTING)
1. Zrób fork repozytorium.
2. Utwórz branch: `feature/<nazwa>` lub `fix/<nazwa>`.
3. Zadbaj o brak ostrzeżeń CSP i brak logów konsolowych (wyjątek: wbudowany DebugLog).
4. Otwórz Pull Request z opisem zmian, screenami (jeśli UI) i krokami testowymi.

## Changelog
Na ten moment repozytorium nie zawiera formalnego CHANGELOG.
Zalecany format na przyszłość: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## License
TBD (do uzupełnienia przez właściciela repozytorium).

## Roadmap
- [ ] Integracja wyszukiwanych tras z grafikiem (planowane w przyszłych wersjach)
- [ ] Import z Google Drive / integracje z chmurą (opcjonalnie)
- [ ] Ulepszenie indeksowania i metadanych plików (np. tagi, kategorie)

## Architecture (high-level)
```mermaid
flowchart LR
  UI[UI: index.html + style.css] --> JS[app.js]
  JS -->|Import| XLSX[SheetJS xlsx]
  JS -->|Persist| IDB[(IndexedDB)]
  JS -->|Search| INDEX[In-memory index]
  JS -->|Preview| TABLE[Preview table]
  JS --> DEBUG[DebugLog]
```