# Plan i stan prac

Ostatnia aktualizacja: 2026-11-26

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
- [ ] Uzupełnić `CD_*` w nieśledzonym `web/.env`, wdrożyć migrację i sprawdzić pełny cykl obserwacji na VPS.
- [ ] Monitorować zmiany publicznego kontraktu strony ČD.

## Bieżąca zmiana: polskie nazwy stacji ČD i kurs NBP (2026-11-26)

- [x] Polskie znaki są akceptowane w zapytaniu stacji ČD; identyfikator i nazwa kanoniczna nie mieszają się z KOLEO.
- [x] Ceny ČD pokazują orientacyjne PLN z datowanym kursem średnim NBP; alerty i progi nadal są liczone w CZK.
- [x] Testy offline (57/57), lint, typecheck, build produkcyjny oraz test odczytu publicznej ceny ČD po wpisaniu polskiej nazwy stacji przechodzą.
- [ ] Użytkownik wdroży na VPS według README i sprawdzi pełny cykl. Połączenie SSH do skonfigurowanego `k.pl` (83.168.90.138:22) jest obecnie odrzucane.

## Bieżąca zmiana: diagnostyka ČD i podpowiedź w formularzu (2026-11-26)

- [x] Zastąpiono biały opis stacji ČD ikoną informacji z podpowiedzią dostępną myszą i klawiaturą.
- [x] Rozpoznano odmowę dostępu `DENY/last` w odpowiedzi ČD HTTP 200; użytkownik dostaje odrębny kod `cdAccessDenied`, bez ujawniania adresu źródłowego.
- [x] Dodano bezpieczne wpisy DEBUG dla etapów zapytania i odczytu odpowiedzi ČD oraz kod błędu w podstawowym logu wyszukiwania.
- [x] Udokumentowano przełączniki `LOG_LEVEL=debug` i `LOG_SHOW_CONTEXT=true` w `.env_conf` oraz sposób zebrania logów.
- [x] Lokalnie po końcowej zmianie: pełne testy offline 59/59, dodatkowy test przeglądarkowy ČD 2/2, lint, typecheck i build produkcyjny przechodzą.
- [ ] Użytkownik wdroży zmianę na VPS i sprawdzi wynik ponownie. Odmowa po stronie ČD może nadal ograniczać dostęp z IP serwera; aplikacja nie obchodzi tego ograniczenia.
