import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import AlertOutbox from '#models/alert_outbox'
import User from '#models/user'
import PriceAlertService from '#services/price_alert_service'
import ConnectionSearchService from '#services/connection_search_service'
import AlertOutboxService from '#services/alert_outbox_service'
import NotificationService from '#services/notification_service'
import PriceObservationRetentionService from '#services/price_observation_retention_service'
import NbpExchangeRateService from '#services/nbp_exchange_rate_service'
import TargetCurrencyMigration from '#database/migrations/1795007600000_add_price_watch_target_currency'
import env from '#start/env'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'

const futureDate = () => DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate()!

test.group('Price watch flow', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('marks pre-existing ČD thresholds as CZK without changing KOLEO thresholds', async ({
    assert,
  }) => {
    const tableName = 'price_watch_target_currency_probe'
    const connection = db.connection()
    await connection.schema.createTable(tableName, (table) => {
      table.increments('id')
      table.string('provider', 12).notNullable()
      table.integer('target_price_cents').nullable()
    })
    try {
      await db.table(tableName).insert([
        { provider: 'cd', target_price_cents: 80_000 },
        { provider: 'koleo', target_price_cents: 5_500 },
        { provider: 'cd', target_price_cents: null },
      ])
      class ProbeMigration extends TargetCurrencyMigration {
        protected tableName = tableName
      }
      await new ProbeMigration(connection, 'target-currency-probe').execUp()
      const rows = await db
        .from(tableName)
        .select('provider', 'target_price_cents', 'target_price_currency')
        .orderBy('id', 'asc')
      assert.deepEqual(rows, [
        { provider: 'cd', target_price_cents: 80_000, target_price_currency: 'CZK' },
        { provider: 'koleo', target_price_cents: 5_500, target_price_currency: 'PLN' },
        { provider: 'cd', target_price_cents: null, target_price_currency: 'PLN' },
      ])
    } finally {
      await connection.schema.dropTableIfExists(tableName)
    }
  })

  test('renders search results and saves a watched connection', async ({ client, assert }) => {
    const travelDate = futureDate()
    const user = await User.create({
      fullName: 'Konto testowe',
      email: 'qa@example.test',
      password: 'Qa-Test-2026!',
    })

    const dashboard = await client
      .get('/dashboard')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
    dashboard.assertStatus(200)
    dashboard.assertTextIncludes('Dokąd jedziesz?')
    dashboard.assertTextIncludes('Tryb demo')

    const search = await client
      .post('/search')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({
        origin: 'Wrocław Główny',
        originStationId: '1',
        destination: 'Olsztyn Główny',
        destinationStationId: '4',
        travelDate,
        departureTime: '14:54',
        onlyDirect: 'true',
      })

    search.assertStatus(200)
    search.assertTextIncludes('POŁĄCZENIE DEMO 100')
    search.assertTextIncludes('Obserwuj cenę')
    search.assertTextIncludes('Zakup niedostępny')

    const store = await client
      .post('/favorites')
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({
        origin: 'Wrocław Główny',
        originStationId: '1',
        destination: 'Olsztyn Główny',
        destinationStationId: '4',
        travelDate,
        departureTime: '14:54',
        arrivalTime: '20:01',
        arrivalDate: travelDate,
        connectionUuid: 'demo-flow-1',
        trainName: 'POŁĄCZENIE DEMO 100',
        priceCents: '7900',
        targetPrice: '65.00',
        notificationChannel: 'sms',
        notificationDestination: 'attacker@example.test',
        checkIntervalMinutes: '30',
      })

    store.assertStatus(302)
    store.assertHeader('location', '/favorites')

    const favorite = await PriceWatch.query().where('userId', user.id).firstOrFail()
    assert.equal(favorite.origin, 'Wrocław Główny')
    assert.equal(favorite.originStationId, 1)
    assert.equal(favorite.destinationStationId, 4)
    assert.equal(favorite.arrivalDate!.toISODate(), travelDate)
    assert.equal(favorite.targetPriceCents, 6500)
    assert.equal(favorite.checkIntervalMinutes, 30)
    assert.equal(favorite.notificationChannel, 'email')
    assert.equal(favorite.notificationDestination, user.email)
    assert.equal(
      await PriceObservation.query()
        .where('priceWatchId', favorite.id)
        .count('* as total')
        .first()
        .then((row) => Number(row!.$extras.total)),
      1
    )

    const favorites = await client
      .get('/favorites')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
    favorites.assertStatus(200)
    favorites.assertTextIncludes('<title>Monitorowane połączenia - Koleo Watch</title>')
    favorites.assertTextIncludes('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    favorites.assertTextIncludes('Wrocław Główny')
    favorites.assertTextIncludes('79,00')
    favorites.assertTextIncludes('qa•••@example.test')
    assert.notInclude(favorites.text(), user.email)
  })

  test('renders UTC watch timestamps in the configured application timezone', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Konto strefy czasowej',
      email: 'timezone@example.test',
      password: 'Qa-Test-2026!',
    })
    const lastCheckedAt = DateTime.fromISO('2026-11-25T09:05:52Z')
    const nextCheckAt = DateTime.fromISO('2026-11-25T09:35:52Z')
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '07:10',
      connectionUuid: 'demo-timezone',
      baselinePriceCents: 7_900,
      lastPriceCents: 7_900,
      lowestPriceCents: 7_900,
      checkIntervalMinutes: 30,
      lastCheckedAt,
      nextCheckAt,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    await PriceObservation.create({
      priceWatchId: watch.id,
      priceCents: 7_900,
      observedAt: lastCheckedAt,
    })

    const response = await client
      .get('/favorites')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('25.11.2026 10:05:52')
    response.assertTextIncludes('25.11.2026 10:35')
    assert.notInclude(response.text(), '25.11.2026 09:05')
    assert.notInclude(response.text(), '25.11.2026 09:35')
  })

  test('renders an empty result instead of an error when KOLEO finds no connections', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Konto pustego wyniku',
      email: 'empty-search@example.test',
      password: 'Qa-Test-2026!',
    })
    const originalSearch = ConnectionSearchService.prototype.search
    ConnectionSearchService.prototype.search = async () => []

    try {
      const response = await client
        .post('/search')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({
          origin: 'Wrocław Główny',
          originStationId: '1',
          destination: 'Olsztyn Główny',
          destinationStationId: '4',
          travelDate: futureDate(),
          onlyDirect: 'true',
        })

      response.assertStatus(200)
      response.assertTextIncludes('Brak połączeń dla wybranych parametrów')
      assert.notInclude(response.text(), 'No connections found.')
      assert.notInclude(response.text(), 'Nie udało się wyszukać')
    } finally {
      ConnectionSearchService.prototype.search = originalSearch
    }
  })

  test('rejects new watches after the configured per-user limit', async ({ client, assert }) => {
    const travelDate = futureDate()
    const maximumWatches = env.get('PRICE_WATCH_MAX_PER_USER')
    const user = await User.create({
      fullName: 'Konto limitu obserwacji',
      email: 'watch-limit@example.test',
      password: 'Qa-Test-2026!',
    })
    await PriceWatch.createMany(
      Array.from({ length: maximumWatches }, (_, index) => ({
        userId: user.id,
        origin: 'Wrocław Główny',
        destination: 'Olsztyn Główny',
        travelDate: DateTime.fromISO(travelDate),
        departureTime: `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
        connectionUuid: `demo-limit-${index}`,
        notificationChannel: 'email',
        notificationDestination: user.email,
        status: 'active',
      }))
    )

    const response = await client
      .post('/favorites')
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({
        origin: 'Wrocław Główny',
        originStationId: '1',
        destination: 'Olsztyn Główny',
        destinationStationId: '4',
        travelDate,
        departureTime: '23:30',
        connectionUuid: 'demo-over-limit',
      })

    response.assertStatus(302)
    assert.equal(
      await PriceWatch.query()
        .where('userId', user.id)
        .count('* as total')
        .firstOrFail()
        .then((row) => Number(row.$extras.total)),
      maximumWatches
    )
  })

  test('detects a lower price and sends a fake notification', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto alertowe',
      email: 'alerts@example.test',
      password: 'Qa-Test-2026!',
    })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Olsztyn Główny',
      originStationId: 4,
      destination: 'Wrocław Główny',
      destinationStationId: 1,
      travelDate: futureDate(),
      departureTime: '08:00',
      onlyDirect: false,
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Olsztyn Główny',
      originStationId: 4,
      destination: 'Wrocław Główny',
      destinationStationId: 1,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '08:00',
      connectionUuid: connection.uuid,
      baselinePriceCents: 20_000,
      lastPriceCents: 20_000,
      lowestPriceCents: 20_000,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const summary = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()

    assert.equal(summary.checked, 1)
    assert.equal(summary.priceChanges, 1)
    assert.equal(summary.priceDrops, 1)
    assert.equal(summary.priceIncreases, 0)
    assert.equal(summary.alertsQueued, 1)
    assert.equal(summary.delivered, 1)
    assert.isBelow(watch.lastPriceCents!, 20_000)
    assert.isNotNull(watch.lastCheckedAt)
    assert.isNotNull(watch.lastNotifiedAt)
    assert.equal(watch.lastNotifiedPriceCents, watch.lastPriceCents)
    const observationCount = await PriceObservation.query()
      .where('priceWatchId', watch.id)
      .count('* as total')
      .firstOrFail()
    assert.equal(Number(observationCount.$extras.total), 1)
  })

  test('records a price increase and sends an alert even above the target', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto ze wzrostem ceny',
      email: 'increase@example.test',
      password: 'Qa-Test-2026!',
    })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDate(),
      departureTime: '14:54',
      onlyDirect: false,
    })
    const previousPrice = connection.priceCents! - 1_000
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: connection.departure,
      arrivalTime: connection.arrival,
      arrivalDate: DateTime.fromISO(connection.arrivalDate),
      trainName: connection.trains,
      connectionUuid: connection.uuid,
      baselinePriceCents: previousPrice,
      lastPriceCents: previousPrice,
      lowestPriceCents: previousPrice,
      targetPriceCents: previousPrice - 1,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const summary = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()
    const alert = await AlertOutbox.query().where('priceWatchId', watch.id).firstOrFail()

    assert.equal(summary.checked, 1)
    assert.equal(summary.priceChanges, 1)
    assert.equal(summary.priceDrops, 0)
    assert.equal(summary.priceIncreases, 1)
    assert.equal(summary.alertsQueued, 1)
    assert.equal(summary.delivered, 1)
    assert.equal(watch.lastPriceCents, connection.priceCents)
    assert.equal(watch.lastNotifiedPriceCents, connection.priceCents)
    assert.include(alert.subject, 'Cena wzrosła')
    assert.include(alert.body, 'wzrosła')
  })

  test('keeps price history bounded and skips unchanged prices', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto historii cen',
      email: 'history@example.test',
      password: 'Qa-Test-2026!',
    })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDate(),
      departureTime: '14:54',
      onlyDirect: false,
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '14:54',
      connectionUuid: connection.uuid,
      baselinePriceCents: connection.priceCents,
      lastPriceCents: connection.priceCents,
      lowestPriceCents: connection.priceCents,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    await PriceObservation.createMany([
      {
        priceWatchId: watch.id,
        priceCents: connection.priceCents!,
        observedAt: DateTime.utc().minus({ days: env.get('PRICE_HISTORY_RETENTION_DAYS') + 1 }),
      },
      {
        priceWatchId: watch.id,
        priceCents: connection.priceCents!,
        observedAt: DateTime.utc(),
      },
    ])

    await new PriceObservationRetentionService().pruneExpired()
    await new PriceAlertService().checkForUser(user.id)

    const observations = await PriceObservation.query().where('priceWatchId', watch.id)
    assert.lengthOf(observations, 1)
    assert.equal(observations[0].priceCents, connection.priceCents)
  })

  test('claims a watch atomically and creates only one outbox delivery', async ({ assert }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      fullName: 'Konto współbieżne',
      email: 'concurrent@example.test',
      password: 'Qa-Test-2026!',
    })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Olsztyn Główny',
      originStationId: 4,
      destination: 'Wrocław Główny',
      destinationStationId: 1,
      travelDate: futureDate(),
      departureTime: '08:00',
      onlyDirect: false,
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Olsztyn Główny',
      originStationId: 4,
      destination: 'Wrocław Główny',
      destinationStationId: 1,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '08:00',
      connectionUuid: connection.uuid,
      baselinePriceCents: connection.priceCents! + 5_000,
      lastPriceCents: connection.priceCents! + 5_000,
      lowestPriceCents: connection.priceCents! + 5_000,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const summaries = await Promise.all([
      new PriceAlertService().checkForUser(user.id),
      new PriceAlertService().checkForUser(user.id),
    ])

    assert.equal(
      summaries.reduce((total, summary) => total + summary.checked, 0),
      1
    )
    assert.equal(
      summaries.reduce((total, summary) => total + summary.delivered, 0),
      1
    )
    assert.equal(
      await AlertOutbox.query()
        .where('priceWatchId', watch.id)
        .count('* as total')
        .firstOrFail()
        .then((row) => Number(row.$extras.total)),
      1
    )
    assert.lengthOf(fakeMailer.messages.sent(), 1)
  })

  test('refreshes a changed UUID only for one equivalent connection', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto ze zmienionym UUID',
      email: 'uuid-refresh@example.test',
      password: 'Qa-Test-2026!',
    })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDate(),
      departureTime: '14:54',
      onlyDirect: false,
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: connection.departure,
      arrivalTime: connection.arrival,
      arrivalDate: DateTime.fromISO(connection.arrivalDate),
      trainName: connection.trains,
      connectionUuid: 'outdated-connection-uuid',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const summary = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()

    assert.equal(summary.errors, 0)
    assert.equal(watch.connectionUuid, connection.uuid)
    assert.equal(watch.connectionMissCount, 0)
    assert.equal(watch.status, 'active')
  })

  test('stops a watch only after the configured number of consecutive misses', async ({
    assert,
  }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      fullName: 'Konto bez połączenia',
      email: 'missing@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '14:54',
      connectionUuid: 'connection-that-does-not-exist',
      baselinePriceCents: 10_000,
      lastPriceCents: 10_000,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const threshold = env.get('ALERT_CONNECTION_MISSING_THRESHOLD')
    for (let attempt = 1; attempt < threshold; attempt += 1) {
      const summary = await new PriceAlertService().checkForUser(user.id)
      await watch.refresh()
      assert.equal(summary.errors, 1)
      assert.equal(watch.status, 'active')
      assert.equal(watch.connectionMissCount, attempt)
      assert.isNotNull(watch.nextCheckAt)
    }

    const finalSummary = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()

    assert.equal(finalSummary.errors, 1)
    assert.equal(finalSummary.delivered, 0)
    assert.equal(watch.status, 'connection_missing')
    assert.equal(watch.connectionMissCount, threshold)
    assert.isNull(watch.nextCheckAt)
    assert.include(watch.lastErrorMessage!, `${threshold} kolejnych sprawdzeniach`)
    assert.lengthOf(fakeMailer.messages.sent(), 0)
  })

  test('keeps a watch active while ticket sales are unavailable', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto oczekujące na sprzedaż',
      email: 'waiting-for-sale@example.test',
      password: 'Qa-Test-2026!',
    })
    const travelDate = futureDate()
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Gdańsk Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(travelDate),
      departureTime: '13:02',
      arrivalTime: '17:40',
      arrivalDate: DateTime.fromISO(travelDate),
      trainName: '45112 ARTUS (P03)',
      connectionUuid: 'waiting-for-sale-uuid',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    const originalSearch = ConnectionSearchService.prototype.search
    ConnectionSearchService.prototype.search = async () => [
      {
        uuid: 'waiting-for-sale-uuid',
        departure: '13:02',
        departureMinutes: 782,
        departureDate: travelDate,
        arrival: '17:40',
        arrivalDate: travelDate,
        arrivalDateLabel: DateTime.fromISO(travelDate).toFormat('dd.LL.yyyy'),
        arrivalDayOffset: 0,
        durationMinutes: 278,
        trains: '45112 ARTUS (P03)',
        changes: 0,
        priceCents: null,
        purchasable: null,
        ticketAvailability: 'unavailable',
        availabilityMessage: 'Nie rozpoczęła się jeszcze sprzedaż biletów na ten pociąg.',
        provider: 'koleo',
      },
    ]

    try {
      const summary = await new PriceAlertService().checkForUser(user.id)
      await watch.refresh()

      assert.equal(summary.checked, 1)
      assert.equal(summary.errors, 0)
      assert.equal(watch.status, 'active')
      assert.equal(watch.lastTicketAvailability, 'unavailable')
      assert.include(watch.lastAvailabilityMessage!, 'sprzedaż biletów')
      assert.isNull(watch.lastErrorMessage)
      assert.isNotNull(watch.nextCheckAt)
    } finally {
      ConnectionSearchService.prototype.search = originalSearch
    }
  })

  test('alerts about a numeric price change even when purchase is temporarily unavailable', async ({
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Konto zmiany ceny bez sprzedaży',
      email: 'unavailable-price-change@example.test',
      password: 'Qa-Test-2026!',
    })
    const travelDate = futureDate()
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(travelDate),
      departureTime: '14:54',
      arrivalTime: '20:01',
      arrivalDate: DateTime.fromISO(travelDate),
      trainName: '6118 NIEGOCIN',
      connectionUuid: 'temporarily-unavailable-price-uuid',
      baselinePriceCents: 7_900,
      lastPriceCents: 7_900,
      lowestPriceCents: 7_900,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    const originalSearch = ConnectionSearchService.prototype.search
    ConnectionSearchService.prototype.search = async () => [
      {
        uuid: 'temporarily-unavailable-price-uuid',
        departure: '14:54',
        departureMinutes: 894,
        departureDate: travelDate,
        arrival: '20:01',
        arrivalDate: travelDate,
        arrivalDateLabel: DateTime.fromISO(travelDate).toFormat('dd.LL.yyyy'),
        arrivalDayOffset: 0,
        durationMinutes: 307,
        trains: '6118 NIEGOCIN',
        changes: 0,
        priceCents: 11_771,
        purchasable: false,
        ticketAvailability: 'unavailable',
        availabilityMessage: 'Zakup jest chwilowo niedostępny.',
        provider: 'koleo',
      },
    ]

    try {
      const summary = await new PriceAlertService().checkForUser(user.id)
      await watch.refresh()
      const alert = await AlertOutbox.query().where('priceWatchId', watch.id).firstOrFail()

      assert.equal(summary.priceChanges, 1)
      assert.equal(summary.priceIncreases, 1)
      assert.equal(summary.alertsQueued, 1)
      assert.equal(summary.delivered, 1)
      assert.equal(watch.lastPriceCents, 11_771)
      assert.include(alert.subject, 'Cena wzrosła')
    } finally {
      ConnectionSearchService.prototype.search = originalSearch
    }
  })

  test('enforces the configured daily outbox limit per user', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto limitu dziennego',
      email: 'daily-limit@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '14:54',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    const outbox = new AlertOutboxService()
    const dailyLimit = env.get('ALERT_DAILY_MAX_MESSAGES_PER_USER')

    for (let index = 0; index < dailyLimit; index += 1) {
      assert.equal(await outbox.enqueuePriceAlert(watch, 20_000, 10_000 - index), 'queued')
    }

    assert.equal(await outbox.enqueuePriceAlert(watch, 20_000, 9_000), 'daily_limit')
    assert.equal(
      await AlertOutbox.query()
        .where('userId', user.id)
        .count('* as total')
        .firstOrFail()
        .then((row) => Number(row.$extras.total)),
      dailyLimit
    )
  })

  test('retries a failed outbox delivery with the same delivery identifier', async ({ assert }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      fullName: 'Konto ponowień',
      email: 'retry@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '14:54',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    const outboxService = new AlertOutboxService()
    await outboxService.enqueuePriceAlert(watch, 10_000, 9_000)
    const originalSend = NotificationService.prototype.sendQueuedAlert
    NotificationService.prototype.sendQueuedAlert = async () => {
      throw new Error('Kontrolowany błąd SMTP')
    }

    try {
      const failedAttempt = await outboxService.processPending(user.id)
      assert.equal(failedAttempt.errors, 1)
    } finally {
      NotificationService.prototype.sendQueuedAlert = originalSend
    }

    const queued = await AlertOutbox.query().where('userId', user.id).firstOrFail()
    const deliveryId = queued.deliveryId
    assert.equal(queued.status, 'retry')
    assert.equal(queued.attemptCount, 1)
    queued.availableAt = DateTime.utc().minus({ seconds: 1 })
    await queued.save()

    const retried = await outboxService.processPending(user.id)
    await queued.refresh()
    assert.equal(retried.delivered, 1)
    assert.equal(queued.status, 'sent')
    assert.equal(queued.deliveryId, deliveryId)
    assert.equal(queued.attemptCount, 2)
    assert.equal(
      fakeMailer.messages.sent()[0].nodeMailerMessage.messageId,
      `<${deliveryId}@example.com>`
    )
  })

  test('notifies about a change above the target and about an inclusive target', async ({
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Konto z progiem',
      email: 'threshold@example.test',
      password: 'Qa-Test-2026!',
    })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDate(),
      departureTime: '14:54',
      onlyDirect: false,
    })
    const currentPrice = connection.priceCents!
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '14:54',
      connectionUuid: connection.uuid,
      baselinePriceCents: currentPrice + 5_000,
      lastPriceCents: currentPrice + 5_000,
      lowestPriceCents: currentPrice + 5_000,
      targetPriceCents: currentPrice - 1,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const aboveTarget = await new PriceAlertService().checkForUser(user.id)
    assert.equal(aboveTarget.priceChanges, 1)
    assert.equal(aboveTarget.priceDrops, 1)
    assert.equal(aboveTarget.alertsQueued, 1)
    assert.equal(aboveTarget.delivered, 1)

    watch.targetPriceCents = currentPrice
    watch.lastNotifiedPriceCents = null
    await watch.save()
    const atTarget = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()

    assert.equal(atTarget.priceChanges, 0)
    assert.equal(atTarget.unchanged, 1)
    assert.equal(atTarget.alertsQueued, 1)
    assert.equal(atTarget.delivered, 1)
    assert.equal(watch.lastNotifiedPriceCents, currentPrice)
  })

  test('checks only due watches and expires them at departure time', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto harmonogramu',
      email: 'schedule@example.test',
      password: 'Qa-Test-2026!',
    })
    const futureDeparture = DateTime.utc().plus({ days: 2 }).set({ hour: 12, minute: 0 })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDeparture.toISODate()!,
      departureTime: futureDeparture.toFormat('HH:mm'),
      onlyDirect: false,
    })
    const scheduled = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDeparture,
      departureTime: futureDeparture.toFormat('HH:mm'),
      connectionUuid: connection.uuid,
      checkIntervalMinutes: 30,
      nextCheckAt: DateTime.utc().plus({ hours: 1 }),
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const beforeDue = await new PriceAlertService().checkAllActive()
    assert.equal(beforeDue.checked, 0)

    scheduled.nextCheckAt = DateTime.utc().minus({ minutes: 1 })
    await scheduled.save()
    const whenDue = await new PriceAlertService().checkAllActive()
    await scheduled.refresh()
    assert.equal(whenDue.checked, 1)
    assert.isAbove(scheduled.nextCheckAt!.toMillis(), DateTime.utc().toMillis())

    const pastDeparture = DateTime.utc().minus({ minutes: 1 })
    scheduled.travelDate = pastDeparture.startOf('day')
    scheduled.departureTime = pastDeparture.toFormat('HH:mm')
    scheduled.nextCheckAt = DateTime.utc().minus({ minutes: 1 })
    await scheduled.save()

    await new PriceAlertService().checkAllActive()
    await scheduled.refresh()
    assert.equal(scheduled.status, 'expired')
    assert.isNull(scheduled.nextCheckAt)
  })

  test('updates threshold and lets the owner pause and resume a watch', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Konto ustawień',
      email: 'settings@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: DateTime.utc().plus({ days: 2 }),
      departureTime: '14:54',
      checkIntervalMinutes: 30,
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const settings = await client
      .post(`/favorites/${watch.id}/settings`)
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({ targetPrice: '55.50', checkIntervalMinutes: '60' })
    settings.assertStatus(302)
    await watch.refresh()
    assert.equal(watch.targetPriceCents, 5550)
    assert.equal(watch.checkIntervalMinutes, 60)

    const pause = await client
      .post(`/favorites/${watch.id}/status`)
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({ status: 'paused' })
    pause.assertStatus(302)
    await watch.refresh()
    assert.equal(watch.status, 'paused')
    assert.isNull(watch.nextCheckAt)

    const resume = await client
      .post(`/favorites/${watch.id}/status`)
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({ status: 'active' })
    resume.assertStatus(302)
    await watch.refresh()
    assert.equal(watch.status, 'active')
    assert.isNotNull(watch.nextCheckAt)
  })

  test('persists the reason when a legacy watch cannot be checked', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto błędu',
      email: 'failure@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: DateTime.fromISO(futureDate()),
      departureTime: '14:54',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })

    const summary = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()

    assert.equal(summary.errors, 1)
    assert.include(watch.lastErrorMessage!, 'identyfikatorów stacji')
    assert.isNotNull(watch.lastErrorAt)
  })

  test('alerts when the NBP rate alone crosses a PLN threshold and saves each rate snapshot', async ({
    assert,
    client,
  }) => {
    const originalFetch = globalThis.fetch
    const originalSearch = ConnectionSearchService.prototype.searchForWatch
    const travelDate = futureDate()
    const user = await User.create({
      fullName: 'Konto kursowe',
      email: 'fx-watch@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      provider: 'cd',
      origin: 'Brno hl.n.',
      originStationId: 5_433_295,
      destination: 'Wroclaw Glowny; Poland',
      destinationStationId: 5_100_069,
      travelDate: DateTime.fromISO(travelDate),
      departureTime: '14:56',
      arrivalTime: '18:45',
      arrivalDate: DateTime.fromISO(travelDate),
      trainName: 'EC 281',
      connectionUuid: 'cd-fx-test',
      baselinePriceCents: 62_000,
      lastPriceCents: 62_000,
      lowestPriceCents: 62_000,
      targetPriceCents: 12_000,
      targetPriceCurrency: 'PLN',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    const connection = {
      uuid: 'cd-fx-test',
      departure: '14:56',
      departureMinutes: 896,
      departureDate: travelDate,
      arrival: '18:45',
      arrivalDate: travelDate,
      arrivalDateLabel: '',
      arrivalDayOffset: 0,
      durationMinutes: 229,
      trains: 'EC 281',
      changes: 0,
      priceCents: 62_000,
      purchasable: true,
      ticketAvailability: 'available' as const,
      availabilityMessage: null,
      provider: 'cd' as const,
    }
    ConnectionSearchService.prototype.searchForWatch = async (_input, select) => ({
      connection: select([connection]) === connection.uuid ? connection : null,
      resultCount: 1,
    })
    const rates = new Map([
      ['above', { no: '10/A/NBP/2026', mid: 0.2 }],
      ['below', { no: '11/A/NBP/2026', mid: 0.19 }],
      ['above-again', { no: '12/A/NBP/2026', mid: 0.21 }],
      ['below-again', { no: '13/A/NBP/2026', mid: 0.18 }],
    ])
    globalThis.fetch = async (input) => {
      const url = String(input)
      const phase = url === 'https://nbp.example.test/czk' ? 'below-again' : url.split('/').at(-1)!
      if (phase === 'unavailable') return new Response(null, { status: 503 })
      const rate = rates.get(phase)
      if (!rate) throw new Error(`Unexpected test request: ${url}`)
      return Response.json({
        table: 'A',
        code: 'CZK',
        rates: [{ ...rate, effectiveDate: '2026-11-27' }],
      })
    }
    const checkWithRate = (phase: string, userId = user.id) =>
      new PriceAlertService(
        new NbpExchangeRateService({ url: `https://nbp.example.test/czk-fx/${phase}` })
      ).checkForUser(userId)

    try {
      const above = await checkWithRate('above')
      await watch.refresh()
      assert.equal(above.alertsQueued, 0)
      assert.equal(watch.lastTargetMet, false)

      const unavailable = await checkWithRate('unavailable')
      await watch.refresh()
      assert.equal(unavailable.alertsQueued, 0)
      assert.equal(watch.lastTargetMet, false)

      const below = await checkWithRate('below')
      await watch.refresh()
      assert.equal(below.priceChanges, 0)
      assert.equal(below.alertsQueued, 1)
      assert.equal(below.delivered, 1)
      assert.equal(watch.lastTargetMet, true)
      const firstAlert = await AlertOutbox.query().where('priceWatchId', watch.id).firstOrFail()
      assert.include(firstAlert.subject, 'kursu NBP')
      assert.include(firstAlert.body, '117,80')
      assert.include(firstAlert.body, '2026-11-27')

      const repeated = await checkWithRate('below')
      assert.equal(repeated.alertsQueued, 0)
      const repeatedObservations = await PriceObservation.query().where('priceWatchId', watch.id)
      assert.equal(repeatedObservations.length, 2)

      await checkWithRate('above-again')
      await watch.refresh()
      assert.equal(watch.lastTargetMet, false)
      const secondCrossing = await checkWithRate('below-again')
      assert.equal(secondCrossing.priceChanges, 0)
      assert.equal(secondCrossing.alertsQueued, 1)
      assert.equal(secondCrossing.delivered, 1)

      const observations = await PriceObservation.query()
        .where('priceWatchId', watch.id)
        .orderBy('id', 'asc')
      assert.deepEqual(
        observations.map((observation) => observation.comparedPriceCents),
        [12_400, 11_780, 13_020, 11_160]
      )
      assert.deepEqual(
        observations.map((observation) => Boolean(observation.targetMet)),
        [false, true, false, true]
      )
      assert.deepEqual(
        observations.map((observation) => observation.nbpTableNumber),
        [...rates.values()].map((rate) => rate.no)
      )
      assert.equal(observations[1].nbpRateMid, '0.19')
      assert.equal(observations[1].nbpEffectiveDate, '2026-11-27')
      const alerts = await AlertOutbox.query().where('priceWatchId', watch.id)
      assert.equal(alerts.length, 2)

      const favorites = await client
        .get('/favorites')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
      favorites.assertStatus(200)
      favorites.assertTextIncludes('11/A/NBP/2026')
      favorites.assertTextIncludes('117,80')

      const previouslyAlertedUser = await User.create({
        fullName: 'Konto sprzed migracji',
        email: 'old-fx-watch@example.test',
        password: 'Qa-Test-2026!',
      })
      const previouslyAlerted = await PriceWatch.create({
        userId: previouslyAlertedUser.id,
        provider: 'cd',
        origin: watch.origin,
        originStationId: watch.originStationId,
        destination: watch.destination,
        destinationStationId: watch.destinationStationId,
        travelDate: DateTime.fromISO(travelDate),
        departureTime: watch.departureTime,
        connectionUuid: connection.uuid,
        lastPriceCents: connection.priceCents,
        lastNotifiedPriceCents: connection.priceCents,
        targetPriceCents: 12_000,
        targetPriceCurrency: 'PLN',
        notificationChannel: 'email',
        notificationDestination: previouslyAlertedUser.email,
        status: 'active',
      })
      const migratedCheck = await checkWithRate('below', previouslyAlertedUser.id)
      await previouslyAlerted.refresh()
      assert.equal(migratedCheck.alertsQueued, 0)
      assert.equal(Boolean(previouslyAlerted.lastTargetMet), true)
    } finally {
      await new NbpExchangeRateService({
        url: 'https://nbp.example.test/czk-fx/above',
      }).getCzkRate()
      globalThis.fetch = originalFetch
      ConnectionSearchService.prototype.searchForWatch = originalSearch
    }
  })

  test('tracks a ČD price change and evaluates a PLN threshold with a mocked public site', async ({
    assert,
    client,
  }) => {
    const originalFetch = globalThis.fetch
    const travelDate = futureDate()
    const cdDate = DateTime.fromISO(travelDate).toFormat('dd.LL.yyyy')
    const user = await User.create({
      fullName: 'Konto ČD',
      email: 'cd-watch@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      provider: 'cd',
      origin: 'Brno hl.n.',
      originStationId: 5_433_295,
      destination: 'Wroclaw Glowny; Poland',
      destinationStationId: 5_100_069,
      travelDate: DateTime.fromISO(travelDate),
      departureTime: '14:56',
      arrivalTime: '18:45',
      arrivalDate: DateTime.fromISO(travelDate),
      trainName: 'EC 281',
      baselinePriceCents: 50_000,
      lastPriceCents: 50_000,
      lowestPriceCents: 50_000,
      targetPriceCents: 11_365,
      targetPriceCurrency: 'PLN',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.startsWith('https://cd.example.test/stations?')) {
        const query = new URL(url).searchParams.get('prefixText')
        const station = query?.startsWith('Brno')
          ? { selectedText: 'Brno hl.n.', iconId: 3, value: '5433295' }
          : { selectedText: 'Wroclaw Glowny; Poland', iconId: 3, value: '5100069' }
        return new Response(`cdwatch(${JSON.stringify([station])});`)
      }
      if (url === 'https://nbp.example.test/czk') {
        return Response.json({
          table: 'A',
          code: 'CZK',
          rates: [{ no: '1/A/NBP/2026', effectiveDate: '2026-11-26', mid: 0.1833 }],
        })
      }
      if (url.includes('/apiform?')) {
        return new Response(null, {
          status: 302,
          headers: { location: '/en/spojeni-a-jizdenka/spojeni-tam/test-guid' },
        })
      }
      if (url.includes('/spojeni-tam/')) {
        const model = {
          guid: 'test-guid',
          pageType: 0,
          list: [
            {
              handle: 123,
              id: 456,
              auxDesc: 'route',
              changesCount: 0,
              trains: [
                {
                  trainName: 'EC 281',
                  trainNum: '281',
                  from: 'Brno hl.n.',
                  to: 'Wroclaw Glowny',
                  depDate: cdDate,
                  depTime: '14:56',
                  arrDate: cdDate,
                  arrTime: '18:45',
                },
              ],
            },
          ],
        }
        return new Response(
          `<input name="__RequestVerificationToken" type="hidden" value="token" />\nvar model = ${JSON.stringify(model)};`
        )
      }
      if (url.includes('/GetConnListPrice/')) {
        return Response.json({ list: [{ id: 456, price: { price: 62_000, canProceed: true } }] })
      }
      throw new Error(`Unexpected test request: ${url}`)
    }
    try {
      const summary = await new PriceAlertService().checkForUser(user.id)
      await watch.refresh()
      const alert = await AlertOutbox.query().where('priceWatchId', watch.id).firstOrFail()
      assert.equal(summary.priceIncreases, 1)
      assert.equal(summary.alertsQueued, 1)
      assert.equal(summary.delivered, 1)
      assert.equal(watch.lastPriceCents, 62_000)
      assert.equal(watch.provider, 'cd')
      assert.equal(watch.targetPriceCents, 11_365)
      assert.equal(watch.targetPriceCurrency, 'PLN')
      assert.include(alert.body, 'CZK')
      assert.include(alert.body, '113,65')
      assert.include(alert.body, 'próg alertu w PLN')
      const favorites = await client
        .get('/favorites')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
      favorites.assertStatus(200)
      favorites.assertTextIncludes('620,00')
      favorites.assertTextIncludes('113,65')
      favorites.assertTextIncludes('Próg ceny (PLN)')

      watch.lastTargetMet = false
      await watch.save()
      const inclusive = await new PriceAlertService().checkForUser(user.id)
      assert.equal(inclusive.priceChanges, 0)
      assert.equal(inclusive.alertsQueued, 1)

      await watch.refresh()
      watch.targetPriceCents = 11_364
      watch.lastTargetMet = false
      await watch.save()
      const belowTarget = await new PriceAlertService().checkForUser(user.id)
      assert.equal(belowTarget.priceChanges, 0)
      assert.equal(belowTarget.alertsQueued, 0)

      await watch.refresh()
      watch.targetPriceCents = 70_000
      watch.targetPriceCurrency = 'CZK'
      watch.lastTargetMet = false
      await watch.save()
      const legacyTarget = await new PriceAlertService().checkForUser(user.id)
      assert.equal(legacyTarget.priceChanges, 0)
      assert.equal(legacyTarget.alertsQueued, 1)
      const legacyFavorites = await client
        .get('/favorites')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
      legacyFavorites.assertStatus(200)
      legacyFavorites.assertTextIncludes('Dotychczasowy próg')
      legacyFavorites.assertTextIncludes('700,00')

      const settings = await client
        .post(`/favorites/${watch.id}/settings`)
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ targetPrice: '120.00', checkIntervalMinutes: '30' })
      settings.assertStatus(302)
      await watch.refresh()
      assert.equal(watch.targetPriceCents, 12_000)
      assert.equal(watch.targetPriceCurrency, 'PLN')

      const search = await client
        .post('/search')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({
          provider: 'cd',
          origin: watch.origin,
          originStationId: String(watch.originStationId),
          destination: watch.destination,
          destinationStationId: String(watch.destinationStationId),
          travelDate,
          departureTime: watch.departureTime,
        })
      search.assertStatus(200)
      search.assertTextIncludes('Maksymalna cena do alertu w PLN')

      const store = await client
        .post('/favorites')
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({
          provider: 'cd',
          origin: watch.origin,
          originStationId: String(watch.originStationId),
          destination: watch.destination,
          destinationStationId: String(watch.destinationStationId),
          travelDate,
          departureTime: watch.departureTime,
          connectionUuid: watch.connectionUuid!,
          targetPrice: '110.00',
          checkIntervalMinutes: '30',
        })
      store.assertStatus(302)
      await watch.refresh()
      assert.equal(watch.targetPriceCents, 11_000)
      assert.equal(watch.targetPriceCurrency, 'PLN')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
