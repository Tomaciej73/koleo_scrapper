# Koleo Watch

Nieoficjalny klient API KOLEO oraz aplikacja WWW do wyszukiwania
połączeń i obserwowania zmian cen KOLEO lub ČD.

## Co jest gotowe

- rejestracja z 6-cyfrowym kodem e-mail i logowanie użytkownika,
- formularz trasy z podpowiedziami i identyfikatorami stacji, zamianą kierunku,
  datą i opcjonalną godziną,
- sortowana lista połączeń z czasem przejazdu, przesiadkami, ceną, statusem
  możliwości zakupu i oznaczeniem przyjazdu następnego dnia,
- zapis połączenia do obserwowanych,
- pełna historia pomiarów ceny z wykresem oraz ostatnim błędem sprawdzania,
- edycja progu i interwału oraz pauza/wznowienie obserwacji,
- ręczne oraz cykliczne sprawdzanie alertów z osobnym interwałem dla każdej obserwacji,
- powiadomienia e-mail przez konfigurowalny serwer SMTP,
- opcjonalne alerty SMS przez bramkę SMS Gateway for Android po potwierdzeniu numeru; WhatsApp nie jest jeszcze obsługiwany,
- wybór źródła KOLEO/ČD w wyszukiwarce; osobne identyfikatory kursów i waluty
  PLN/CZK w obserwacjach, historii oraz wiadomościach e-mail. Ceny ČD mają
  orientacyjny odpowiednik PLN według datowanego kursu średniego NBP.

Aplikacja domyślnie działa w trybie `demo`: nie łączy się z KOLEO i generuje
deterministyczne wyniki, dzięki czemu interfejs oraz alerty można sprawdzić
bez zewnętrznych danych dostępowych.

## Uruchomienie w Windows PowerShell

Wymagane są Node.js 24 lub nowszy oraz npm 11 lub nowszy.

```powershell
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper'
# Edytuj wyłącznie istniejący, nieśledzony plik .env_conf.
# W nowej instalacji utwórz go lokalnie i ustaw APP_KEY.
Set-Location -LiteralPath 'M:\GIT\koleo_scrapper\web'
npm install
node --env-file=../.env_conf ace migration:run
npm run dev
```

Następnie otwórz `http://localhost:3333`, utwórz konto i wyszukaj połączenie.
Nie twórz `web/.env`. Klucz `APP_KEY` jest w `.env_conf`; w nowej instalacji
można wygenerować go poleceniem `node ace generate:key --show` z katalogu
`web` i ręcznie wpisać do `.env_conf`. Nie zmieniaj istniejącego klucza na
działającej instancji. `APP_URL` podaj jako pełny adres, np.
`http://localhost:3333` lokalnie albo adres HTTPS na VPS; nie używaj w nim
`${HOST}`/`${PORT}`, ponieważ lokalne polecenia ładują plik przez Node.

## Test zmiany ceny bez dostępu do KOLEO

1. Zostaw `PRICE_PROVIDER=demo` w `.env_conf` i zapisz wynik jako obserwowany.
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

Jeden cykl pobiera najwyżej `ALERT_WORKER_BATCH_SIZE` obserwacji. Pozostałe
oczekujące wpisy przechodzą do następnego cyklu. Globalny circuit breaker
otwiera się po liczbie kolejnych awarii określonej przez
`KOLEO_CIRCUIT_BREAKER_FAILURE_THRESHOLD` i zatrzymuje zapytania na
`KOLEO_CIRCUIT_BREAKER_OPEN_SECONDS`, aby awaria KOLEO nie powodowała lawiny
ponowień. Do licznika awarii wchodzą błędy transportowe, timeouty oraz
tymczasowe odpowiedzi HTTP 408, 429 i 5xx. Błędna stacja lub inne błędne
zapytanie użytkownika nie otwiera circuit breakera.

Liczbę ostatnich zmian ceny prezentowanych na wykresie ustawia
`PRICE_HISTORY_DISPLAY_LIMIT`. Identyczna cena nie tworzy kolejnego wpisu.
Worker usuwa wpisy starsze niż liczba dni określona przez
`PRICE_HISTORY_RETENTION_DAYS`, dzięki czemu tabela historii nie rośnie bez
ograniczenia.

Obserwacja automatycznie kończy się w chwili odjazdu pociągu. Przycisk
„Sprawdź teraz” pomija harmonogram i od razu sprawdza wszystkie aktywne
obserwacje użytkownika.

