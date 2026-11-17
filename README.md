# Koleo Watch

Nieoficjalny klient API KOLEO oraz prosta aplikacja WWW do wyszukiwania
połączeń i obserwowania zmian cen.

## Co jest gotowe

- rejestracja z 6-cyfrowym kodem e-mail i logowanie użytkownika,
- formularz trasy z podpowiedziami i identyfikatorami stacji, zamianą kierunku,
  datą i opcjonalną godziną,
- sortowana lista połączeń z czasem przejazdu, przesiadkami, ceną i oznaczeniem
  przyjazdu następnego dnia,
- zapis połączenia do obserwowanych,
- pełna historia pomiarów ceny z wykresem oraz ostatnim błędem sprawdzania,
- edycja progu i interwału oraz pauza/wznowienie obserwacji,
- ręczne oraz cykliczne sprawdzanie alertów z osobnym interwałem dla każdej obserwacji,
- powiadomienia e-mail przez konfigurowalny serwer SMTP,
- przygotowane kanały SMS i WhatsApp, oczekujące na wybór dostawcy.

Aplikacja domyślnie działa w trybie `demo`: nie łączy się z KOLEO i generuje
deterministyczne wyniki, dzięki czemu interfejs oraz alerty można sprawdzić
bez zewnętrznych danych dostępowych.

## Uruchomienie w Windows PowerShell

Wymagane są Node.js 24 lub nowszy oraz npm 11 lub nowszy.

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper\web'
Copy-Item -LiteralPath '.env.example' -Destination '.env'
npm install
node ace generate:key
node ace migration:run
npm run dev
```

Następnie otwórz `http://localhost:3333`, utwórz konto i wyszukaj połączenie.
Jeżeli plik `.env` już istnieje, nie kopiuj go ponownie i nie nadpisuj klucza
`APP_KEY`.

## Test obniżki ceny bez dostępu do KOLEO

1. Zostaw `PRICE_PROVIDER=demo` w `.env` i zapisz wynik jako obserwowany.
2. Ustaw np. `DEMO_PRICE_OFFSET_CENTS=-1000` oraz `ALERTS_ENABLED=true`.
3. Uruchom jednorazowe sprawdzenie:

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper\web'
npm run alerts:check
```

Do stałego sprawdzania w osobnym procesie służy:

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper\web'
npm run alerts:worker
```

Worker budzi się co `ALERT_WORKER_TICK_SECONDS` i wybiera tylko obserwacje,
których termin sprawdzenia już nadszedł. Domyślny interwał nowej obserwacji
określa `ALERT_CHECK_INTERVAL_MINUTES`; użytkownik może go zmienić przy
dodawaniu połączenia albo później na ekranie obserwowanych. Dozwolony zakres
kontrolują `ALERT_MIN_CHECK_INTERVAL_MINUTES` i
`ALERT_MAX_CHECK_INTERVAL_MINUTES`. Proces workera trzeba uruchomić jako
osobną usługę obok serwera WWW.

Liczbę ostatnich pomiarów prezentowanych na wykresie ustawia
`PRICE_HISTORY_DISPLAY_LIMIT`. Wszystkie pomiary pozostają zapisane w tabeli
historii; parametr ogranicza jedynie zakres prezentowany w interfejsie.

Obserwacja automatycznie kończy się w chwili odjazdu pociągu. Przycisk
„Sprawdź teraz” pomija harmonogram i od razu sprawdza wszystkie aktywne
obserwacje użytkownika.

Każda kontrola najpierw atomowo przejmuje obserwację na czas określony przez
`ALERT_WATCH_LOCK_TIMEOUT_SECONDS`. Brak dokładnego dopasowania zapisanego UUID
ustawia status `connection_missing`; pierwszy wynik wyszukiwania nigdy nie jest
używany zastępczo.

### Zasada ceny docelowej

- bez ceny docelowej alert jest wysyłany dla każdej nowej, niższej ceny,
- dla ceny docelowej 55 zł alert jest wysyłany przy cenie `<= 55,00 zł`,
- po pierwszym osiągnięciu progu kolejne alerty przychodzą tylko dla dalszych
  spadków, np. 55 zł, potem 52 zł i 49 zł,
- spadek z 80 zł do 70 zł nie wyśle alertu, jeśli próg wynosi 55 zł.

## Powiadomienia

