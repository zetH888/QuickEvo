<p align="center">
  <picture>
    <img src="./assets/hero.png" alt="QuickEvo — hero" width="100%" style="pointer-events: none;" />
  </picture>
</p>

# QuickEvo

![Status](https://img.shields.io/badge/status-active-success) ![Version](https://img.shields.io/badge/version-2.37.55-blue) 

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
- **Uproszczona ścieżka synchronizacji Drive** — aktywny runtime korzysta wyłącznie z `js/app/drive-unified-sync-application.js`; historyczny wrapper `drive-sync-application.js` został usunięty w ramach cleanupu repozytorium

***

## Plan dekompozycji JS

Dokument roboczy prowadzący refaktoryzację monolitu `js/entry/app.js` do mniejszych, wyspecjalizowanych modułów:

- Plan: `DEKOMPOZYCJA_JS_PLAN.md`
- Stan startowy: `js/entry/app.js` — **2331 linii**
- Aktualny stan: `js/entry/app.js` — **2799 linii**
- Cel: `js/entry/app.js` ≤ **400 linii** (docelowo ~300–350)
- Postęp:
  - Faza 1: centralizacja referencji DOM w `js/core/dom-refs.js`
  - Faza 2: `js/core/data-store.js` przejął mutacje dla `allData`, `loadedFiles`, `fullFileData`, `routeFileIndexByCode`, `currentResults`, `matchedResults`, `lastRenderedSearch` i `lastQuery`
  - Helpery `extractRouteCodeFromFileName`, `normalizeRouteCodeForLookup`, `buildRouteFileIndex` zostały wyniesione z `js/entry/app.js` do `js/core/data-store.js`
  - Dalszy plan został uproszczony do 3 większych wdrożeń: dane/ingestia/sync, widoki/nawigacja/struktura oraz finalne odchudzenie entrypointu

### Zmiany w wersji 2.37.55

- **Równoległa synchronizacja z Google Drive:** Zoptymalizowano pobieranie i parsowanie plików Excel poprzez zmianę pętli sekwencyjnej na asynchroniczne pobieranie z ograniczoną współbieżnością (limit ustawiony na 4 połączenia równoległe) przy użyciu istniejącego silnika `runWithConcurrency`.
- **Stabilizacja listy statusu na ekranie powitalnym:** Elementy listy postępu importu (Welcome list items) są teraz wstępnie generowane sekwencyjnie i w ustalonym porządku alfabetycznym przed uruchomieniem zadań w tle, co eliminuje przeskakiwanie i zmianę kolejności elementów w interfejsie graficznym.

### Zmiany w wersji 2.37.54

- Naprawiono rozwijanie panelu informacyjnego w kafelkach `KIEROWCY` na desktopie: panel szczegółów wrócił do normalnego flow układu, dzięki czemu rozwinięty kafelek zwiększa wysokość własnej sekcji zamiast być ucinany przez kolejne nagłówki lub dolną krawędź dokumentu.
- Otwarcie panelu szczegółów kierowcy na desktopie wykonuje teraz delikatny auto-scroll tylko wtedy, gdy dolna część rozwiniętego panelu wychodzi poza viewport, co ogranicza przypadki ręcznego dosuwania treści po kliknięciu kafelka.

### Zmiany w wersji 2.37.53

- Widok `KIEROWCY` otrzymał zwijane sekcje z pamięcią stanu w `localStorage`: główna sekcja `Kierowcy` jest teraz renderowana jako pierwsza, sekcje ról specjalnych pojawiają się pod nią, a każdy nagłówek ma spójny toggle z chevronem po lewej stronie.
- Rozwijanie i zwijanie sekcji w widoku `KIEROWCY` działa teraz płynnie z animacją `max-height` i wygaszaniem zawartości, z fallbackiem dla `prefers-reduced-motion`, dzięki czemu zachowanie jest spójniejsze z istniejącymi akordeonami aplikacji.
- Literowe znaczniki sekcji alfabetycznych w widoku `KIEROWCY` zostały optycznie wyśrodkowane względem całego rzędu kafelków, a same chevrony nagłówków zostały pomniejszone i dopasowane charakterem do tych używanych w liście wyników.

### Zmiany w wersji 2.37.47

- Uszczelniono przejście `TRASY -> preview`: reset scrolla do początku dokumentu jest teraz wykonywany wielotorowo i po kolejnych klatkach renderu, a fokus zostaje wcześniej przeniesiony z klikniętego kafelka, żeby przeglądarka nie przywracała poprzedniego położenia listy.

### Zmiany w wersji 2.37.46

- Przejście `TRASY -> preview` przewija teraz stronę automatycznie na sam początek po otwarciu podglądu wybranej trasy, dzięki czemu użytkownik zawsze startuje od górnej części widoku zamiast dziedziczyć pozycję scrolla z listy kafelków.

### Zmiany w wersji 2.37.45

- Ujednolicono ochronę dostępności dla hostów ukrywanych przez `aria-hidden`: systemowy modal, ekran ładowania oraz panel debuggera najpierw wyprowadzają fokus poza własny kontener, a dopiero potem przechodzą w stan ukryty i `inert`.
- Dodano współdzielony helper `js/core/focus-visibility.js`, który centralizuje bezpieczne przenoszenie fokusu, fallback na `body` oraz przełączanie `inert` dla overlayów i paneli.
- Rozszerzono testy regresyjne o scenariusz ukrywania `loading overlay` z aktywnym fokusem w środku, aby podobne ostrzeżenia ARIA nie wracały przy kolejnych zmianach.

### Zmiany w wersji 2.37.37

- Naprawiono dostępność systemowego modala synchronizacji Google Drive: podczas zamykania fokus jest teraz najpierw bezpiecznie przenoszony poza overlay, a dopiero potem host otrzymuje `aria-hidden`, co eliminuje ostrzeżenie przeglądarki o ukrywaniu aktywnego elementu.
- Zamknięcie drugiego modala podglądu różnic XLSX przywraca fokus do elementu, z którego został otwarty, dzięki czemu nawigacja klawiaturą pozostaje spójna po wyjściu z podglądu.
- Dodano test regresyjny dla kontrolera modala, weryfikujący że po zamknięciu fokus nie pozostaje wewnątrz ukrytego hosta.

### Zmiany w wersji 2.37.31

- Dopracowano finalną geometrię stref w kafelkach `KIEROWCY`: lewa sekcja z danymi ma teraz twardszy limit szerokości względem prawej kolumny, dzięki czemu separator nie nachodzi już na dłuższe nazwiska.
- Prawa strefa badge'y otrzymała równiej policzone oddechy względem separatora, prawej krawędzi i pionowych offsetów kafelka, co porządkuje pozycjonowanie kodów także przy dłuższych nazwach kierowców.

### Zmiany w wersji 2.37.26

- Dopracowano geometrię kafelków `KIEROWCY`, aby tekst kierowcy, pionowy glow separator i prawa kolumna badge'y miały stabilny bufor przestrzeni i nie wchodziły już na siebie nawet przy dłuższych nazwach.
- Kolor pionowego glow paska został przepięty na zmienne motywu: w ciemnym motywie korzysta teraz z niebieskiego akcentu zgodnego z aplikacją, a w jasnym z odpowiednio stonowanego wariantu dopasowanego do jego palety.

### Zmiany w wersji 2.37.20

- Widok kafelków `KIEROWCY` otrzymał subtelny, pionowy akcent typu glow pomiędzy strefą danych kierowcy a strefą badge'y, dzięki czemu prawa kolumna kodów jest czytelniej odseparowana bez ciężkiego wizualnie separatora.
- Hover kafelków kierowców został dopracowany w bardziej premium kierunku: pojawia się delikatny wewnętrzny highlight, lżejsza poświata i spokojniejsze podbicie całej bryły, przy zachowaniu lekkiego charakteru interfejsu.

### Zmiany w wersji 2.37.14

- Poprawiono finalny pixel-polish badge'y w kafelkach `KIEROWCY`: pionowy slot po prawej stronie ma teraz bezpieczny zapas wysokości dla dwóch kodów tego samego dnia, dzięki czemu badge'e nie nachodzą już na siebie.
- Zsynchronizowano animację hover kafelka kierowcy i jego badge'y: znaczniki kodów poruszają się teraz razem z kafelkiem jako jeden komponent, zamiast sprawiać wrażenie doklejonych osobno.

### Zmiany w wersji 2.37.8

- Dopracowano finalny układ badge'y w widoku `KIEROWCY`: kafelek pokazuje maksymalnie dwa dzisiejsze kody jak w `GRAFIKU`, osadzone wewnątrz po prawej stronie w stałych slotach narożnych (`prawy górny` i `prawy dolny`) zamiast w układzie zawijanym.
- Kod specjalny `UŻ` otrzymał własny, stonowany bordowy wariant kolorystyczny, spójny między widokami `GRAFIK` i `KIEROWCY`, aby wyraźnie odróżniał się od pozostałych markerów bez agresywnej jaskrawości.

### Zmiany w wersji 2.37.0

- Widok `KIEROWCY` pokazuje teraz w kafelkach komplet dzisiejszych kodów z `GRAFIKU`, a nie tylko pojedynczą trasę: renderowane są zarówno realne trasy, jak i kody specjalne typu `Z`, `UŻ`, `Dk`, `*D`, `*P`, z zachowaniem kolejności z komórki grafiku.
- Badge'e kodów w kafelkach kierowców zostały wizualnie ujednolicone z badge'ami z widoku `GRAFIK`: korzystają z tych samych kolorów kategorii tras oraz tego samego wariantu koloru dla markerów specjalnych; klik pozostaje aktywny tylko dla prawdziwych tras.

### Zmiany w wersji 2.36.19

- Lekko poszerzono sam glyph ikony fullscreen w `GRAFIK`, aby premium wariant z narożnikami był odrobinę czytelniejszy bez zmiany rozmiaru przycisku.

### Zmiany w wersji 2.36.18

- Przywrocono pierwszy, bardziej abstrakcyjny wariant premium ikony fullscreen w `GRAFIK`, oparty na eleganckich naroznikach i subtelnym wewnetrznym detalu zamiast mini-ekranu playerowego.

### Zmiany w wersji 2.36.17

- Dodatkowo powiększono sam element `span.schedule-fullscreen-icon`, aby glyph niemal wypełniał przycisk fullscreen i był lepiej czytelny także w małym toolbarze.

### Zmiany w wersji 2.36.16

- Dopracowano finalny wygląd przycisku fullscreen w `GRAFIK`: ikony zostały dodatkowo powiększone, a wariant `Włącz pełny ekran` otrzymał strzałki skierowane na zewnątrz. W trybie pełnoekranowym ukrywany jest również przycisk `Powrót`, aby header był czystszy i spójny z overlayowym charakterem widoku.

### Zmiany w wersji 2.36.15

- Ujednolicono oba stany ikony fullscreen w `GRAFIK`: wariant `Włącz pełny ekran` korzysta teraz z tego samego stylu mini-ekranu co `Wyłącz pełny ekran`, ale ze strzałkami skierowanymi w przeciwną stronę. Dodatkowo sam glyph został istotnie powiększony, aby lepiej wypełniał przycisk.

### Zmiany w wersji 2.36.14

- Przebudowano ikonę fullscreen w `GRAFIK`, aby była bliższa estetyce nowoczesnych playerów wideo: przycisk pokazuje teraz mini-ekran z wyraźniejszym symbolem wejścia/wyjścia z pełnego ekranu zamiast abstrakcyjnych narożników.

### Zmiany w wersji 2.36.13

- Dopracowano ikonę przełącznika pełnego ekranu w `GRAFIK`, nadając jej bardziej premium wygląd inspirowany nowoczesnymi playerami wideo oraz czytelniejszy stan aktywny po wejściu w fullscreen.
- Naprawiono mobilne odstępy boczne widoku `GRAFIK`: toolbar i kontener tabeli korzystają teraz z równego, minimalnego guttera po obu stronach, bez dziedziczenia desktopowego breakouta powodującego krzywe marginesy.

### Zmiany w wersji 2.36.12

- Zastąpiono tekstowy przycisk `Full-Screen` ikonowym przyciskiem z zachowaniem dostępności przez `aria-label`, `title` oraz wizualny stan aktywności po wejściu w pełny ekran.
- Doprecyzowano zachowanie przycisku `Powrót` w widoku `GRAFIK`: przed przejściem wstecz aplikacja automatycznie opuszcza fullscreen, tak samo jak po naciśnięciu `Esc`.

### Zmiany w wersji 2.36.11

- Dodano przycisk `Full-Screen` w sekcji statusu widoku `GRAFIK`. Przycisk przełącza cały widok grafiku do natywnego trybu pełnego ekranu, obejmującego zarówno header, jak i tabelę, oraz synchronizuje swój stan po kliknięciu, `Esc` i ręcznym wyjściu z fullscreena.
- Dopasowano style fullscreen dla `GRAFIK`: w trybie pełnoekranowym toolbar rozciąga się na całą szerokość widoku, a tabela przejmuje pozostałą wysokość bez dodatkowego breakouta względem viewportu.

### Zmiany w wersji 2.36.10

- Uproszczono strojenie desktopowego oddechu tabeli `GRAFIK`: boczny gutter został przeniesiony do jednej zmiennej CSS `--schedule-table-gutter`, która jednocześnie steruje szerokością breakouta i odsunięciem tabeli od lewej/prawej krawędzi viewportu.

### Zmiany w wersji 2.36.9

- Skorygowano sposób rozszerzania tabeli w `GRAFIK` na desktopie: kontener tabeli korzysta teraz z breakouta liczonego względem viewportu, dzięki czemu rozciąga się symetrycznie od lewej do prawej strony okna zamiast wizualnie „uciekać” tylko w jedną stronę.

### Zmiany w wersji 2.36.8

- Skorygowano finalny layout `GRAFIK`: przycisk `Powrót` znów pozostaje przy lewej krawędzi swojej sekcji, podczas gdy pozostałe elementy nawigacyjne zachowują wyśrodkowanie.
- Desktopowy kontener samej tabeli został dodatkowo odblokowany szerokościowo względem wrappera widoku, dzięki czemu może realnie rozciągać się prawie na cały viewport z niewielkim bocznym marginesem.

### Zmiany w wersji 2.36.6

- Dopracowano układ `GRAFIK` zgodnie z finalnym pixel-polish: sam kontener tabeli rozciąga się teraz szerzej niż toolbar i podchodzi niemal pod krawędzie viewportu, zachowując tylko niewielki boczny oddech.
- Wycentrowano etykiety filtrów oraz wskazane rzędy/sekcje toolbaru (`wybór miesiąca`, nawigacja dnia i grupy filtrów), aby układ był bardziej symetryczny na desktopie.
- Na mobile przywrócono `Powrót` w postaci małej ikony w rogu, bez cofania wcześniejszego uproszczenia toolbaru.

### Zmiany w wersji 2.36.1

- Logika rejestracji pojazdów w widoku `KIEROWCY` została przebudowana pod historię wszystkich arkuszy skoroszytu: serwis zaczyna od ostatniego arkusza, sprawdza wskazany dzień wstecz do `1`, a gdy zakres jest pusty, schodzi do starszych arkuszy i w każdym z nich szuka już od końca miesiąca do `1`, zwracając pierwszą napotkaną niepustą komórkę danego kierowcy.
- Parser rejestracji został zoptymalizowany pod nazwy arkuszy w formacie `<MIESIĄC> <ROK>`, dzięki czemu dokładniej wylicza długość miesiąca i buduje lżejszy indeks historii per kierowca/per arkusz zamiast fallbacku ograniczonego do jednego arkusza.

### Zmiany w wersji 2.36.0

- Badge kierowcy w podglądzie trasy dla konkretnego dnia stał się interaktywny: kliknięcie przenosi teraz do widoku `KIEROWCY`, przewija do odpowiedniej osoby, otwiera jej panel szczegółów i chwilowo podświetla właściwy kafelek.
- Desktopowy widok `GRAFIK` został ponownie zbalansowany pod szerokie ekrany: cały moduł jest centrowany w węższym kontenerze względem viewportu, tabela wykorzystuje maksymalnie dostępną szerokość tego obszaru, a toolbar ma czytelniejszy podział na trzy sekcje z szerszym środkiem i lepiej wyśrodkowaną akcją czyszczenia filtrów.
- Mobilny widok `GRAFIK` został uproszczony pod małe ekrany: nazwy kierowców są skracane do formatu `Nazwisko I.`, komórki i badge'e mają mniejszy footprint, a górny toolbar ukrywa sekcję statusu oraz rząd nawigacji dnia, zostawiając tylko wybór miesiąca i filtry.

### Zmiany w wersji 2.35.0

- Widok `KIEROWCY` przestał używać testowych numerów rejestracyjnych: dane pojazdów są teraz pobierane z osobnego pliku Google Drive z rejestracjami, parser analizuje wyłącznie ostatni arkusz skoroszytu, a gdy komórka dla bieżącego dnia jest pusta, automatycznie przejmuje ostatnią wcześniejszą, znaną rejestrację tego samego kierowcy w danym miesiącu.
- W kafelkach kierowców pojawił się mały badge z dzisiejszą trasą wyprowadzoną z `GRAFIK`; badge jest klikalny i otwiera bezpośrednio podgląd odpowiadającej trasy, jeśli plik źródłowy istnieje lokalnie po synchronizacji.
- Wspólna synchronizacja Google Drive została rozszerzona o trzeci pojedynczy plik pomocniczy obok kontaktów kierowców: aplikacja wykrywa zmiany oraz lokalne usunięcia także dla pliku rejestracji pojazdów i odświeża jego cache tym samym torem co grafik oraz kontakty.

### Zmiany w wersji 2.34.58

- Wybór miesiąca w `GRAFIK` działa teraz jako pełny custom dropdown na tej samej architekturze i w tym samym stylu listy co filtr kierowców, zamiast pozostawać pół-krokiem opartym o natywny `select`.
- Wszystkie trzy kontrolki dropdownów w `GRAFIK` otrzymały subtelniej animowane strzałki typu chevron morph, dzięki czemu otwieranie i zamykanie wygląda płynniej niż prosty obrót o `180deg`.
- Poświata focusa dla wyboru grafiku znów obejmuje całe pole razem z prawym segmentem przycisku strzałki, a sam trigger miesiąca korzysta z tego samego wrappera focus/hover/open co filtry.

### Zmiany w wersji 2.34.57

- Pole wyboru miesiąca w `GRAFIK` zostało wizualnie ujednolicone z dropdownami filtrów: korzysta z tego samego podziału na główną część kontrolki i prawy segment ze strzałką oraz z tej samej wspólnej poświaty focusa dla całego wrappera.

### Zmiany w wersji 2.34.56

- Filtr `TRASA / SYMBOL` w `GRAFIK` rozróżnia teraz dwa tryby dopasowania: ręczne wpisywanie w polu działa jako `zawiera`, natomiast wybór badge z custom dropdownu przełącza filtr na dopasowanie dokładne `1:1`.
- Dzięki temu wpisanie `K` nadal może wyszukiwać fragmenty tekstu, ale kliknięcie badge `K` w dropdownie nie podświetla już kodów takich jak `Dk`, które zawierają tylko część tego znaku.

### Zmiany w wersji 2.34.55

- Usunięto regresję po wdrożeniu custom dropdownów w `GRAFIK`: `app.js` ponownie pobiera komplet nowych referencji DOM potrzebnych do inicjalizacji kontrolera grafiku, dzięki czemu widok nie zatrzymuje się już na `Ładowanie grafiku...`.
- Usunięto regresję w widoku `TRASY`: kafelki tras nie przechodzą już przez deduplikację przeznaczoną wyłącznie dla modeli kierowców, więc pełna lista wraca i pozostaje klikalna.
- Dropdowny filtrów w `GRAFIK` dostały mocniejszą warstwę `z-index` i izolację toolbaru, dzięki czemu rozwijane menu nie chowa się już pod sticky tabelą grafiku.

### Zmiany w wersji 2.34.54

- Naprawiono styl komórki na przecięciu zaznaczonego wiersza i zaznaczonej kolumny w `GRAFIK`: akcent przecięcia ma teraz własny, wyraźniejszy fill i nie jest już gaszony przez mocniejsze selektory zwykłych zaznaczeń.
- Filtry kierowców i tras w `GRAFIK` zostały przebudowane z natywnych pól/datalist do własnych custom dropdownów z przyciskiem rozwijania, absolutnie pozycjonowanym menu i możliwością zarówno ręcznego wpisywania tekstu, jak i wyboru gotowej opcji.
- Dropdown trasy/symbolu renderuje sekcje `Standard`, `Wieczorki`, `Soboty`, `Niedziele` i `Kody specjalne`, wykorzystując mniejsze badge'e wizualnie spójne z samym grafikiem; dropdown kierowców pokazuje aktualnie dostępnych kierowców dla bieżącego widoku.

### Zmiany w wersji 2.34.45

- Badge'e tras bez pliku źródłowego w `GRAFIK` zachowują teraz dokładnie ten sam styling wizualny co zwykłe badge'e tras; pozostają nieaktywne wyłącznie logicznie, bez natywnego efektu wyszarzania przeglądarki.
- Badge'e kodów specjalnych w grafiku zostały delikatnie wyróżnione śliwkowym tłem i borderem, aby lepiej odróżniać statusy od tras bez zaburzania spójności dark/light theme.
- Komórka na przecięciu zaznaczonego wiersza i kolumny korzysta teraz z mocniejszego tła bez dodatkowych krawędzi zaznaczenia, dzięki czemu przecięcie nie znosi akcentów i czytelniej odróżnia się od pojedynczego zaznaczenia.

### Zmiany w wersji 2.34.36

- UI widoku `GRAFIK` dostał dopracowanie komórek i badge'y: puste komórki z `—` są wyśrodkowane, wszystkie badge'e mają wspólny footprint, zostały lekko powiększone i nie pokazują już separatora `/` między tokenami.
- Badge'e grafiku mają teraz stałą szerokość z obcinaniem `...` dla dłuższych kodów oraz pełnym tooltipem, a kody informacyjne korzystają z tego samego rozmiaru co zwykłe trasy.
- Zaznaczenie wybranego kierowcy zostało wzmocnione do poziomu porównywalnego z zaznaczeniem kolumny dnia, usunięto nierówności wynikające z zebra-stripingu oraz wyrównano obrys zaznaczonego nagłówka dnia do szerokości reszty kolumny.
- Pasek `Wybrano: ...` w toolbarze grafiku lepiej dopasowuje się do szerokości kontenera i nie powinien już wypychać układu na mobile.

### Zmiany w wersji 2.34.27

- Parser widoku `GRAFIK` rozróżnia teraz jawnie kody informacyjne `Z`, `UŻ`, `Dk`, `*D`, `*P` od prawdziwych tras: kody pozostają widoczne w komórkach jako informacja, ale nie tworzą przypisań trasa→kierowca i nie są klikalne.
- Komórki mieszane, np. `12 / *P` lub `H Z`, zachowują jednocześnie aktywną trasę i pasywny kod informacyjny, dzięki czemu przypisania liczą tylko realne trasy, a kod specjalny nadal jest widoczny w grafiku.
- Wpisy tras nieistniejących jeszcze jako plik na dysku, np. `REN`, są nadal pokazywane i biorą udział w przypisaniach kierowców w grafiku, ale pozostają nieklikalne do czasu pojawienia się odpowiadającego pliku źródłowego.

### Zmiany w wersji 2.34.17

- Widok `KIEROWCY` normalizuje teraz nazwy osób przed budową listy i kafelków, dzięki czemu warianty tego samego wpisu z różnych grafików, takie jak `Adam`, `adam`, `Adam (-2)` czy `Adam---`, są traktowane jako jedna osoba i renderowane jako pojedynczy kafelek z kanoniczną etykietą.
- Wspólna normalizacja nazw kierowców została spięta między grafikiem, dopasowaniem kontaktów i renderowaniem kafelków: usuwa dopiski w nawiasach, znaki specjalne, cyfry, nadmiarowe separatory i różnice wielkości liter, pozostawiając spójną postać prezentacyjną.

### Zmiany w wersji 2.34.8

- Widok `GRAFIK` zachowuje teraz stan UI przy powrocie tylko wtedy, gdy użytkownik wraca z ekranu otwartego bezpośrednio z grafiku: odtwarzane są miesiąc, filtry, zaznaczony dzień, zaznaczony kierowca oraz dokładna pozycja scrolla tabeli.
- Dropdown wyboru grafiku korzysta z etykiet wyprowadzonych z nazw zaimportowanych plików grafiku (`MIESIĄC ROK`), ma przebudowany układ z osobnym rzędem nawigacji dnia oraz bardziej dopasowany styling dark/glass.
- Tooltipy markerów grafiku ponownie pokazują znaczenia skrótów z `SCHEDULE_MARKER_MEANINGS`, również przy różnych wariantach wielkości liter kodu.
- Synchronizacja Google Drive wykrywa i importuje wszystkie pliki grafiku dostępne w folderze grafiku, zamiast ograniczać się do miesiąca bieżącego; sam widok nadal domyślnie otwiera bieżący miesiąc, jeśli jest dostępny.
- Filtrowanie tras w grafiku mocniej przytłumia niedopasowane badge'e, a pola filtrów używają tej samej domyślnej typografii co główny pasek wyszukiwania aplikacji.

### Zmiany w wersji 2.34.0

- Widok `GRAFIK` został przebudowany do logicznego komponentu `ScheduleGrid`, który zachowuje układ tabeli inspirowanej Excelem, ale porządkuje stan UI, renderowanie, zaznaczanie dnia, zaznaczanie kierowcy, filtrowanie oraz automatyczne przewijanie do wybranej kolumny.
- Toolbar grafiku otrzymał nowy układ dark/glassmorphism z wyborem miesiąca, strzałkami dnia, akcją `Dziś`, informacją o wybranym dniu, filtrem kierowcy, filtrem trasy/symbolu i szybkim czyszczeniem filtrów.
- Tabela grafiku ma teraz dopracowany sticky header i sticky pierwszą kolumnę z pełnym tłem, separatorem oraz poprawionym `z-index`, dzięki czemu kolumna kierowców nie przepuszcza już przewijanego contentu spod spodu.
- Zaznaczenie dnia i kierowcy zostało wizualnie złagodzone: aktywna kolumna używa delikatnej ramki i subtelnego tła, wybrany wiersz nie niszczy badge'y tras, a przecięcie wiersza i kolumny dostaje mocniejszy akcent.
- Weekendy, badge tras i scrollbary w widoku grafiku zostały wystylowane pod spójny dark/light glass dashboard look oraz poprawiono responsywność mobilną, w tym zwijanie toolbaru, węższe kolumny i lepsze ellipsis dla nazw kierowców.

### Zmiany w wersji 2.33.54

- Cofnięto wyłącznie wcześniejsze zmiany responsywności welcome screenu, przywracając oryginalne zachowanie centrowania, wysokości grafiki i bazowych stylów tekstów na tym ekranie.
- Zachowano pozostałe poprawki logotypu, w tym dopracowane maskowanie ringu `Q`.

### Zmiany w wersji 2.33.52

- Przywrócono centralny układ welcome screenu i mniej elastyczną wysokość grafiki, a ochronę przed kolizją tekstów z logo przeniesiono na ograniczenie szerokości, rezerwację wysokości i łagodniejsze skalowanie tekstów w niskich viewportach.
- Dopracowano maskowanie ringu `Q`: szczelina wycinana przy igle została poszerzona tak, aby była bliższa odstępowi między trójkątami kierunków świata a zewnętrzną krawędzią ringu.

### Zmiany w wersji 2.33.48

- Ujednolicono rdzeń logo między headerem i welcome screenem: oba warianty korzystają teraz z tej samej geometrii sygnetu, napisu i zębatki, a wariant welcome dokłada wyłącznie dekoracje tła.
- Poprawiono responsywność ekranu powitalnego: grafika ma bardziej elastyczną wysokość, a teksty `welcome-text` i `loading-status-text` są ograniczane szerokością i skalowane w niskich viewportach oraz w poziomym układzie mobilnym, dzięki czemu nie nachodzą na logo.
- Wzmocniono widoczność sygnetu w jasnym motywie przez mocniejszy kontrast palety logo, wyraźniejszy obrys i cień.

### Zmiany w wersji 2.33.44

- Uproszczono sygnet `Q` zgodnie z nową koncepcją: igła kompasu została obrócona o 90 stopni względem poprzedniego wariantu i przejęła rolę ogonka litery `Q`, a osobny biały ogonek i niebieski prawy segment zostały usunięte.
- Domknięto biały ring kompasu w miejscu po dawnym ogonku oraz dosunięto zębatkę `o` w wariancie welcome bliżej napisu `Ev`, tak aby układ był spójniejszy z logo w głównym ekranie aplikacji.

### Zmiany w wersji 2.33.40

- Proceduralnie strojoną geometrię sygnetu `Q` zastąpiono ręcznie kontrolowanymi ścieżkami SVG: osobno rysowany jest biały ring z wycięciami, trójkąty stron świata, większy niebieski segment wschodni oraz większy ogonek litery `Q`.
- Geometria lockupu została delikatnie skorygowana po ręcznej przebudowie sygnetu, a zębatka `o` korzysta teraz z większego otworu wewnętrznego przy zachowaniu zwartej zewnętrznej bryły.

### Zmiany w wersji 2.33.32

- Sygnet `Q` został przerysowany od zera jako zestaw osobnych elementów: biały ring z mocniejszymi wycięciami, symetryczna niebieska igła, większy wschodni segment oraz znacznie wyraźniejszy ogonek w prawym dolnym rogu.
- Zachowano dopracowaną zębatkę `o`, większy otwór wewnętrzny oraz wcześniejszą blokadę zaznaczania tekstu i SVG logo.

### Zmiany w wersji 2.33.28

- Sygnet `Q` został przebudowany według szkicu: usunięto niebieską kropkę ze środka, dodano kontrolowane pełne przerwy w białym ringu, powiększono romboidalny ogonek w prawym dolnym rogu oraz narysowano nowy wschodni segment z własnym trójkątnym zakończeniem.
- Zębatka `o` zachowała zewnętrzną bryłę, ale otrzymała większy otwór wewnętrzny, aby lepiej odpowiadać referencji.
- Zachowano blokadę zaznaczania tekstu i SVG logo, aby logotyp nadal był odbierany jako grafika, a nie selekcjonowalny napis.

### Zmiany w wersji 2.33.24

- Doprecyzowano kluczowe kształty logotypu na podstawie screenshotów referencyjnych: niebieska igła kompasu ma teraz symetryczną długość w obu kierunkach, wschodni segment sygnetu został wyraźniej wydzielony jako osobny niebieski element z własnym punktem kierunkowym, a romboidalny ogonek litery `Q` w prawym dolnym rogu jest większy i czytelniejszy.
- Zwiększono odstęp między sygnetem `Q` a napisem `uick`, obniżono koło zębate `o` względem `Ev` oraz przebudowano zęby zębatki tak, aby były krótsze i grubsze.
- Zablokowano możliwość zaznaczania tekstu i elementów SVG logo, aby logotyp zachowywał się jak nierozłączna grafika, a nie zwykły tekst w interfejsie.

### Zmiany w wersji 2.33.20

- Dopracowano geometrię sygnetu `Q`: zwiększono odstęp między kompasem a `uick`, przywrócono regularny dolny trójkąt południa zgodny z górnym i lewym punktem oraz dodano wyraźniejszy, osobny ogonek `Q` w prawym dolnym rogu sygnetu.
- Przebudowano końcowe `o` w `QuickEvo`: zęby zębatki są teraz krótsze i wyraźnie grubsze, dzięki czemu bliżej odpowiadają referencji PNG.

### Zmiany w wersji 2.33.18

- Logotyp QuickEvo przeszedł ultra-precyzyjną iterację pod referencje `assets/Logo_02.png` i `assets/Logo_04.png`: sygnet jeszcze mocniej imituje literę `Q`, a wordmark renderuje już wyłącznie `uickEv`, dzięki czemu pierwsza litera jest tworzona wyłącznie przez kompas.
- Dopracowano mikro-kerning i proporcje lockupu: przesunięto `uick`, zwężono relację `Ev`, zmniejszono oraz dosunięto zębatkę pełniącą rolę `o`, aby układ był bliższy oryginalnym PNG.
- W jasnym motywie akcent loga korzysta z ciepłego, przygaszonego brązu spójnego z resztą interfejsu, a welcome screen zachowuje płynne, bezszwowe animacje linii z liniowym przepływem `stroke-dashoffset` oraz gęstszy układ dekoracyjnych ścieżek i punktów.

### Zmiany w wersji 2.33.14

- Drugi modal podglądu różnic `.xlsx` został przebudowany wizualnie na bardziej czytelny diff view inspirowany IDE, bez zmiany logiki importu i bez ingerencji w pozostałe modale.
- Podgląd różnic XLSX udostępnia teraz dwa przełączane widoki: `Lista` (domyślna przy pierwszym otwarciu, fallback tabelaryczny ze sticky headerem) oraz `Side by side`.
- Warstwa prezentacji diffu otrzymała helpery normalizacji i formatowania wartości komórek: ignorowanie zmian sprowadzających się wyłącznie do spacji/trimu, spójne traktowanie pustych wartości, bardziej odporne rozpoznawanie godzin zapisanych w Excelu jako ułamki doby (np. `0.3541666666666667` -> `8:30`) oraz wykrywanie znanych nagłówków kolumn tras dla widoku `Lista` (`Nr. pół`, `Godzina`, `Adres`, `Nazwa placówki`, `Uwagi`) z pominięciem pierwszej komórki zawierającej nazwę trasy; dopasowanie aliasów toleruje teraz warianty z/bez kropek, z/bez polskich znaków i typowe skróty typu `godz`, `godz.`, `nr pol`, `numer półki`.
- Style diff modala zostały oparte o nowe zmienne CSS zintegrowane z istniejącym systemem theme, dzięki czemu akcenty `Dodane` / `Usunięte` / `Zmienione` zachowują spójność w dark i light theme.

### Zmiany w wersji 2.32.20

- Logotyp QuickEvo został dopracowany jeszcze bliżej referencji `assets/Logo_02.png` i `assets/Logo_04.png`: sygnet na początku pełni teraz wizualnie funkcję litery `Q`, więc wordmark nie renderuje już osobnej litery `Q`; dodatkowo doprecyzowano kerning `uick` / `Ev` oraz pozycję i skalę zębatki pełniącej rolę `o`.
- W jasnym motywie akcent loga został przełączony z niebieskiego na ciepły, przygaszony brąz zgodny z resztą interfejsu (`--primary-color` i pokrewne odcienie), dzięki czemu logo lepiej integruje się z przełącznikami, nagłówkami i akcentami UI.
- Animacje dekoracyjnych linii na ekranie powitalnym zostały przebudowane pod płynne, bezszwowe zapętlenie z liniowym przepływem `stroke-dashoffset`; dodatkowo zagęszczono część ozdobnych ścieżek i punktów, aby pełniejszy wariant welcome był bliższy kompozycji z PNG.

***

## Funkcjonalności

### Wyszukiwanie

- Wyszukiwanie rozmyte (fuzzy matching) z wykorzystaniem odległości Levenshteina
- Predykcyjne podpowiedzi inline (ghost only) podczas pisania z nawigacją klawiaturą (Tab/Enter/→/Esc/strzałki); gdy istnieje więcej niż jedna sugestia, obok ghosta pojawia się dyskretny i klikalny hint `↑↓`, przydatny także na mobile; hint i ghost pozostają widoczne po utracie fokusu, a przewijanie myszą nie przesuwa poziomo pola wyszukiwania; podpowiedzi ignorują nazwy tras
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
- Obsługa osobnego pliku kontaktów kierowców z Google Drive: parser wykorzystuje kolumny `B=PRACOWNIK`, `C=NR TELEFONU` oraz opcjonalnie `D=dopisek roli`, normalizuje nazwy, sprawdza bezpieczne warianty kolejności członów (`Imię Nazwisko` / `Nazwisko Imię`), potrafi zwrócić wiele numerów dla jednego kierowcy i klasyfikuje role specjalne (`szef`, `kierownik`, `koordynator`, `dyspozytor`)
- Obsługa osobnego pliku rejestracji kierowców z Google Drive: parser czyta wyłącznie ostatni arkusz skoroszytu, zakłada układ identyczny jak w grafiku (`A=IMIE I NAZWISKO`, kolejne kolumny = dni miesiąca), dobiera rejestrację po znormalizowanej nazwie kierowcy i dla pustego bieżącego dnia cofa się do ostatniej wcześniejszej, znanej rejestracji w tym samym miesiącu
- API `schedule-service` umożliwia wydajne przeglądanie grafiku miesiąca (lista dni, lista tras, kierowcy per trasa/dzień) na podstawie cache `byIsoDate`, dat ISO (YYYY-MM-DD) oraz dynamicznego katalogu tras zbudowanego z plików zsynchronizowanych z Google Drive
- Wspólny mechanizm synchronizacji Google Drive (trasy + grafik + kontakty kierowców + rejestracje kierowców) z jednym modalem zmian, listą nieaktualnych plików i powodami zmian; wykrywa także pliki usunięte z Google Drive, oznacza je jako wymagające lokalnego skasowania i przed wykonaniem pokazuje dodatkowe potwierdzenie; synchronizacja uruchamiana ręcznie; kolejne kliknięcie podczas trwającej synchronizacji jest kolejkowane i uruchamiane automatycznie po zakończeniu bieżącej sesji
- Rozwijalne kafelki zmian w oknie synchronizacji Google Drive + szybkie „Rozwiń/Zwiń wszystko”
- Lazy podgląd różnic XLSX dla zmodyfikowanych plików: przycisk `Pokaż różnicę` otwiera drugi modal 80vw/80vh nad głównym oknem synchronizacji, porównuje lokalny `Blob` z IndexedDB z nowym `ArrayBuffer` z Google Drive i pokazuje grupowany diff komórek z przełączanymi widokami `Lista` / `Side by side`, bez nadpisywania danych
- Niestandardowy pasek przewijania w oknie zmian Google Drive (premium overlay, pełna funkcjonalność przewijania)
- Trwałe przechowywanie w IndexedDB (dane lokalne; bez wysyłania na serwer)

### Interfejs

- Animacje wejścia/wyjścia wyników z efektem staggered
- Zreorganizowany header: nawigacja w jednej linii oraz pojedyncza akcja synchronizacji Google Drive dla lepszej czytelności
- Płynniejszy powrót z podglądu trasy do listy wyników (bez zbędnego ponownego renderowania wyników przy niezmienionym zapytaniu)
- Obsługa reduced motion (wyłączenie animacji dla użytkowników z wrażliwością na ruch)
- Responsywny design z obsługą urządzeń mobilnych
- Widoki aplikacji i nawigacja: TRASY, KIEROWCY, GRAFIK + ekran wyszukiwania/podglądu pliku
- Główna nawigacja `TRASY` / `KIEROWCY` / `GRAFIK` działa jak toggle sekcji: pierwsze kliknięcie otwiera widok, a ponowne kliknięcie aktywnego przycisku zamyka sekcję i wraca do ekranu wyszukiwania z paskiem inputu
- Ekran `KIEROWCY` z interaktywnymi kafelkami: nad główną sekcją kierowców pojawiają się segmenty ról specjalnych (`Szef`, `Kierownik`, `Koordynator`, `Dyspozytor`) bez podziału alfabetycznego, z kafelkami wyświetlanymi obok siebie; osoby przypisane do tych segmentów są wykluczane z głównej sekcji kierowców; lista zwykłych kierowców pozostaje sortowana alfabetycznie po nazwisku z grafiku i dzielona na sekcje literowe `A/B/C...`; przed renderem działa wspólna normalizacja i deduplikacja nazw kierowców, więc warianty z nawiasami, znakami specjalnymi, nadmiarem spacji lub inną wielkością liter nie tworzą już wielu kafelków tej samej osoby; kafelki mają lewostronne wyrównanie, rozbijają nazwę na osobne wiersze nazwisko/imiona i dobierają wspólną szerokość per sekcja bez łamania słów w środku; pod nazwą kierowcy pokazują komplet dzisiejszych kodów z `GRAFIKU` (trasy i kody specjalne) w tej samej kolorystyce co sam widok `GRAFIK`, a klik na prawdziwej trasie otwiera od razu jej podgląd; badge kierowcy w podglądzie trasy potrafi wykonać nawigację zwrotną do konkretnego kafelka; panel szczegółów otwiera się wyłącznie po kliknięciu kafelka, obsługuje wiele numerów telefonu z ikonami akcji, skrócony badge roli specjalnej i pole `POJAZD`, którego wartość pochodzi już z osobnego pliku rejestracji Google Drive z fallbackiem do ostatniej znanej rejestracji w miesiącu, a ponowny klik w aktywny kafelek zwija panel z animacją
- Widok `GRAFIK` ma dwa wyraźnie różne profile responsywne: na desktopie działa w centrowanym, bardziej premium kontenerze z szerszym środkiem toolbaru, a na mobile upraszcza nazwiska, ogranicza rozmiary komórek i ukrywa wtórne elementy toolbaru, aby maksymalnie oddać miejsce samej tabeli.
- Ekran `GRAFIK` do swobodnego przeglądania harmonogramu w formie nowoczesnego data-gridu z zachowaniem układu arkusza: sticky header dni, sticky kolumna kierowców, wybór dnia i kierowcy, filtrowanie po kierowcy i trasie/symbolu, akcja `Dziś`, subtelne weekendy oraz klikalne badge'e tras otwierające podgląd w kontekście wybranej daty; kody informacyjne `Z`, `UŻ`, `Dk`, `*D`, `*P` pozostają widoczne, ale nie są traktowane jak trasy i nie są klikalne, a wpisy tras bez pliku źródłowego (np. `REN`) są renderowane jako nieaktywne badge'e
- Ekran powitalny z efektem glassmorphism
- Dwa warianty logotypu QuickEvo: lekki w headerze i rozbudowany, dekoracyjny w ekranie powitalnym
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
│   │   ├── app.js       # Główny bootstrap aplikacji
│   │   └── dev-flags.js # Warunkowe doładowanie narzędzi developerskich
│   ├── app/             # Warstwa aplikacyjna (orchestracja use-case)
│   │   ├── search-application.js
│   │   ├── preview-application.js
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
│   │   ├── simple-xlsx-diff.js
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
│   │   │   ├── drive-changes-modal.js
│   │   │   └── xlsx-diff-modal.js
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
- Wbudowane testy automatyczne są doładowywane warunkowo przez `js/entry/dev-flags.js` i uruchamiane przez parametr URL (`?test=1` lub `?test=true`)

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
