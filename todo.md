# Plan i stan prac

Ostatnia aktualizacja: 2026-11-27

## Wykonane

- [x] Rozdzielono `/health/ready` (WWW i baza) od `/health/worker` (worker i kolejki).
- [x] Heartbeat jest aktualizowany także podczas długiego cyklu workera.
- [x] Dodano osobne metryki i regułę alarmową Prometheus dla workera oraz kolejek.
- [x] Zaktualizowano pakiety AdonisJS: Core, Auth, Lucid, Mail, Session, Shield i Limiter.
- [x] Dodano bezpieczne, ustrukturyzowane zdarzenia uwierzytelniania, resetu hasła i blokad rate limit.
- [x] Dane wrażliwe nie są zapisywane w zdarzeniach; adresy e-mail są maskowane.
- [x] Dodano retencję `alert_outbox` i `password_reset_deliveries`.
- [x] Dodano eksport danych użytkownika, usuwanie konta i listę aktywnych sesji.
- [x] Dodano możliwość wylogowania pojedynczej sesji i wszystkich pozostałych sesji.
- [x] Ograniczono konfigurowalnie liczbę obserwacji przetwarzanych w jednym cyklu workera.
- [x] Dodano globalny circuit breaker dla zapytań KOLEO.
- [x] Uzupełniono `.env.example`, lokalny `.env_conf`, Docker Compose, Dockerfile i README.
- [x] Dodano migrację tabeli sesji i włączono bazodanowy magazyn sesji w środowisku produkcyjnym.
- [x] Dodano oraz rozszerzono testy offline.
- [x] Dodano skorelowane logi startu, wyniku, pustego wyniku i błędu wyszukiwania połączeń.
- [x] Odpowiedź KOLEO `noConnectionsFound` jest obsługiwana jako pusty wynik, a nie awaria.
- [x] Usunięto angielski komunikat `No connections found.` z interfejsu WWW.
- [x] Ujednolicono czytelny format logów `web` i `worker` z poziomem, datą, godziną i kolorami.
- [x] Dodano przełączanie `pretty/json` oraz opcjonalny pełny kontekst diagnostyczny przez `.env_conf`.
- [x] Rozdzielono konfigurowalne kolory etykiet poziomu i treści komunikatu (`INFO` niebieski/biały, `WARN` żółty, `ERROR` czerwony).
- [x] Rozdzielono techniczne `TZ=UTC` od prezentacyjnego `APP_TIMEZONE=Europe/Warsaw` i dodano test godzin obserwacji.
- [x] Worker wybiera obserwowany kurs przed pobraniem ceny i współdzieli wyszukanie oraz cenę w jednym cyklu.
- [x] Circuit breaker liczy tylko błędy transportowe, timeouty oraz HTTP 408/429/5xx, nie błędne zapytania.
- [x] `/health/worker` korzysta z SQL `COUNT`/`MIN` zamiast wczytywać rekordy kolejek.
- [x] Dodano czytelne logi logowania i wyszukiwania z ID konta, datą i trasą; pełne dane osobowe są opcjonalne przez `AUDIT_LOG_PERSONAL_DATA`.
- [x] Raporty CSP pokazują naruszoną dyrektywę i zablokowane źródło nawet przy ukrytym kontekście logów.

## Walidacja

- [x] Pełny zestaw testów WWW: 54/54 zaliczone; 10/10 testów offline wrappera w poprzedniej walidacji.
- [x] `npm run typecheck` zaliczony.
- [x] `npm run lint` zaliczony.
- [x] `npm run build` zaliczony.
- [x] `npm audit` i `npm audit --omit=dev`: 0 podatności.
- [x] Migracja SQLite wykonana lokalnie; tabela sesji została utworzona.
- [x] `docker compose --env-file .env_conf config --quiet` zaliczony w WSL.
- [x] Obraz produkcyjny zbudowany w WSL i sprawdzony jako użytkownik `node` (`uid 1000`).
- [x] Testowy obraz Dockera usunięty po walidacji; nie utworzono kontenerów ani wolumenów testowych.

## W toku

- Brak.

## Przerwano / blokery

- Brak.

## Następne kroki wdrożeniowe

- Ustawić nowe zmienne w serwerowym `.env_conf` zgodnie z `.env.example` i README.
- Zbudować obrazy oraz uruchomić migrację, WWW i worker przez Docker Compose.
- Po wdrożeniu sprawdzić listę aktywnych sesji, eksport danych i usuwanie konta na koncie testowym.

