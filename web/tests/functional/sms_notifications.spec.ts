import AlertOutbox from '#models/alert_outbox'
import PriceWatch from '#models/price_watch'
import User from '#models/user'
import AlertOutboxService from '#services/alert_outbox_service'
import SmsGatewayService from '#services/sms_gateway_service'
import { SmsApiError } from '#services/smsapi_service'
import PhoneVerificationService from '#services/phone_verification_service'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('SMS notifications', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('requires a password and an SMS code before saving the phone number', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      email: 'sms-verification@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const calls: Array<{ url: string; body: any }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response('{}', { status: 201 })
    }

    try {
      const incorrectPassword = await client
        .post('/account/phone')
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ phoneNumber: '+48 500 600 700', currentPassword: 'incorrect' })
      incorrectPassword.assertStatus(302)
      assert.lengthOf(calls, 0)

      const requested = await client
        .post('/account/phone')
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ phoneNumber: '+48 500 600 700', currentPassword: 'Qa-Test-2026!' })
      requested.assertStatus(302)
      assert.lengthOf(calls, 1)
      assert.equal(calls[0].body.phoneNumbers[0], '+48500600700')
      assert.include(calls[0].url, '/3rdparty/v1/messages')
      const code = /kod potwierdzenia numeru (\d+)/.exec(calls[0].body.textMessage.text)?.[1]
      assert.isDefined(code)
      await user.refresh()
      assert.isNull(user.phoneNumber)

      const pendingAccount = await client
        .get('/account')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
      pendingAccount.assertStatus(200)
      for (const fieldId of ['smsPhoneNumber', 'smsCurrentPassword', 'smsVerificationCode']) {
        assert.include(pendingAccount.text(), `id="${fieldId}"`)
        assert.include(pendingAccount.text(), `for="${fieldId}"`)
      }
      assert.include(pendingAccount.text(), 'class="field__input"')

      const invalid = await client
        .post('/account/phone/verify')
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ code: '999999' === code ? '888888' : '999999' })
      invalid.assertStatus(302)
      await user.refresh()
      assert.isNull(user.phoneNumber)

      const verified = await client
        .post('/account/phone/verify')
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ code })
      verified.assertStatus(302)
      await user.refresh()
      assert.equal(user.phoneNumber, '+48500600700')
      assert.isNotNull(user.phoneVerifiedAt)

      const account = await client
        .get('/account')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
      account.assertStatus(200)
      account.assertTextIncludes('kończy się na 700')
      assert.notInclude(account.text(), '+48500600700')
      assert.include(account.text(), 'id="removePhonePassword"')
      assert.include(account.text(), 'for="removePhonePassword"')

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
      const settings = await client
        .post(`/favorites/${watch.id}/settings`)
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ notificationChannel: 'both', targetPrice: '65', checkIntervalMinutes: '30' })
      settings.assertStatus(302)
      await watch.refresh()
      assert.equal(watch.notificationChannel, 'both')

      const removed = await client
        .post('/account/phone/remove')
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ currentPassword: 'Qa-Test-2026!' })
      removed.assertStatus(302)
      await user.refresh()
      await watch.refresh()
      assert.isNull(user.phoneNumber)
      assert.equal(watch.notificationChannel, 'email')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('clears a rejected SMS verification so the user can retry after fixing the sender', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      email: 'sms-rejected@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const originalSend = SmsGatewayService.prototype.send
    SmsGatewayService.prototype.send = async () => {
      throw new SmsApiError('SMSAPI odrzuciło wiadomość (kod 14).', 14)
    }

    try {
      const rejected = await client
        .post('/account/phone')
        .redirects(0)
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
        .withCsrfToken()
        .form({ phoneNumber: '+48 500 600 700', currentPassword: 'Qa-Test-2026!' })
      rejected.assertStatus(302)
      const pending = await new PhoneVerificationService().pending(user.id)
      assert.isNull(pending)
    } finally {
      SmsGatewayService.prototype.send = originalSend
    }
  })

  test('queues e-mail and SMS once for the same price change', async ({ assert }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      email: 'both-channels@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
      phoneNumber: '+48500600700',
      phoneVerifiedAt: DateTime.utc(),
    })
    const watch = await PriceWatch.create({
      userId: user.id,
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: DateTime.utc().plus({ days: 2 }),
      departureTime: '14:54',
      notificationChannel: 'both',
      notificationDestination: user.email,
      status: 'active',
    })
    const outbox = new AlertOutboxService()
    assert.equal(await outbox.enqueuePriceAlert(watch, 7900, 6900, 'sms-both-test'), 'queued')
    assert.equal(await outbox.enqueuePriceAlert(watch, 7900, 6900, 'sms-both-test'), 'duplicate')
    const queued = await AlertOutbox.query().where('priceWatchId', watch.id).orderBy('id', 'asc')
    assert.deepEqual(
      queued.map((alert) => alert.channel),
      ['email', 'sms']
    )

    const calls: Array<{ body: any }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_input, init) => {
      calls.push({ body: JSON.parse(String(init?.body)) })
      return new Response('{}', { status: 201 })
    }
    try {
      const result = await outbox.processPending(user.id)
      assert.deepEqual(result, { delivered: 2, errors: 0 })
      assert.lengthOf(fakeMailer.messages.sent(), 1)
      assert.lengthOf(calls, 1)
      assert.equal(calls[0].body.phoneNumbers[0], user.phoneNumber)
      assert.equal(calls[0].body.id, queued[1].deliveryId)
      assert.include(calls[0].body.textMessage.text, 'Cena')
      const sentAlerts = await AlertOutbox.query().where('priceWatchId', watch.id)
      assert.deepEqual(
        sentAlerts.map((alert) => alert.status),
        ['sent', 'sent']
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('does not allow SMS alerts for an unverified phone number', async ({ client, assert }) => {
    const user = await User.create({
      email: 'unverified-sms@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const travelDate = DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate()!
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
        departureTime: '14:54',
        arrivalTime: '20:01',
        arrivalDate: travelDate,
        connectionUuid: 'demo-sms-unverified',
        trainName: 'POŁĄCZENIE DEMO 100',
        priceCents: '7900',
        targetPrice: '65.00',
        notificationChannel: 'sms',
        notificationDestination: 'attacker@example.test',
        checkIntervalMinutes: '30',
      })
    response.assertStatus(302)
    assert.lengthOf(await PriceWatch.query().where('userId', user.id), 0)
  })

  test('confirms a retry by the stable SMS ID after a conflict response', async ({ assert }) => {
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      return new Response(JSON.stringify({ state: 'Pending' }), {
        status: calls.length === 1 ? 409 : 200,
      })
    }
    try {
      await new SmsGatewayService().send('+48500600700', 'Test alertu', 'sms-retry-id')
      assert.lengthOf(calls, 2)
      assert.include(calls[1], '/3rdparty/v1/messages/sms-retry-id')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
