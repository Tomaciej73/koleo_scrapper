import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import AlertOutbox from '#models/alert_outbox'
import User from '#models/user'
import PriceAlertService from '#services/price_alert_service'
import ConnectionSearchService from '#services/connection_search_service'
import AlertOutboxService from '#services/alert_outbox_service'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import limiter from '@adonisjs/limiter/services/main'

const futureDate = () => DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate()!

test.group('Price watch flow', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('renders search results and saves a watched connection', async ({ client, assert }) => {
    const travelDate = futureDate()
    const user = await User.create({
      fullName: 'Konto testowe',
      email: 'qa@example.test',
      password: 'Qa-Test-2026!',
    })

    const dashboard = await client.get('/dashboard').loginAs(user)
    dashboard.assertStatus(200)
    dashboard.assertTextIncludes('Dokąd jedziesz?')
    dashboard.assertTextIncludes('Tryb demo')

    const search = await client.post('/search').loginAs(user).withCsrfToken().form({
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

    const store = await client.post('/favorites').redirects(0).loginAs(user).withCsrfToken().form({
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

    const favorites = await client.get('/favorites').loginAs(user)
    favorites.assertStatus(200)
    favorites.assertTextIncludes('Obserwowane połączenia')
    favorites.assertTextIncludes('Wrocław Główny')
    favorites.assertTextIncludes('79,00')
    favorites.assertTextIncludes('qa•••@example.test')
    assert.notInclude(favorites.text(), user.email)
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
    assert.equal(summary.priceDrops, 1)
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

  test('stops a watch when its exact connection UUID is missing', async ({ assert }) => {
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

    const summary = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()

    assert.equal(summary.errors, 1)
    assert.equal(summary.delivered, 0)
    assert.equal(watch.status, 'connection_missing')
    assert.isNull(watch.nextCheckAt)
    assert.include(watch.lastErrorMessage!, 'dokładnie obserwowanego połączenia')
    assert.lengthOf(fakeMailer.messages.sent(), 0)
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

  test('notifies at an inclusive target but ignores decreases above it', async ({ assert }) => {
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
    assert.equal(aboveTarget.priceDrops, 0)
    assert.equal(aboveTarget.delivered, 0)

    watch.targetPriceCents = currentPrice
    await watch.save()
    const atTarget = await new PriceAlertService().checkForUser(user.id)
    await watch.refresh()

    assert.equal(atTarget.priceDrops, 1)
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
})