Każda kontrola najpierw atomowo przejmuje obserwację na czas określony przez
`ALERT_WATCH_LOCK_TIMEOUT_SECONDS`. UUID połączenia może zmienić się po stronie
KOLEO. Wtedy aplikacja odświeża go wyłącznie, gdy dokładnie jeden wynik zgadza
się jednocześnie po godzinie odjazdu, godzinie i dacie przyjazdu oraz nazwie
pociągu. Pierwszy wynik wyszukiwania nigdy nie jest używany zastępczo.
Worker pobiera cenę dopiero dla dokładnie wybranego kursu, a wyniki wyszukania
i ceny tego samego kursu współdzieli między obserwacjami tylko w obrębie jednego
cyklu sprawdzania. Zwykła wyszukiwarka WWW nadal pobiera ceny wszystkich
pokazywanych wyników.

Jeżeli jednoznacznego kursu nie uda się znaleźć, obserwacja pozostaje aktywna
do liczby kolejnych nieudanych sprawdzeń ustawionej przez
`ALERT_CONNECTION_MISSING_THRESHOLD`. Dopiero po osiągnięciu tego progu dostaje
status `connection_missing` i zostaje zatrzymana.

Brak ceny przed rozpoczęciem sprzedaży nie jest błędem workera. Obserwacja
pozostaje aktywna, zachowuje komunikat zwrócony przez dostawcę i sprawdza kurs
ponownie zgodnie ze swoim harmonogramem.

### Dostępność zakupu i miejsc

Wyniki wyszukiwania i obserwowane połączenia pokazują, czy dostawca potwierdza
aktualną możliwość zakupu biletu. Ten status nie jest gwarancją konkretnego
miejsca siedzącego. Dokładna mapa zajętości foteli korzysta z osobnych endpointów
KOLEO wymagających uwierzytelnionego konta i tokenu, dlatego nie jest odpytywana
przez aplikację bez skonfigurowanego konta integracyjnego.

### Zasada alertów cenowych

- alert jest wysyłany przy każdej zmianie ceny: zarówno przy spadku, jak i wzroście,
- historia ceny zapisuje każdą nową wartość, ale nie powiela wartości niezmienionej,
- cena docelowa jest dodatkowym warunkiem: dla progu 55 zł aplikacja wyśle alert
  przy pierwszym potwierdzeniu ceny `<= 55,00 zł`, nawet jeśli cena nie zmieniła się
  od chwili dodania obserwacji,
- ustawienie progu na 0 wyłącza dodatkowy alert progowy, ale nie wyłącza alertów
  o zmianach ceny.

Worker odpytuje publiczne wyszukiwanie KOLEO dla jednego pasażera bez ulgi;
logowanie do KOLEO nie jest do tego wymagane. Łączna kwota na koleo.pl może być
inna po wybraniu większej liczby pasażerów lub ulg. Aplikacja nie przechowuje
danych pasażerów użytkownika.

### Publiczne ceny ČD

W `.env_conf` ustaw `CD_ENABLED=true` oraz `CD_WEB_BASE_URL`,
`CD_STATION_AUTOCOMPLETE_URL`, `CD_STATION_COMBINATION` i
`CD_STATION_LANGUAGE` według `web/.env.example`. Przy `PRICE_PROVIDER=koleo`
formularz pokaże dwa źródła; `PRICE_PROVIDER=demo` zachowuje bezpieczny tryb
domyślny. Skonfiguruj też `CD_REQUEST_TIMEOUT_MS` i `CD_WEB_MAX_REDIRECTS`.
W Dockerze te ustawienia pozostają w montowanym `.env_conf`; nie wpisuj ich do
obrazu. Po wdrożeniu uruchom migrację i odtwórz kontenery WWW i workera.

Nazwy polskich stacji można wpisywać z polskimi znakami (np. „Wrocław Główny”).
W zapytaniu do ČD są transliterowane, a po wyborze formularz przechowuje
kanoniczną nazwę i identyfikator ČD. Stacje KOLEO pozostają w osobnej
przestrzeni dostawcy; przełączenie źródła czyści wybór stacji.