E-mail pozostaje wyłączony, dopóki `MAIL_ENABLED=false`. Aby go włączyć,
skonfiguruj w `.env` wartości `MAIL_FROM_*` i `SMTP_*`, a następnie ustaw
`MAIL_ENABLED=true`. Haseł i tokenów nie należy commitować; `.env` jest
ignorowany przez Git.

Dla SMTPS na porcie 465 ustaw `SMTP_SECURE=true` i
`SMTP_REQUIRE_TLS=false`. Dla SMTP z obowiązkowym STARTTLS, zwykle na porcie
587, ustaw `SMTP_SECURE=false` i `SMTP_REQUIRE_TLS=true`. Weryfikację
certyfikatu kontroluje `SMTP_REJECT_UNAUTHORIZED`; na prawidłowo
skonfigurowanym serwerze powinna pozostać włączona.

Jeśli sieć firmowa podpisuje połączenia własnym CA, ustaw `SMTP_CA_FILE` na
plik PEM z tym CA. Ścieżka może być względna wobec katalogu `web` lub
bezwzględna. Dla `mail.zetosoftware.pl` w sieci z Axence nVision:

```dotenv
SMTP_REJECT_UNAUTHORIZED=true
SMTP_CA_FILE=certs/axence-nvision-agent-ca-3.pem
```

Serwer `mail.euslugi.zetosoftware.pl:587` używa samopodpisanego certyfikatu
wystawionego dla nazwy backendu `serafin.zeto.olsztyn.pl`. Dla tego endpointu
ustaw:

```dotenv
SMTP_HOST=mail.euslugi.zetosoftware.pl
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_REJECT_UNAUTHORIZED=true
SMTP_CA_FILE=certs/mail-euslugi-zetosoftware-pl.pem
SMTP_TLS_SERVERNAME=serafin.zeto.olsztyn.pl
```