## Bieżąca zmiana: publiczne ceny ČD (2026-11-26)

- [x] Dodano wybór KOLEO/ČD, podpowiedzi stacji, kursy i ceny CZK z publicznej wyszukiwarki.
- [x] Dodano migrację źródła obserwacji, wspólny worker i alerty zmian cen w odpowiedniej walucie.
- [x] Potwierdzono publiczny odczyt ceny ČD bez logowania; test offline i build WWW przechodzą.
- [ ] Uzupełnić `CD_*` w nieśledzonym `.env_conf`, wdrożyć migrację i sprawdzić pełny cykl obserwacji na VPS.
- [ ] Monitorować zmiany publicznego kontraktu strony ČD.

## Bieżąca zmiana: polskie nazwy stacji ČD i kurs NBP (2026-11-26)

- [x] Polskie znaki są akceptowane w zapytaniu stacji ČD; identyfikator i nazwa kanoniczna nie mieszają się z KOLEO.
- [x] Ceny ČD pokazują orientacyjne PLN z datowanym kursem średnim NBP; pierwotne progi CZK zostały później zastąpione progami PLN (sekcja poniżej).
- [x] Testy offline (57/57), lint, typecheck, build produkcyjny oraz test odczytu publicznej ceny ČD po wpisaniu polskiej nazwy stacji przechodzą.
- [ ] Użytkownik wdroży na VPS według README i sprawdzi pełny cykl. Połączenie SSH do skonfigurowanego `k.pl` (83.168.90.138:22) jest obecnie odrzucane.

## Bieżąca zmiana: diagnostyka ČD i podpowiedź w formularzu (2026-11-26)

- [x] Zastąpiono biały opis stacji ČD ikoną informacji z podpowiedzią dostępną myszą i klawiaturą.
- [x] Rozpoznano odmowę dostępu `DENY/last` w odpowiedzi ČD HTTP 200; użytkownik dostaje odrębny kod `cdAccessDenied`, bez ujawniania adresu źródłowego.
- [x] Dodano bezpieczne wpisy DEBUG dla etapów zapytania i odczytu odpowiedzi ČD oraz kod błędu w podstawowym logu wyszukiwania.
- [x] Udokumentowano przełączniki `LOG_LEVEL=debug` i `LOG_SHOW_CONTEXT=true` w `.env_conf` oraz sposób zebrania logów.
- [x] Lokalnie po końcowej zmianie: pełne testy offline 59/59, dodatkowy test przeglądarkowy ČD 2/2, lint, typecheck i build produkcyjny przechodzą.
- [ ] Użytkownik wdroży zmianę na VPS i sprawdzi wynik ponownie. ČD może nadal odrzucać inne zapytania; aplikacja nie obchodzi ograniczeń dostępu źródła.

## Bieżąca zmiana: działające wyszukiwanie całodzienne ČD (2026-11-26)

- [x] Odtworzono błąd: zapytanie bez godziny wysyłało `00:00`, dla którego ČD zwracało `DENY/last` mimo HTTP 200; ta sama trasa z późniejszą godziną dawała wyniki.
- [x] Wyszukiwanie bez godziny zaczyna się minutę przed wybraną datą i filtruje wyłącznie kursy z tej daty.
- [x] Obserwacja kursu z pierwszej godziny dnia również korzysta z zapytania rozpoczynającego się poprzedniego dnia.
- [x] Dodano pobieranie kolejnych stron publicznej listy ČD, deduplikację kursów oraz limit liczby stron `CD_SEARCH_MAX_PAGES`.
- [x] Test offline obejmuje kurs po północy, nakładające się strony i pojedyncze pobranie ceny dla każdego kursu.
- [x] Dobrowolny test sieciowy publicznej wyszukiwarki ČD przeszedł dla Brno hl.n. → Wrocław Główny, 27.11.2026, bez podanej godziny, przy `--timeout=30000`.
- [x] Po końcowej zmianie przeszły lint, typecheck, pełne testy offline 60/60 i build produkcyjny.
- [ ] Użytkownik wdroży nowy obraz na VPS, opcjonalnie ustawi `CD_SEARCH_MAX_PAGES=6` w `.env_conf` i potwierdzi wynik w aplikacji.

## Bieżąca zmiana: progi cenowe w PLN dla KOLEO i ČD (2026-11-26)

