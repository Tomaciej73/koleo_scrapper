import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Account management', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('lists the current session and exports account data without password', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Eksport danych',
      email: 'export@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: DateTime.utc().plus({ days: 2 }),
      departureTime: '14:54',
      notificationChannel: 'email',
      notificationDestination: user.email,
      status: 'active',
    })
    await PriceObservation.create({
      priceWatchId: watch.id,
      priceCents: 7900,
      observedAt: DateTime.utc(),
    })

    const account = await client
      .get('/account')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
    account.assertStatus(200)
    account.assertTextIncludes('Aktywne sesje')
    account.assertTextIncludes('Ta sesja')

    const exported = await client
      .get('/account/export')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
    exported.assertStatus(200)
    exported.assertHeader('content-type', 'application/json; charset=utf-8')
    assert.equal(exported.body().account.email, user.email)
    assert.lengthOf(exported.body().priceWatches, 1)
    assert.lengthOf(exported.body().priceObservations, 1)
    assert.notInclude(exported.text(), user.password)
    assert.notProperty(exported.body().account, 'password')
  })

  test('changes email, invalidates authentication and requires verification again', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      email: 'old-address@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const previousAuthVersion = user.authVersion
    const response = await client
      .post('/account/email')
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({ email: 'new-address@example.test', currentPassword: 'Qa-Test-2026!' })

    response.assertStatus(302)
    response.assertHeader('location', '/verify-email')
    await user.refresh()
    assert.equal(user.email, 'new-address@example.test')
    assert.isNull(user.emailVerifiedAt)
    assert.equal(user.authVersion, previousAuthVersion + 1)
  })

  test('deletes the account only after password and explicit confirmation', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      email: 'delete@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const rejected = await client
      .delete('/account')
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({ password: 'nieprawidlowe', confirmation: 'USUŃ' })
    rejected.assertStatus(302)
    assert.isNotNull(await User.find(user.id))

    const deleted = await client
      .delete('/account')
      .redirects(0)
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
      .withCsrfToken()
      .form({ password: 'Qa-Test-2026!', confirmation: 'USUŃ' })
    deleted.assertStatus(302)
    deleted.assertHeader('location', '/')
    assert.isNull(await User.find(user.id))
  })
})
