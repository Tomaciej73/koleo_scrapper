# Plan i stan prac

Ostatnia aktualizacja: 2026-11-25

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

## Walidacja

- [x] Pełny zestaw testów: 47/47 zaliczone.
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
- Skonfigurować monitoring `/health/ready`, `/health/worker` i `/metrics`.
- Po wdrożeniu sprawdzić listę aktywnych sesji, eksport danych i usuwanie konta na koncie testowym.
