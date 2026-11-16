import PriceWatch from '#models/price_watch'
import User from '#models/user'
import PriceAlertService from '#services/price_alert_service'
import ConnectionSearchService from '#services/connection_search_service'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Price watch flow', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('renders search results and saves a watched connection', async ({ client, assert }) => {
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
      destination: 'Olsztyn Główny',
      travelDate: '2026-11-17',
      departureTime: '14:54',
      onlyDirect: 'true',
    })

    search.assertStatus(200)
    search.assertTextIncludes('POŁĄCZENIE DEMO 100')
    search.assertTextIncludes('Obserwuj cenę')

    const store = await client.post('/favorites').redirects(0).loginAs(user).withCsrfToken().form({
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: '2026-11-17',
      departureTime: '14:54',
      arrivalTime: '20:01',
      connectionUuid: 'demo-flow-1',
      trainName: 'POŁĄCZENIE DEMO 100',
      priceCents: '7900',
      targetPrice: '65.00',
      notificationChannel: 'email',
      notificationDestination: user.email,
      checkIntervalMinutes: '30',
    })

    store.assertStatus(302)
    store.assertHeader('location', '/favorites')

    const favorite = await PriceWatch.query().where('userId', user.id).firstOrFail()
    assert.equal(favorite.origin, 'Wrocław Główny')
    assert.equal(favorite.targetPriceCents, 6500)
    assert.equal(favorite.checkIntervalMinutes, 30)

    const favorites = await client.get('/favorites').loginAs(user)
    favorites.assertStatus(200)
    favorites.assertTextIncludes('Obserwowane połączenia')
    favorites.assertTextIncludes('Wrocław Główny')
    favorites.assertTextIncludes('79,00')
  })

  test('detects a lower price and sends a fake notification', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto alertowe',
      email: 'alerts@example.test',
      password: 'Qa-Test-2026!',
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Olsztyn Główny',
      destination: 'Wrocław Główny',
      travelDate: DateTime.fromISO('2026-12-01'),
      departureTime: '08:00',
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
  })

  test('notifies at an inclusive target but ignores decreases above it', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Konto z progiem',
      email: 'threshold@example.test',
      password: 'Qa-Test-2026!',
    })
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: '2026-11-17',
      departureTime: '14:54',
      onlyDirect: false,
    })
    const currentPrice = connection.priceCents!
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: DateTime.fromISO('2026-11-17'),
      departureTime: '14:54',
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
    const scheduled = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: futureDeparture,
      departureTime: futureDeparture.toFormat('HH:mm'),
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
})
