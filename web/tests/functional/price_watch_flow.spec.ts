import PriceWatch from '#models/price_watch'
import User from '#models/user'
import PriceAlertService from '#services/price_alert_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Price watch flow', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

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
    })

    store.assertStatus(302)
    store.assertHeader('location', '/favorites')

    const favorite = await PriceWatch.query().where('userId', user.id).firstOrFail()
    assert.equal(favorite.origin, 'Wrocław Główny')
    assert.equal(favorite.targetPriceCents, 6500)

    const favorites = await client.get('/favorites').loginAs(user)
    favorites.assertStatus(200)
    favorites.assertTextIncludes('Obserwowane połączenia')
    favorites.assertTextIncludes('Wrocław Główny')
    favorites.assertTextIncludes('79,00')
  })

  test('detects a lower price without sending disabled notifications', async ({ assert }) => {
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
    assert.equal(summary.delivered, 0)
    assert.isBelow(watch.lastPriceCents!, 20_000)
    assert.isNotNull(watch.lastCheckedAt)
    assert.isNull(watch.lastNotifiedAt)
  })
})