- [x] Pola progu w wyszukiwarce i obserwowanych są w PLN dla obu źródeł.
- [x] Dodano zapis waluty progu; migracja oznacza istniejące progi ČD jako CZK, aby nie zmienić ich znaczenia. Edycja zastępuje je progiem PLN.
- [x] Worker porównuje cenę ČD przeliczoną po kursie NBP z progiem PLN, zachowując oryginalne ceny i alerty zmian w CZK.
- [x] Lokalnie przeszły pełne testy offline 62/62 (w tym formularze, worker ČD i migracja istniejących progów), lint, typecheck oraz build produkcyjny; 13 migracji przeszło na czystej bazie testowej.
- [ ] Przed wdrożeniem wykonać kopię produkcyjnej bazy; po migracji potwierdzić oznaczenie istniejących progów ČD jako `CZK` i zapisać wybrany próg ponownie w PLN.
- [ ] Użytkownik wdroży zmianę na VPS i sprawdzi alerty progu PLN przy dostępnym kursie NBP.

## Bieżąca zmiana: przejście przez próg po zmianie kursu NBP (2026-11-27)

- [x] Worker pamięta poprzedni wynik porównania z progiem i wykrywa przejście z ceny PLN powyżej progu do ceny równej lub niższej, nawet bez zmiany ceny ČD w CZK.
- [x] Przy braku kursu NBP stan progu pozostaje bez zmian; przy migracji istniejącej obserwacji z wysłanym alertem pierwszy odczyt tylko inicjalizuje stan, aby nie wysłać duplikatu.
- [x] Historia istotnych odczytów przechowuje użyty kurs, datę i numer tabeli NBP, przeliczoną kwotę, próg oraz wynik porównania. Treść e-maila używa kursu z tego samego sprawdzenia.
- [x] Testy offline 63/63, lint, typecheck i build produkcyjny przeszły; nowy test obejmuje dwa przekroczenia progu, powtórny odczyt, chwilowy brak NBP i istniejącą obserwację po migracji.
- [ ] Wdrożyć migrację na VPS po wykonaniu kopii bazy i sprawdzić jeden pełny cykl zmiany kursu oraz widok historii.

## Bieżąca zmiana: favicon i tytuły stron (2026-11-27)

- [x] Dodano własny favicon SVG nawiązujący do znaku pociągu i kolorystyki aplikacji; jest używany w widokach publicznych, konta i po zalogowaniu.
- [x] Ujednolicono tytuły kart przeglądarki dla wyszukiwania, monitorowanych połączeń, konta, rejestracji, weryfikacji e-mail, odzyskiwania hasła i stron błędów.
- [x] Zmieniono widoczny nagłówek i nawigację z „Obserwowane” na „Monitorowane”.
- [x] Testy offline 64/64, lint, typecheck i build produkcyjny przeszły; favicon jest kopiowany do obrazu aplikacji.
- [ ] Po własnym wdrożeniu na VPS potwierdzić wygląd favicon i tytułów kart w przeglądarce; w razie starej ikony odświeżyć pamięć przeglądarki.

## Bieżąca zmiana: wiadomości HTML e-mail (2026-11-27)

- [x] Dodano wspólny szablon wiadomości z tabelowym układem i CSS inline oraz osobne widoki dla aktywacji konta, resetu hasła, potwierdzenia zmiany hasła, alertu cenowego i testu SMTP.
- [x] Zachowano wersje tekstowe; alert zawiera w obu wariantach odnośnik do monitorowanych połączeń.
- [x] Dodano testy renderowania HTML i escapowania niezaufanej treści alertu.
- [x] Lokalnie przeszły testy offline 65/65, lint, typecheck i build produkcyjny.
- [ ] Po wdrożeniu wysłać `mail:test` na własny adres i sprawdzić wygląd wiadomości w używanym kliencie pocztowym.

## Bieżąca zmiana: zwykły łącznik w tekstach (2026-11-27)

- [x] Zamieniono wszystkie wystąpienia znaku Unicode U+2014 w źródłach, widokach, tematach e-maili, testach i dokumentacji na zwykły znak `-` (U+002D).
- [x] Wyszukiwanie w repozytorium nie wykazuje pozostałych wystąpień U+2014; testy offline 65/65, lint, typecheck i build produkcyjny przeszły.
- [ ] Po wdrożeniu sprawdzić tytuły kart i tematy nowo wysyłanych e-maili; wiadomości wysłane wcześniej nie zmienią się.

## Bieżąca zmiana: alerty SMS (2026-11-27)