Adapter korzysta z publicznej wyszukiwarki ČD bez logowania: najpierw pobiera
stacje z ich identyfikatorami SR70 i kursy, a następnie dokładną cenę wybranego
kursu w tej samej sesji.
Gdy nie podasz godziny lub wybierzesz kurs w pierwszej godzinie dnia,
zapytanie zaczyna się minutę przed wybraną datą, ponieważ publiczna
wyszukiwarka ČD potrafi odrzucić zapytania blisko północy.
Adapter pobiera kolejne strony wyników tak jak przycisk „Późniejsze” na stronie
ČD, usuwa nakładające się kursy i zatrzymuje się po `SEARCH_RESULT_LIMIT`
wynikach, końcu dnia lub `CD_SEARCH_MAX_PAGES` stronach. Ustaw limit stron
w `.env_conf` odpowiednio do ruchu i potrzeb; jeśli go nie ustawisz, limit
zostanie obliczony z liczby wyników na pierwszej stronie i
`SEARCH_RESULT_LIMIT`. Worker nadal pobiera cenę tylko obserwowanego kursu.
Nie używa partnerskiego Ticket API wymagającego `X-User`, nie tworzy rezerwacji
i nie kupuje biletu. Cena dotyczy domyślnego jednego dorosłego pasażera w
drugiej klasie, bez zniżek. ČD podaje ją w CZK. W `.env_conf` ustaw `NBP_*`
według `web/.env.example`: aplikacja obok ceny CZK pokazuje orientacyjną kwotę
PLN według ostatniego kursu średniego NBP, wraz z datą tabeli. Nowy próg
alertu podajesz i zapisujesz w PLN dla obu źródeł. Worker przelicza cenę ČD
po dostępnym kursie NBP i porównuje ją z progiem PLN; zmiany samej ceny i
historia pozostają w walucie źródłowej. Gdy cena ČD w CZK jest bez zmian,
ale nowy kurs NBP przesunie jej wartość w PLN z poziomu powyżej progu do
poziomu równego progowi lub niższego, aplikacja również wyśle alert. Ponowne
sprawdzenie na tym samym kursie nie wysyła duplikatu; kolejne zejście poniżej
progu po wcześniejszym wyjściu ponad niego może wysłać nowy alert.
Historia zapisuje kurs, datę i numer tabeli NBP oraz wynik porównania przy
zmianie ceny źródłowej, kursu albo stanu progu; wpisy podlegają istniejącej
retencji `PRICE_HISTORY_RETENTION_DAYS`. E-mail korzysta z tego samego
kursu co decyzja workera. Starsze wpisy bez zapisanego kursu są oznaczone w
widoku; ich PLN pozostaje wyłącznie przeliczeniem po obecnie dostępnym kursie.
Przy awarii NBP cena źródłowa jest nadal widoczna i śledzona, ale progu PLN
ČD nie da się wtedy ocenić; ostatni znany stan progu nie jest zerowany. Migracja
zachowuje dotychczasowe progi ČD w CZK; są oznaczone w interfejsie i można je
zastąpić wartością PLN w „Ustawieniach”. Kurs NBP nie jest kursem zakupu ani
gwarancją kwoty pobranej przez bank.
Cena oznaczona przez ČD jako „od” lub dostępna dopiero w kolejnym kroku
nie jest traktowana jako dokładna i nie wywoła fałszywego alertu. Publiczna
strona i jej kontrakt techniczny mogą się zmienić; wtedy obserwacja pokaże
błąd, a worker ponowi sprawdzenie zgodnie z harmonogramem.

Jeżeli ČD zwróci odmowę dostępu wewnątrz strony z HTTP 200, wyszukiwarka
pokazuje komunikat „ČD odmówiło dostępu do wyników wyszukiwania” i kod
`cdAccessDenied`, a nie błędnie „Nieprawidłowa lista połączeń ČD”. To
ograniczenie po stronie źródła, nie problem z logowaniem do Koleo Watch;
nie należy automatycznie ponawiać zapytania wiele razy. Inny błąd zwrócony
przez ČD ma kod `cdSearchRejected`.

Opcjonalny test rzeczywistego odczytu bez wysyłki e-mail i bez zmiany bazy
uruchamia się tylko po jawnym ustawieniu `CD_LIVE_SMOKE=1` dla testu
`tests/unit/cd_public_service.spec.ts`. Zwykłe `node ace test --no-ansi` jest
w pełni offline. Dla testu sieciowego podnieś limit czasu Japa przez
`--timeout=30000`; domyślne 2 sekundy nie wystarczają na kilka stron i ceny.

Na serwerze z publicznym adresem `https://koleowatch.dpdns.org` sprawdź, czy
ignorowany przez Git `.env_conf` zawiera co najmniej:

```dotenv
APP_URL=https://koleowatch.dpdns.org
PRICE_PROVIDER=koleo
CD_ENABLED=true
CD_WEB_BASE_URL=https://www.cd.cz/en/spojeni-a-jizdenka/
CD_STATION_AUTOCOMPLETE_URL=https://ip4azak-prod.cdis.cz/DataWS/ACEStations
CD_STATION_COMBINATION=CDvyhledavacWeb
CD_STATION_LANGUAGE=en
CD_REQUEST_TIMEOUT_MS=10000
CD_REQUEST_MAX_RETRIES=2
CD_REQUEST_RETRY_BASE_DELAY_MS=250
CD_REQUEST_MAX_CONCURRENCY=2
CD_WEB_MAX_REDIRECTS=3
CD_SEARCH_MAX_PAGES=6
NBP_CZK_RATE_URL=https://api.nbp.pl/api/exchangerates/rates/a/czk/?format=json
NBP_REQUEST_TIMEOUT_MS=5000
NBP_RATE_CACHE_SECONDS=21600
NBP_RATE_FAILURE_RETRY_SECONDS=300
NBP_RATE_MAX_STALE_SECONDS=604800
```

