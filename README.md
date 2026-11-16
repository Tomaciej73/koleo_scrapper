# Koleo Watch

Nieoficjalny klient API KOLEO oraz prosta aplikacja WWW do wyszukiwania
połączeń i obserwowania zmian cen.

## Co jest gotowe

- rejestracja i logowanie użytkownika,
- formularz trasy, daty i opcjonalnej godziny,
- lista połączeń z czasem przejazdu, przesiadkami i ceną,
- zapis połączenia do obserwowanych,
- historia ostatniej i najniższej ceny,
- ręczne oraz cykliczne sprawdzanie alertów,
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

Częstotliwość określa `ALERT_CHECK_INTERVAL_MINUTES`. Proces workera trzeba
uruchomić jako osobną usługę obok serwera WWW.

## Powiadomienia

E-mail pozostaje wyłączony, dopóki `MAIL_ENABLED=false`. Aby go włączyć,
skonfiguruj w `.env` wartości `MAIL_FROM_*` i `SMTP_*`, a następnie ustaw
`MAIL_ENABLED=true`. Haseł i tokenów nie należy commitować; `.env` jest
ignorowany przez Git.

SMS i WhatsApp mają wspólny interfejs w warstwie powiadomień, ale nie wysyłają
wiadomości do czasu wyboru i skonfigurowania dostawcy.

## Prawdziwe dane

`PRICE_PROVIDER=koleo` przełącza wyszukiwanie na klienta z katalogu głównego.
Nie włączaj tego trybu bez potwierdzonego uprawnienia. Punkt 1.6 aktualnego
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