Po uzupełnieniu danych i ustawieniu `MAIL_ENABLED=true` wyślij niezależną
wiadomość testową:

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper\web'
npm run mail:test -- odbiorca@example.com
```

Alert cenowy jest zawsze wysyłany na aktualny, potwierdzony adres e-mail
właściciela konta. Formularz nie przyjmuje dowolnego adresu odbiorcy. Kanały
SMS i WhatsApp pozostają wyłączone do czasu dodania osobnej weryfikacji numeru.

Wiadomości cenowe trafiają najpierw do tabeli `alert_outbox`. Każdy alert ma
unikalny identyfikator i stabilny nagłówek `Message-ID`. Wysyłka jest atomowo
przejmowana przez jednego workera, a błędy SMTP są ponawiane z wykładniczym
backoffem. Liczbę prób, opóźnienia, czas wygaśnięcia blokady i rozmiar partii
ustawiają `ALERT_OUTBOX_*`. `ALERT_DAILY_MAX_MESSAGES_PER_USER` ogranicza liczbę
alertów użytkownika na dobę, a `PRICE_WATCH_MAX_PER_USER` liczbę obserwacji.

Nowe konto pozostaje nieaktywne do czasu wpisania kodu z wiadomości e-mail.
Długość kodu, ważność, limit prób i czas przed ponowną wysyłką określają
zmienne `EMAIL_VERIFICATION_*` w `.env`.

Formularz „Nie pamiętasz hasła?” wysyła jednorazowy link. W bazie zapisywany
jest wyłącznie skrót SHA-256 losowego tokenu, a jego ważność określa
`PASSWORD_RESET_TOKEN_TTL_MINUTES`. Odpowiedź nie ujawnia, czy konto istnieje.
Po zmianie hasła wszystkie wcześniejsze sesje są odrzucane przez numer
`auth_version`. Minimalną i maksymalną długość hasła ustawiają
`PASSWORD_MIN_LENGTH` oraz `PASSWORD_MAX_LENGTH`.

## Prawdziwe dane

`PRICE_PROVIDER=koleo` przełącza wyszukiwanie na klienta z katalogu głównego.
Wymaga to uzupełnienia wszystkich zmiennych `KOLEO_*` w `.env_conf` (Docker)
lub `web/.env` (uruchomienie bez Dockera). URL API, identyfikacja klienta,
timeout, liczba retry, opóźnienia backoff i maksymalna równoległość nie są
zaszyte w kodzie. Ponawiane są tylko odczyty oraz wyszukiwanie połączeń;
operacje logowania nie są automatycznie powtarzane.

Formularz przyjmuje wyłącznie stacje wybrane z podpowiedzi i przesyła ich ID.
Backend ponownie sprawdza parę ID/nazwa, rzeczywistą datę kalendarzową,
godzinę, różne stacje oraz zakres sprzedaży określony przez
`TICKET_SALES_MAX_ADVANCE_DAYS`.

## Ochrona przed nadużyciami

Rejestracja, logowanie, weryfikacja i ponowne wysłanie kodu, wyszukiwanie stacji
i połączeń oraz „Sprawdź teraz” korzystają z `@adonisjs/limiter`. Limity są
liczone niezależnie dla IP oraz e-maila, konta lub zalogowanego użytkownika.
Adresy e-mail w kluczach limitera są haszowane. Produkcja używa trwałej tabeli
`rate_limits`, natomiast testy używają pamięci.

Wartości konfiguruje się bez zmian w kodzie przez `LIMITER_STORE`,
`RATE_LIMIT_*`, `PRICE_WATCH_MAX_PER_USER`,
`ALERT_DAILY_MAX_MESSAGES_PER_USER`, `ALERT_WATCH_LOCK_TIMEOUT_SECONDS` oraz
`ALERT_OUTBOX_*`. Przekroczenie limitu HTTP zwraca `429 Too Many Requests` z
nagłówkiem `Retry-After`.

## CSP i reverse proxy

Shield wysyła politykę CSP konfigurowaną przez `CSP_*`. Pierwsze wdrożenie
powinno mieć `CSP_ENABLED=true` i `CSP_REPORT_ONLY=true`. Naruszenia trafiają do
`CSP_REPORT_URI` i są zapisywane w logach bez query stringów. Frontend używa
`@alpinejs/csp`, nie wymaga `unsafe-eval` i nie zawiera stylów inline. Po
przejrzeniu logów ustaw `CSP_REPORT_ONLY=false` i odtwórz kontenery.

Adonis ufa nagłówkom `X-Forwarded-*` wyłącznie od adresów wymienionych w
`TRUSTED_PROXIES`. Nie ustawiaj `0.0.0.0/0`, `::/0` ani trybu ufającego wszystkim.
Compose wiąże port aplikacji z `PUBLISHED_HOST=127.0.0.1`, dlatego ruch z
Internetu musi przejść przez Nginx.

Minimalna konfiguracja Nginx (podmień nazwę hosta i ścieżki certyfikatów):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name koleo.example.pl;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name koleo.example.pl;

    ssl_certificate     /sciezka/do/fullchain.pem;
    ssl_certificate_key /sciezka/do/privkey.pem;

    client_max_body_size 128k;

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_redirect off;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

W `web/.env` ustaw publiczny adres z HTTPS, np.
`APP_URL=https://koleo.example.pl`. Jeżeli przed Nginx działa jeszcze CDN lub
load balancer, najpierw skonfiguruj `set_real_ip_from` wyłącznie dla jego
oficjalnych zakresów; nie kopiuj dowolnego nagłówka klienta jako prawdziwego IP.

## Docker Compose

Obraz zawiera produkcyjny build aplikacji, ale nie zawiera `.env`. Compose
udostępnia ten plik jako sekret podczas budowania i montuje go tylko do odczytu
podczas działania kontenerów. Przed wdrożeniem ustaw w `web/.env` co najmniej
produkcyjne `APP_KEY`, publiczny `APP_URL`, konfigurację SMTP oraz provider cen.
Ustawienia samego Compose znajdują się w ignorowanym przez Git pliku
`.env_conf`; skopiuj go osobno na serwer razem z `web/.env`.

Parametry operacyjne wymagane także podczas kompilacji, takie jak typ bazy,
limity parsera i zakres sprzedaży, są przekazywane z `.env_conf` jako build
args. Nie trzeba ich powielać w `web/.env`; sekret ten nadal przechowuje klucz
aplikacji, SMTP i pozostałe ustawienia wrażliwe.

