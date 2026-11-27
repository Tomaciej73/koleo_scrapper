# AGENTS.md

## Zakres i charakter projektu

Te instrukcje obowiązują w całym repozytorium.

Projekt jest nieoficjalnym wrapperem ESM dla wewnętrznego API KOLEO. Nie jest
powiązany z KOLEO ani PKP. Kod został zaimportowany z projektu
`VEX-Systems/koleo` (`open-koleo`) i jest utrzymywany we własnym repozytorium.

## Od czego zacząć

1. Sprawdź `git status --short --branch` i nie naruszaj niezwiązanych zmian.
2. Przeczytaj `package.json`, `index.js`, `src/koleo.js` oraz moduł związany z
   zadaniem.
3. Traktuj kod jako źródło prawdy. `docs/API.md` może nie nadążać za zmianami.
4. Przed zmianą kontraktu sprawdź odpowiadające mu testy i wszystkich
   konsumentów.

## Mapa kodu

- `index.js` eksportuje domyślnie klasę `Koleo`.
- `src/koleo.js` udostępnia moduły: `brands`, `discounts`, `stations`,
  `connections`, `converters`, `types` i `user`.
- `src/modules/BaseModule.js` rozdziela zapytania publiczne i autoryzowane.
- `src/utils/formRequest.js` buduje zapytania HTTP i normalizuje błędy.
- `src/utils/createHeaders.js` buduje nagłówki klienta.
- `src/modules/connections.js` rozwiązuje nazwy stacji do slugów i ID, szuka
  połączeń oraz pobiera szczegóły i ceny.
- `tests/` używa wbudowanego `node:test`; część testów jest sieciowa.
- `web/` zawiera aplikację AdonisJS 7 z Edge, SQLite i uwierzytelnianiem.
- `web/app/services/connection_search_service.ts` rozdziela dostawcę `demo`
  od dostawcy `koleo`.
- `web/app/services/price_alert_service.ts` porównuje ceny obserwowanych
  połączeń, a `notification_service.ts` odpowiada za kanały dostarczenia.
- `web/commands/alerts_check.ts` wykonuje pojedynczą kontrolę, natomiast
  `web/commands/alerts_worker.ts` uruchamia proces cykliczny.
- `web/tests/unit/` i `web/tests/functional/` są offline i używają osobnej
  testowej bazy SQLite.

## Zasady implementacji

- Nie dodawaj danych konfiguracyjnych na sztywno. Istniejące stałe URL,
  nagłówków i klienta OAuth są długiem odziedziczonym z upstreamu. Gdy zmiana
  ich dotyczy, przenieś konfigurację do opcji klienta lub zmiennych
  środowiskowych, zachowując zgodność publicznego API.
- Nie dodawaj sztywnych ścieżek plików. Polecenia i kod mają działać względem
  katalogu repozytorium albo korzystać z jawnie przekazanej konfiguracji.
- Nie zapisuj w repozytorium haseł, tokenów, ciasteczek ani danych pasażerów.
  Nie wypisuj ich do logów i nie umieszczaj w komunikatach błędów.
- Zachowuj ESM (`type: module`) oraz jawne rozszerzenia `.js` w importach.
- Projekt nie ma zależności runtime; korzysta z globalnego `fetch`. Nie dodawaj
  biblioteki bez uzasadnionej potrzeby.
- Parametry zapytań koduj przez `URL`/`URLSearchParams`, a dane użytkownika
  waliduj przed wykonaniem żądania.
- Zachowuj istniejące nazwy metod i kontrakty błędów, chyba że zadanie jawnie
  obejmuje zmianę API. Zmiana kontraktu wymaga aktualizacji testów i
  dokumentacji.
- Nie zmieniaj konfiguracji `origin` ani repozytoryjnego aliasu SSH.
- Aplikacja WWW ma startować z `PRICE_PROVIDER=demo`, `ALERTS_ENABLED=false`
  i `MAIL_ENABLED=false`. Nie zmieniaj bezpiecznych wartości domyślnych.
- Jedynym lokalnym plikiem konfiguracyjnym do edycji jest ignorowany przez Git
  `.env_conf` w katalogu repozytorium. Docker Compose używa go do interpolacji
  i montuje ten sam plik do aplikacji; nie twórz odrębnego `web/.env`.
  `web/.env.example` jest wyłącznie pozbawioną sekretów dokumentacją kluczy,
  a `web/.env.test` izolowanym zestawem wartości testowych.
- Ścieżki bazy danych rozwiązuj względem katalogu aplikacji przez AdonisJS.
  Nie dodawaj bezwzględnych ścieżek do kodu ani konfiguracji.

## Dostęp do KOLEO i bezpieczeństwo

Oficjalny regulamin pod `https://koleo.pl/terms-of-use` w punkcie 1.6 zabrania
zautomatyzowanego dostępu do serwisu (stan sprawdzony 2026-11-16). Przed
jakimkolwiek testem integracyjnym sprawdź aktualny regulamin i wymagane zgody.

- Nie uruchamiaj domyślnie `npm test`: obecny zestaw wysyła prawdziwe zapytania
  do KOLEO, w tym próby logowania i zapytania z nieprawidłowym tokenem.
- Preferuj deterministyczne testy jednostkowe z zamockowanym `globalThis.fetch`.
- Nie wykonuj zakupu, logowania prawdziwym kontem ani innych operacji na danych
  użytkownika bez wyraźnego polecenia i potwierdzonego uprawnienia.
- Odpowiedzi z zewnętrznego API traktuj jako nieufne; obsłuż błędny JSON,
  timeout, przerwanie, limity i statusy inne niż 2xx.

## Weryfikacja bez dostępu do sieci

Minimalna walidacja składni wszystkich plików JavaScript w PowerShell:

```powershell
Get-ChildItem -Path . -Recurse -Filter *.js |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
    ForEach-Object { node --check $_.FullName }
```

Test modułu niewykonującego zapytań sieciowych:

```powershell
node --test tests/types.test.js
```

Każdy nowy test powinien być offline. Jeśli zadanie wymaga integracji, oddziel
ją od domyślnego zestawu testów i jasno opisz, jaki system zewnętrzny oraz jakie
dane zostaną użyte.

Walidacja aplikacji WWW:

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper\web'
npm run lint
npm run typecheck
node ace test --no-ansi
npm run build
```

## Stan importu

Na 2026-11-16 zawartość `src/`, `tests/`, `docs/`, `package.json` i `index.js`
była identyczna z upstreamowym commitem
`08dff65e7f72bcd2354e744f5cc339ccdcc9c4f0`. Przed poleganiem na tym fakcie
sprawdź upstream ponownie. Nie kopiuj zmian mechanicznie: oceń je pod kątem
lokalnych wymagań, konfiguracji, testów oraz regulaminu usługi.