- [x] Dodano konfigurację bramki SMS Gateway for Android w `.env_conf`, przykładzie środowiska i Compose; domyślnie SMS pozostaje wyłączony.
- [x] Dodano potwierdzanie polskiego numeru kodem SMS po sprawdzeniu aktualnego hasła, limit prób, czas ważności, ograniczenie ponownego wysłania i rate limiting.
- [x] Użytkownik może wybrać e-mail, SMS lub oba kanały dla obserwacji KOLEO/ČD. Numer i adres pochodzą z potwierdzonych danych konta, nie z pól odbiorcy w formularzu.
- [x] Dodano osobny wpis `alert_outbox` dla każdego kanału, stabilny identyfikator SMS przy ponowieniach oraz limit wiadomości liczony dla obu kanałów.
- [x] Usunięcie numeru przestawia obserwacje na e-mail; interfejs maskuje numer.
- [x] Testy offline 72/72, lint, typecheck, build i `docker compose config --quiet` przez WSL przeszły.
- [ ] Użytkownik wdroży obraz na VPS, ustawi dane bramki w nieśledzonym `.env_conf`, skonfiguruje telefon i potwierdzi realną dostawę SMS na własny numer.
- [ ] Opcjonalnie dodać synchronizację końcowego statusu dostarczenia SMS z API bramki; obecne `sent` oznacza przyjęcie żądania przez bramkę.

## Bieżąca zmiana: jeden plik konfiguracji `.env_conf` (2026-11-27)

- [x] Scalono lokalne ustawienia aplikacji, Compose i sekrety z ignorowanego `web/.env` do ignorowanego `.env_conf`, bez zmiany istniejącego `APP_KEY`.
- [x] Compose montuje `.env_conf` jako jedyny plik środowiska aplikacji i używa go jako sekretu wyłącznie podczas budowania; usunięto powielone zmienne i argumenty budowania.
- [x] Polecenia lokalne ładują `.env_conf`; izolowane testy używają `web/.env.test`. Usunięto lokalny `web/.env` po sprawdzeniu przeniesienia wszystkich jego kluczy.
- [x] Uzupełniono README i AGENTS.md; `npm run dev`, build, lint, typecheck, 72/72 testów offline, `docker compose config --quiet` i próbny build obrazu przeszły bez `web/.env`. Próbny obraz usunięto.
- [ ] Na VPS zarchiwizować dotychczasowe pliki, przenieść brakujące sekrety z serwerowego `web/.env` do serwerowego `.env_conf`, ustawić `APP_ENV_FILE=./.env_conf` i dopiero po weryfikacji usunąć stary plik.

## Bieżąca zmiana: dostawca SMSAPI (2026-11-27)

- [x] Dodano wybór `SMS_PROVIDER=android|smsapi` bez zmiany istniejącego domyślnego dostawcy.
- [x] Dodano adapter SMSAPI dla `POST /sms.do` z tokenem API (zalecane) albo starszym loginem i 32-znakowym hasłem MD5, polem nadawcy, bezpiecznym parsowaniem odpowiedzi i timeoutem.
- [x] Zweryfikowano działający broker: jego biblioteka przyjmuje `smsApiClient` i zwykłe `smsApiPassword`, wylicza MD5 i uwierzytelnia się przez HTTP Basic. Dodano zgodne `SMSAPI_CLIENT` i `SMSAPI_PASSWORD` bez konieczności przygotowania MD5 przez użytkownika.
- [x] Dodano puste klucze SMSAPI do ignorowanego `.env_conf`; `SMS_ENABLED=false` pozostaje bez zmiany do czasu uzupełnienia danych i kontrolowanego testu. Testy offline 77/77, lint, typecheck, build i walidacja Compose przeszły.
- [x] Ponowienia używają stabilnego `idx` oraz `check_idx=1`; treść i dane uwierzytelniające nie trafiają do adresu URL ani komunikatów błędów.
- [x] Zaktualizowano przykład środowiska i README. Testy offline 75/75, lint, typecheck, build i kontrola konfiguracji Compose w WSL przeszły.
- [ ] Użytkownik musi uzupełnić po swojej stronie ignorowany `.env_conf` poprawnymi danymi SMSAPI, wdrożyć obraz i wykonać kontrolowany test na własnym numerze; nie wykonywano rzeczywistej wysyłki ani wdrożenia VPS.
- [ ] Opcjonalnie pobierać raport doręczenia SMSAPI; obecnie sukces oznacza tylko przyjęcie wiadomości przez API.