Uruchomienie z katalogu głównego repozytorium:

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper'
docker compose --env-file .env_conf build
docker compose --env-file .env_conf up -d
docker compose --env-file .env_conf ps
```

Compose uruchamia jednorazową migrację, serwer WWW oraz osobny worker alertów.
Aplikacja jest domyślnie dostępna dla Nginx pod `127.0.0.1:3333`, a nie
bezpośrednio z Internetu. Adres wiązania i port można zmienić bez edycji pliku
Compose:

```powershell
# Zmień PUBLISHED_HOST/PUBLISHED_PORT w .env_conf, a następnie:
docker compose --env-file .env_conf up -d
```

Wspólne zabezpieczenia kontenerów są konfigurowane wyłącznie w ignorowanym
pliku `.env_conf` przez `CONTAINER_*`: system plików tylko do odczytu,
`cap_drop`, `no-new-privileges`, limit PID-ów, pamięci i CPU oraz osobne tmpfs-y
dla systemowego i aplikacyjnego katalogu tymczasowego. Domyślna konfiguracja
usuwa wszystkie capabilities; aplikacja zapisuje trwale wyłącznie do wolumenu
`koleo_data`. Jeżeli zmienisz użytkownika obrazu, dostosuj `uid` i `gid` w
`CONTAINER_APP_TMPFS`.

Zalecane wartości dla serwera:

```dotenv
CONTAINER_READ_ONLY=true
CONTAINER_CAP_DROP=ALL
CONTAINER_SECURITY_OPT=no-new-privileges:true
CONTAINER_PIDS_LIMIT=128
CONTAINER_MEMORY_LIMIT=512m
CONTAINER_CPU_LIMIT=1.0
CONTAINER_SYSTEM_TMPFS=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777
CONTAINER_APP_TMPFS=/opt/koleo/web/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1770,uid=1000,gid=1000
```

Logi i zatrzymanie:

```powershell
docker compose --env-file .env_conf logs -f web worker
docker compose --env-file .env_conf down
```

Baza SQLite znajduje się na trwałym wolumenie `koleo-watch-data`; zwykłe
`docker compose down` jej nie usuwa. Polecenie `docker compose down -v` usuwa
również bazę i powinno być używane tylko świadomie. Ten wariant jest przeznaczony
dla pojedynczego serwera. Przy wielu replikach aplikacji należy przejść na
PostgreSQL zamiast współdzielić SQLite między hostami.

SQLite działa w trybie WAL z konfigurowalnym `SQLITE_BUSY_TIMEOUT_MS`. Ręczna,
spójna kopia online z kontrolą integralności:

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper'
docker compose --env-file .env_conf exec web node ace.js db:backup
```

Przed odtworzeniem zatrzymaj procesy korzystające z bazy. Nazwę kopii odczytaj
z wyniku poprzedniego polecenia, a następnie wykonaj:

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper'
docker compose --env-file .env_conf stop web worker
docker compose --env-file .env_conf run --rm --no-deps web node ace.js db:restore --file=nazwa-kopii.sqlite3 --confirm
docker compose --env-file .env_conf up -d
```

Liczbę zachowanych kopii ustawia `DB_BACKUP_RETENTION_COUNT`, a katalog
`CONTAINER_DB_BACKUP_DIR`. Odtwarzanie najpierw weryfikuje kopię i plik
tymczasowy; w razie błędu zachowuje poprzednią bazę. Dla wielu replik ustaw
`DB_CONNECTION=pg` i uzupełnij `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`
oraz nazwę bazy w `CONTAINER_DB_DATABASE`. Sterownik PostgreSQL jest już częścią
obrazu.

## Healthchecki i metryki

- `GET /health/live` potwierdza, że proces HTTP odpowiada,
- `GET /health/ready` sprawdza bazę oraz — gdy alerty są włączone — świeżość
  heartbeat workera,
- `GET /metrics` zwraca format Prometheus i wymaga nagłówka
  `Authorization: Bearer <METRICS_TOKEN>`; bez tokenu endpoint zwraca 404.

Metryki obejmują liczbę i czas zapytań KOLEO, błędy KOLEO i SMTP, przebiegi i
błędy workera, błędy pojedynczych obserwacji, heartbeat oraz wiek najstarszego
oczekującego zadania. Multipart jest wyłączony, ponieważ aplikacja nie ma
uploadów; limity zwykłych formularzy i JSON są ustawiane przez
`BODY_PARSER_*_LIMIT`.

Włączaj ten tryb wyłącznie z potwierdzonym uprawnieniem administratora. Punkt
1.6 aktualnego
[regulaminu KOLEO](https://koleo.pl/terms-of-use) zabrania automatycznego
dostępu do serwisu. Z tego powodu aplikacja startuje bez ruchu sieciowego i z
`ALERTS_ENABLED=false`.

## Weryfikacja

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper\web'
npm run lint
npm run typecheck
node ace test --no-ansi
npm run build
```

Kod aplikacji znajduje się w `web/`. Biblioteka zaimportowana z projektu
`open-koleo` pozostaje w katalogu głównym.
