import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import { EMAIL_VERIFICATION_SESSION_KEY } from '#services/email_verification_service'
import PasswordResetService from '#services/password_reset_service'
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

  test('keeps the old email active until the new address is confirmed', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      email: 'old-address@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const previousAuthVersion = user.authVersion
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
    await new PasswordResetService().request(user.email)
    assert.lengthOf(await PasswordResetToken.query().where('userId', user.id), 1)
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
    assert.equal(user.email, 'old-address@example.test')
    assert.equal(user.pendingEmail, 'new-address@example.test')
    assert.isNotNull(user.emailVerifiedAt)
    assert.equal(user.authVersion, previousAuthVersion)
    const currentResetToken = await PasswordResetToken.query()
      .where('userId', user.id)
      .firstOrFail()
    await new PasswordResetService().request('new-address@example.test')
    const unchangedResetToken = await PasswordResetToken.query()
      .where('userId', user.id)
      .firstOrFail()
    assert.equal(unchangedResetToken.id, currentResetToken.id)

    const sentMessages = fakeMailer.messages.sent()
    assert.lengthOf(sentMessages, 2)
    sentMessages[0].assertTo('new-address@example.test')
    sentMessages[1].assertTo('old-address@example.test')
    const code = String(sentMessages[0].nodeMailerMessage.text).match(/\b\d{6}\b/)?.[0]
    assert.match(code ?? '', /^\d{6}$/)

    const reservedAddress = await client.post('/signup').redirects(0).withCsrfToken().form({
      email: 'new-address@example.test',
      password: 'Qa-Test-2026!',
      passwordConfirmation: 'Qa-Test-2026!',
    })
    reservedAddress.assertStatus(302)
    assert.isNull(await User.findBy('email', 'new-address@example.test'))

    const unauthenticatedCode = await client
      .post('/verify-email')
      .redirects(0)
      .withSession({ [EMAIL_VERIFICATION_SESSION_KEY]: user.id })
      .withCsrfToken()
      .form({ code })
    unauthenticatedCode.assertStatus(302)
    unauthenticatedCode.assertHeader('location', '/login')
    await user.refresh()
    assert.equal(user.pendingEmail, 'new-address@example.test')

    const resume = await client.post('/login').redirects(0).withCsrfToken().form({
      email: 'old-address@example.test',
      password: 'Qa-Test-2026!',
    })
    resume.assertStatus(302)
    resume.assertHeader('location', '/verify-email')
    resume.assertSession(EMAIL_VERIFICATION_SESSION_KEY, user.id)

    const verificationPage = await client
      .get('/verify-email')
      .withSession({ authVersion: user.authVersion, [EMAIL_VERIFICATION_SESSION_KEY]: user.id })
      .loginAs(user)
    verificationPage.assertStatus(200)
    verificationPage.assertTextIncludes('potwierdzić nowy adres')

    const verification = await client
      .post('/verify-email')
      .redirects(0)
      .withSession({ authVersion: user.authVersion, [EMAIL_VERIFICATION_SESSION_KEY]: user.id })
      .loginAs(user)
      .withCsrfToken()
      .form({ code })
    verification.assertStatus(302)
    verification.assertHeader('location', '/dashboard')

    await user.refresh()
    await watch.refresh()
    assert.equal(user.email, 'new-address@example.test')
    assert.isNull(user.pendingEmail)
    assert.equal(user.authVersion, previousAuthVersion + 1)
    assert.equal(watch.notificationDestination, user.email)
    assert.lengthOf(await PasswordResetToken.query().where('userId', user.id), 0)

    await new PasswordResetService().request('old-address@example.test')
    assert.lengthOf(await PasswordResetToken.query().where('userId', user.id), 0)
    await new PasswordResetService().request('new-address@example.test')
    assert.lengthOf(await PasswordResetToken.query().where('userId', user.id), 1)
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