Nie zmieniaj istniejących ustawień SMTP, `APP_KEY` i alertów przy aktualizacji.
Przed uruchomieniem migracji zachowaj kopię bazy. Po przesłaniu kodu do repozytorium
wykonaj na VPS (o ile katalog instalacji nadal jest `/opt/koleo_scrapper`):

```sh
cd /opt/koleo_scrapper
git status --short --branch
git pull --ff-only
docker compose --env-file /opt/koleo_scrapper/.env_conf exec web node ace.js db:backup
docker compose --env-file /opt/koleo_scrapper/.env_conf config --quiet
docker compose --env-file /opt/koleo_scrapper/.env_conf build
docker compose --env-file /opt/koleo_scrapper/.env_conf up -d
docker compose --env-file /opt/koleo_scrapper/.env_conf ps
curl -fsS https://koleowatch.dpdns.org/health/ready
curl -fsS https://koleowatch.dpdns.org/health/worker
```

W panelu wyszukaj ČD: „Brno hl.n.” → „Wrocław Główny”, wybierz stacje z listy,
otwórz wynik z ceną CZK i sprawdź kwotę PLN oraz datę kursu NBP. Dodaj
testową obserwację i zweryfikuj worker oraz e-mail po rzeczywistej zmianie ceny.
Nie używaj `docker compose down -v` - usunęłoby wolumen z bazą.

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

Wiadomości aktywacyjne, reset hasła, potwierdzenie zmiany hasła, alerty cenowe
i test SMTP są wysyłane jednocześnie jako `text/plain` i `text/html`. Szablony
HTML znajdują się w `web/resources/views/emails/` i korzystają ze wspólnego
układu z CSS zapisanym bezpośrednio w elementach. Klient pocztowy sam wybiera
obsługiwany wariant. Nie używamy JavaScript ani zewnętrznych arkuszy CSS,
ponieważ klienci pocztowi mogą je usuwać. Treści dynamiczne w szablonach są
automatycznie escapowane przez Edge.

Adres e-mail alertu pochodzi wyłącznie z konta użytkownika, nie z formularza.
W ustawieniach konta można dodać polski numer telefonu i potwierdzić go kodem
SMS. Dopiero wtedy przy danej obserwacji dostępny jest wybór: e-mail, SMS lub
oba kanały. Usunięcie numeru przestawia obserwacje SMS na e-mail i anuluje
oczekujące SMS-y. WhatsApp nie jest obsługiwany.

### Konfiguracja SMS

Integracja obsługuje dwa warianty. Domyślny `android` używa
[API SMS Gateway for Android](https://docs.sms-gate.app/features/sending-messages/)
(`POST /3rdparty/v1/messages`) przez HTTPS. Potrzebny jest telefon Android
z aplikacją i aktywną kartą SIM, ewentualnie własna bramka zgodna z tym API.
Ustaw w nieśledzonym `.env_conf` (nie w `compose.yaml`):

```dotenv
SMS_ENABLED=true
SMS_PROVIDER=android
SMS_GATEWAY_MESSAGES_URL=https://api.sms-gate.app/3rdparty/v1/messages
SMS_GATEWAY_USERNAME=<nazwa-z-bramki>
SMS_GATEWAY_PASSWORD=<haslo-z-bramki>
```

Alternatywa bez telefonu to [SMSAPI](https://www.smsapi.pl/docs/). Jego aktualny
punkt wysyłki to `https://api.smsapi.pl/sms.do`; `ssl.smsapi.pl` jest adresem
panelu klienta, a nie adresem wysyłki. Zalecane jest wygenerowanie w panelu
tokenu API z prawem wysyłki SMS. Zweryfikuj i aktywuj pole nadawcy w SMSAPI.

```dotenv
SMS_ENABLED=true
SMS_PROVIDER=smsapi
SMSAPI_API_URL=https://api.smsapi.pl/sms.do
SMSAPI_API_TOKEN=<token-z-panelu-smsapi>
SMSAPI_SENDER=<zatwierdzone-pole-nadawcy>
```

Jeśli masz działającą konfigurację brokera powiadomień z polami
`powiadomienia.smsApiClient`, `powiadomienia.smsApiPassword` i
`powiadomienia.smsApiSender`, ustaw ich odpowiedniki w `.env_conf`:

```dotenv
SMS_ENABLED=true
SMS_PROVIDER=smsapi
SMSAPI_API_URL=https://api.smsapi.pl/sms.do
SMSAPI_CLIENT=<wartosc-smsApiClient>
SMSAPI_PASSWORD=<zwykle-haslo-API-z-smsApiPassword>
SMSAPI_SENDER=<wartosc-smsApiSender>
```

`SMSAPI_PASSWORD` oznacza zwykłe hasło **do API**, a nie hasło do panelu.
Aplikacja sama wylicza MD5, tak jak biblioteka brokera, i wysyła wynik w
uwierzytelnieniu HTTP Basic przez HTTPS. Nie kopiuj tych danych do Git ani do
logów. Alternatywnie nadal działają `SMSAPI_USERNAME` i
`SMSAPI_PASSWORD_MD5` dla już skonfigurowanej starszej integracji. Token ma
pierwszeństwo, jeżeli oba sposoby uwierzytelniania są skonfigurowane.
SMSAPI pobiera opłatę
za wysyłki po wykorzystaniu pakietu testowego.

Wysyłka SMSAPI jest żądaniem POST z danymi w treści (nie w adresie URL),
z `idx` i `check_idx=1` w celu zabezpieczenia ponowień przed podwójną wysyłką
w oknie obsługiwanym przez dostawcę. Aplikacja uznaje odpowiedź
o przyjęciu wiadomości do kolejki za sukces, ale nie pobiera jeszcze raportów
faktycznego doręczenia. Testuj najpierw potwierdzenie własnego numeru w
ustawieniach konta; samego adresu ani danych dostępowych nie wystarczy zmienić
bez wdrożenia tej wersji kodu.

Jeśli SMSAPI zwróci kod błędu `14`, sprawdź `SMSAPI_SENDER`: nazwa pola nadawcy
musi być aktywna i zweryfikowana na koncie, którego używa `SMSAPI_CLIENT` albo
`SMSAPI_API_TOKEN`. W brokerze nadawca może zostać nadpisany przez konkretne
powiadomienie, więc samo skopiowanie `powiadomienia.smsApiSender` nie dowodzi,
że ta nazwa jest dopuszczona przez SMSAPI. Kod `14` oznacza odrzucenie przez
dostawcę przed wysyłką; po poprawieniu konfiguracji można ponowić próbę
weryfikacji numeru. Nie umieszczaj pełnych danych dostępowych ani numeru
odbiorcy w zgłoszeniu błędu.

Pozostałe `SMS_*` i `RATE_LIMIT_PHONE_REQUESTS` mają przykładowe wartości w
`.env.example` oraz `.env_conf`. Dla własnego serwera ustaw jego pełny adres
HTTPS. Nie commituj danych dostępowych ani numerów telefonu. Po zmianie
`.env_conf` odtwórz kontenery `web` i `worker`, żeby pobrały nowe środowisko.
Wysłanie kodu, wpisanie kodu i usunięcie numeru mają osobne liczniki żądań.
Wyczerpanie limitu wysyłki nie blokuje potwierdzenia otrzymanego już SMS-a.
Liczba błędnych kodów jest dodatkowo ograniczona dla samego kodu przez
`SMS_VERIFICATION_MAX_ATTEMPTS`.
Na serwerze uruchom migracje (`migrate` w Compose) przed udostępnieniem
formularza SMS. Skonfiguruj telefon/bramkę, następnie potwierdź swój numer
w ustawieniach konta i wykonaj próbę na własnej obserwacji.

`alert_outbox` przechowuje osobny wpis na kanał; wybór „e-mail i SMS” zużywa
dwa miejsca z dziennego limitu wiadomości. Ponowienia używają tego samego
identyfikatora SMS. Status `sent` oznacza przyjęcie żądania przez bramkę,
**nie** potwierdzenie dostarczenia na telefon. Samo API obsługuje odrębne
[śledzenie statusu](https://docs.sms-gate.app/features/status-tracking/),
którego ta wersja aplikacji jeszcze nie synchronizuje. Wybór publicznej chmury
oznacza przekazanie treści i numerów dostawcy; do bardziej wrażliwych danych
wybierz prywatną instancję bramki.

Wiadomości cenowe trafiają najpierw do tabeli `alert_outbox`. Każdy alert ma
unikalny identyfikator i stabilny nagłówek `Message-ID`. Wysyłka jest atomowo
przejmowana przez jednego workera, a błędy SMTP są ponawiane z wykładniczym
backoffem. Liczbę prób, opóźnienia, czas wygaśnięcia blokady i rozmiar partii
ustawiają `ALERT_OUTBOX_*`. `ALERT_DAILY_MAX_MESSAGES_PER_USER` ogranicza liczbę
alertów użytkownika na dobę, a `PRICE_WATCH_MAX_PER_USER` liczbę obserwacji.
Terminalne wpisy kolejki są usuwane po `ALERT_OUTBOX_RETENTION_DAYS`, a stare
rekordy wysyłki resetu hasła po `PASSWORD_RESET_DELIVERY_RETENTION_DAYS`.

Nowe konto pozostaje nieaktywne do czasu wpisania kodu z wiadomości e-mail.
Długość kodu, ważność, limit prób i czas przed ponowną wysyłką określają
zmienne `EMAIL_VERIFICATION_*` w `.env`.
Odświeżenie strony lub chwilowa utrata połączenia nie kasuje kodu. Jeśli sesja
wygaśnie, zalogowanie adresem podanym przy rejestracji i hasłem przywraca ekran
weryfikacji; tam można też ponownie wysłać kod. Gdy hasło zostało zapomniane,
reset trafia na aktualny adres konta.

Formularz „Nie pamiętasz hasła?” zleca wysłanie jednorazowego linku przez
trwałą kolejkę `password_reset_deliveries`. Właściwy token jest przechowywany
w bazie wyłącznie jako skrót SHA-256; kopia potrzebna workerowi do wysyłki jest
krótkotrwale zaszyfrowana kluczem aplikacji i usuwana kaskadowo razem z
tokenem. Token znajduje się po znaku `#` w linku, dlatego przeglądarka nie
wysyła go do serwera i nie trafia on do logów dostępu. Jego ważność określa
`PASSWORD_RESET_TOKEN_TTL_MINUTES`.

Odpowiedź nie ujawnia, czy konto istnieje, nie czeka na SMTP i ma minimalny
czas oraz losowy dodatek ustawiane przez `PASSWORD_RESET_MIN_RESPONSE_MS` i
`PASSWORD_RESET_RESPONSE_JITTER_MS`. Worker używa tych samych ustawień prób,
backoffu i blokady `ALERT_OUTBOX_*` co kolejka alertów. Po zmianie hasła
wszystkie wcześniejsze sesje są odrzucane przez numer `auth_version`.
Minimalną i maksymalną długość hasła ustawiają `PASSWORD_MIN_LENGTH` oraz
`PASSWORD_MAX_LENGTH`. `EMAIL_MAX_LENGTH` (nie więcej niż 254, zgodnie z bazą)
oraz `FULL_NAME_MAX_LENGTH` ograniczają pozostałe dane konta. Te wartości są
sprawdzane przez backend i używane jako limity pól formularzy.

Ekran „Konto” pozwala zmienić adres e-mail z ponownym potwierdzeniem, pobrać
eksport danych, trwale usunąć konto oraz przeglądać i unieważniać aktywne
sesje. Lista sesji wymaga `SESSION_DRIVER=database` (zalecane w produkcji) albo
`memory` w testach. Dane sesji w tabeli `sessions` są szyfrowane kluczem
aplikacji. Przejście z wcześniejszego store'a `cookie` jednorazowo wyloguje
dotychczasowe sesje.
Podczas zmiany e-maila kod trafia na **nowy** adres, a powiadomienie o żądaniu
zmiany na **stary**. Do wpisania kodu stary adres nadal służy do logowania,
resetu hasła i alertów. Po utracie sesji zaloguj się starym adresem i hasłem,
aby wrócić do ekranu kodu. Dopiero poprawny kod przełącza konto i obserwacje na
nowy adres, unieważnia pozostałe sesje oraz wcześniejsze tokeny resetu.

Adresy e-mail są przed walidacją i zapisem obcinane z białych znaków oraz
zamieniane na małe litery. Baza dodatkowo wymusza unikalność wartości
`LOWER(TRIM(email))`.

## Audyt zależności

Na 22 listopada 2026 r. `npm audit` oraz `npm audit --omit=dev` nie zgłaszają
znanych podatności. Pakiety Auth, Core, Limiter, Lucid, Mail, Session i Shield
zostały podniesione do bieżących wydań zgodnych z AdonisJS 7. Aktualizacja Mail
10.4.1 zawiera wskazane przez projekt Adonis poprawki bezpieczeństwa
Nodemailera. Po każdej aktualizacji należy ponownie uruchomić audyt, testy
offline i produkcyjny build.

## Prawdziwe dane

`PRICE_PROVIDER=koleo` przełącza wyszukiwanie na klienta z katalogu głównego.
Wymaga to uzupełnienia wszystkich zmiennych `KOLEO_*` w `.env_conf` zarówno
w Dockerze, jak i przy uruchomieniu bez Dockera. URL API, identyfikacja klienta,
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
`ALERT_DAILY_MAX_MESSAGES_PER_USER`, `ALERT_WATCH_LOCK_TIMEOUT_SECONDS`,
`ALERT_CONNECTION_MISSING_THRESHOLD` oraz `ALERT_OUTBOX_*`. Przekroczenie
limitu HTTP zwraca `429 Too Many Requests` z nagłówkiem `Retry-After`.

## CSP i reverse proxy

Shield wysyła politykę CSP konfigurowaną przez `CSP_*`. Pierwsze wdrożenie
powinno mieć `CSP_ENABLED=true` i `CSP_REPORT_ONLY=true`. Naruszenia trafiają do
`CSP_REPORT_URI` i są zapisywane w logach bez query stringów. Log pokazuje teraz
naruszoną dyrektywę, zablokowane źródło, ścieżkę strony i - jeśli przeglądarka
ją poda - plik oraz numer linii. Dzięki temu szczegóły są widoczne również przy
`LOG_SHOW_CONTEXT=false`. Sama zmiana publicznej domeny nie wymaga dopisywania
jej do dyrektyw z `'self'`. Jeśli produkcja wysyła nagłówek
`Content-Security-Policy` zamiast `Content-Security-Policy-Report-Only`, ustaw
`CSP_REPORT_ONLY=true` w serwerowym `.env_conf` na czas diagnozy; nie dodawaj
`unsafe-inline` ani obcych domen bez sprawdzenia konkretnych raportów. Frontend używa
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

W `.env_conf` ustaw publiczny adres z HTTPS, np.
`APP_URL=https://koleo.example.pl`. Jeżeli przed Nginx działa jeszcze CDN lub
load balancer, najpierw skonfiguruj `set_real_ip_from` wyłącznie dla jego
oficjalnych zakresów; nie kopiuj dowolnego nagłówka klienta jako prawdziwego IP.

## Docker Compose

Jedynym plikiem konfiguracyjnym do edycji jest ignorowany przez Git
`.env_conf` w katalogu głównym repozytorium. Zawiera ustawienia Compose i
aplikacji (`APP_KEY`, `APP_URL`, SMTP, SMS, dostawców cen itd.). Compose używa
go do interpolacji, udostępnia jako sekret podczas budowania i montuje ten sam
plik tylko do odczytu w kontenerach. Plik nie trafia do obrazu. Nie twórz
oddzielnego `web/.env` ani nie kopiuj go na serwer. Przed wdrożeniem upewnij
się, że w `.env_conf` znajdują się także:

```dotenv
EMAIL_MAX_LENGTH=254
FULL_NAME_MAX_LENGTH=120
```

Hasła nadal ograniczają istniejące `PASSWORD_MIN_LENGTH` i `PASSWORD_MAX_LENGTH`.

W `.env_conf` ustaw `APP_ENV_FILE=./.env_conf`. Compose przekazuje do kontenera
tylko wartości specyficzne dla kontenera (`HOST`, `PORT`, ścieżki bazy i kopii,
strefę czasu procesu); resztę Adonis czyta z montowanego pliku. Dzięki temu
hasła nie są powielane w `compose.yaml` ani argumentach budowania.

Przy aktualizacji istniejącego VPS najpierw zrób prywatne kopie dotychczasowych
`.env_conf` i `web/.env`. Dopisz do serwerowego `.env_conf` wszystkie brakujące
klucze z `web/.env`, zachowując dotychczasowy `APP_KEY` oraz hasła, i zmień
`APP_ENV_FILE` na `./.env_conf`. Nie nadpisuj serwerowych sekretów wartościami
z komputera deweloperskiego. Po sprawdzeniu `docker compose --env-file
.env_conf config --quiet`, przebudowaniu obrazu i poprawnym uruchomieniu
kontenerów można usunąć stary `web/.env` z VPS. `web/.env.test` pozostaje
jedynie izolowaną konfiguracją automatycznych testów.

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

Format logów `web` i `worker` jest konfigurowany wyłącznie w `.env_conf`:

```dotenv
CONTAINER_TIMEZONE=UTC
APP_TIMEZONE=Europe/Warsaw
LOG_LEVEL=info
LOG_FORMAT=pretty
LOG_COLORIZE=true
LOG_LEVEL_COLORS="info:blue,warn:yellow,error:red,fatal:red"
LOG_MESSAGE_COLORS="default:white,warn:yellow,error:red,fatal:red"
LOG_TIME_FORMAT="SYS:dd/mm/yyyy HH:MM:ss"
LOG_SINGLE_LINE=false
LOG_SHOW_CONTEXT=false
```

Tryb `pretty` daje krótkie wpisy w postaci
`INFO [25/11/2026 14:30:15]: Sprawdzono...` oraz
koloruje etykietę `INFO` na niebiesko, `WARN` na żółto, a `ERROR` na czerwono.
`LOG_MESSAGE_COLORS` osobno ustawia treść: zwykły komunikat jest biały,
ostrzeżenie żółte, a błąd czerwony. `LOG_SHOW_CONTEXT=true` dopisuje pola techniczne
potrzebne do szczegółowego debugowania. Ustaw `LOG_LEVEL=debug`, aby dopuścić
komunikaty DEBUG. Dla Loki, ELK albo innego parsera logów ustaw
`LOG_FORMAT=json` i `LOG_COLORIZE=false`.

Na VPS z Docker Compose zmień **w `/opt/koleo_scrapper/.env_conf`** tymczasowo:

```dotenv
LOG_LEVEL=debug
LOG_SHOW_CONTEXT=true
```

Po wdrożeniu kodu odtwórz procesy WWW i workera oraz odczytaj ostatnie logi:

```sh
docker compose --project-directory /opt/koleo_scrapper -f /opt/koleo_scrapper/compose.yaml --env-file /opt/koleo_scrapper/.env_conf up -d --force-recreate web worker
docker compose --project-directory /opt/koleo_scrapper -f /opt/koleo_scrapper/compose.yaml --env-file /opt/koleo_scrapper/.env_conf logs --tail=200 --since=15m web worker
```

Wpisy `cd_request_completed`, `cd_request_failed` i `cd_search_page_parsed`
podają etap, HTTP, liczbę prób, czas i klasyfikację odpowiedzi. Nie zawierają
cookies, tokenu CSRF, pełnego URL, adresu IP zwróconego przez ČD ani e-maila.
Wpis `connection_search_failed` ma kod błędu także przy
`LOG_SHOW_CONTEXT=false`. Przed przesłaniem logów ustaw w serwerowym
`.env_conf` `AUDIT_LOG_PERSONAL_DATA=false` lub zamaskuj dane konta i trasy.
Po diagnozie przywróć `LOG_LEVEL=info` i `LOG_SHOW_CONTEXT=false`, a potem
ponownie odtwórz oba kontenery. Nie zmieniaj `NODE_ENV` na `development` na
publicznym serwerze.

Logowanie i wyszukiwanie mają czytelny opis także bez `LOG_SHOW_CONTEXT`: ID
użytkownika, zamaskowany e-mail, identyfikatory stacji, datę, godzinę, filtr,
liczbę wyników i czas odpowiedzi. Jeśli na potrzeby audytu trzeba zobaczyć
pełny adres konta i nazwy stacji, ustaw `AUDIT_LOG_PERSONAL_DATA=true` w
serwerowym `.env_conf` i odtwórz kontener WWW. Domyślnie jest `false`, ponieważ
pełny e-mail i trasa powiązana z użytkownikiem są danymi osobowymi. Ogranicz
dostęp i retencję takich logów; nigdy nie trafiają do nich hasła, kody ani
tokeny. Nie ustawiaj `LOG_SHOW_CONTEXT=true` tylko po to, by zobaczyć te
podstawowe informacje.

Proces aplikacji działa w `TZ=UTC`, aby daty SQLite nie przesuwały terminów
zadań. Widoczny czas logu nadal jest formatowany w strefie `APP_TIMEZONE`,
domyślnie `Europe/Warsaw`.

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
- `GET /health/ready` sprawdza wyłącznie gotowość serwera WWW i bazy,
- `GET /health/worker` niezależnie sprawdza heartbeat workera oraz wiek kolejek,
- `GET /metrics` zwraca format Prometheus i wymaga nagłówka
  `Authorization: Bearer <METRICS_TOKEN>`; bez tokenu endpoint zwraca 404.

Metryki obejmują liczbę i czas zapytań KOLEO, błędy KOLEO i SMTP, przebiegi i
błędy workera, heartbeat, kolejki wysyłkowe i stan circuit breakera. Progi
healthchecków ustalają `HEALTH_WORKER_STALE_SECONDS` i
`HEALTH_QUEUE_STALE_SECONDS`. Gotowe reguły osobnych alarmów Prometheus znajdują
się w `ops/prometheus/koleo-alerts.yml`. `/health/worker` liczy wpisy obu kolejek
przez SQL `COUNT` i ustala najstarsze oczekujące zadanie przez `MIN`, bez
wczytywania całych kolejek do pamięci. Żadna dodatkowa usługa monitoringu nie
jest uruchamiana przez Docker Compose aplikacji.

Multipart jest wyłączony, ponieważ aplikacja nie ma uploadów; limity zwykłych
formularzy i JSON są ustawiane przez
`BODY_PARSER_*_LIMIT`.

Każde wyszukanie połączeń zapisuje ustrukturyzowane zdarzenia
`connection_search_started` oraz jedno ze zdarzeń końcowych:
`connection_search_succeeded`, `connection_search_empty` albo
`connection_search_failed`. Log zawiera wspólny `request_id`, identyfikatory
stacji, datę, filtr połączeń bezpośrednich, czas wykonania i liczbę wyników, ale
nie zapisuje danych uwierzytelniających. Odpowiedź KOLEO `noConnectionsFound`
jest prawidłowym pustym wynikiem, więc nie zwiększa licznika awarii ani nie
otwiera circuit breakera.

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
