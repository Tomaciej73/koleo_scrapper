import User from '#models/user'
import PasswordResetDeliveryService from '#services/password_reset_delivery_service'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Password reset and browser security', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('uses a single-use reset token and invalidates existing sessions', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      fullName: 'Reset hasła',
      email: 'password-reset@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const previousAuthVersion = user.authVersion

    const requestReset = await client
      .post('/forgot-password')
      .redirects(0)
      .withCsrfToken()
      .form({ email: user.email })
    requestReset.assertStatus(302)
    requestReset.assertHeader('location', '/forgot-password')
    assert.lengthOf(fakeMailer.messages.sent(), 0)

    const deliverySummaries = await Promise.all([
      new PasswordResetDeliveryService().processPending(),
      new PasswordResetDeliveryService().processPending(),
    ])
    assert.equal(
      deliverySummaries.reduce((total, summary) => total + summary.delivered, 0),
      1
    )

    const resetMessage = fakeMailer.messages.sent()[0]
    resetMessage.assertTo(user.email)
    resetMessage.assertSubject('Reset hasła - Koleo Watch')
    const resetBody = String(resetMessage.nodeMailerMessage.text)
    const token = resetBody.match(/\/reset-password#token=([a-f0-9]{64})/)?.[1]
    assert.match(token ?? '', /^[a-f0-9]{64}$/)
    assert.notInclude(resetBody, `/reset-password/${token}`)
    const resetHtml = String(resetMessage.nodeMailerMessage.html)
    assert.include(resetHtml, '<html lang="pl">')
    assert.include(resetHtml, `/reset-password#token=${token}`)
    assert.include(resetHtml, 'Ustaw nowe hasło')

    const resetPage = await client.get('/reset-password')
    resetPage.assertStatus(200)
    resetPage.assertTextIncludes('Ustaw nowe hasło')

    const newPassword = `${'Bardzo-Dlugie-Haslo-'.repeat(4)}2026!`
    const reset = await client.post('/reset-password').redirects(0).withCsrfToken().form({
      token,
      password: newPassword,
      passwordConfirmation: newPassword,
    })
    reset.assertStatus(302)
    reset.assertHeader('location', '/login')
    const confirmationHtml = String(fakeMailer.messages.sent()[1].nodeMailerMessage.html)
    assert.include(confirmationHtml, 'Hasło zostało zmienione')
    assert.notInclude(confirmationHtml, token!)

    await user.refresh()
    assert.equal(user.authVersion, previousAuthVersion + 1)
    await User.verifyCredentials(user.email, newPassword)

    const staleSession = await client
      .get('/dashboard')
      .redirects(0)
      .withSession({ authVersion: previousAuthVersion })
      .loginAs(user)
    staleSession.assertStatus(302)
    staleSession.assertHeader('location', '/login')

    const replay = await client.post('/reset-password').redirects(0).withCsrfToken().form({
      token,
      password: newPassword,
      passwordConfirmation: newPassword,
    })
    replay.assertStatus(302)
    replay.assertHeader('location', '/forgot-password')
  })

  test('does not disclose whether an email address exists', async ({ client, assert }) => {
    const fakeMailer = mail.fake()
    const response = await client
      .post('/forgot-password')
      .redirects(0)
      .withCsrfToken()
      .form({ email: 'missing-account@example.test' })

    response.assertStatus(302)
    response.assertHeader('location', '/forgot-password')
    response.assertFlashMessage(
      'success',
      'Jeżeli konto z tym adresem istnieje, wysłaliśmy instrukcję resetu hasła.'
    )
    assert.lengthOf(fakeMailer.messages.sent(), 0)
  })

  test('normalizes email addresses and returns Polish validation messages', async ({
    client,
    assert,
  }) => {
    const password = 'Qa-Test-2026!'
    const signup = await client.post('/signup').redirects(0).withCsrfToken().form({
      fullName: 'Normalizacja adresu',
      email: '  USER.Name@Example.TEST ',
      password,
      passwordConfirmation: password,
    })
    signup.assertStatus(302)

    const user = await User.findByOrFail('email', 'user.name@example.test')
    assert.equal(user.email, 'user.name@example.test')

    const duplicate = await client.post('/signup').redirects(0).withCsrfToken().form({
      fullName: 'Duplikat adresu',
      email: 'USER.NAME@EXAMPLE.TEST',
      password,
      passwordConfirmation: password,
    })
    duplicate.assertStatus(302)
    duplicate.assertFlashMessage('inputErrorsBag', {
      email: ['Ta wartość pola „adres e-mail” jest już używana.'],
    })

    const invalidLogin = await client.post('/login').redirects(0).withCsrfToken().form({
      email: user.email,
    })
    invalidLogin.assertStatus(302)
    invalidLogin.assertFlashMessage('inputErrorsBag', {
      password: ['Pole „hasło” jest wymagane.'],
    })

    const wrongCredentials = await client.post('/login').redirects(0).withCsrfToken().form({
      email: 'USER.NAME@EXAMPLE.TEST',
      password: 'Niepoprawne-haslo-2026!',
    })
    wrongCredentials.assertStatus(302)
    wrongCredentials.assertFlashMessage('error', 'Nieprawidłowy adres e-mail lub hasło.')
  })

  test('sends CSP in report-only mode and accepts bounded browser reports', async ({ client }) => {
    const page = await client.get('/')
    page.assertStatus(200)
    page.assertHeader('content-security-policy-report-only')
    page.assertHeaderMissing('content-security-policy')

    const report = await client
      .post('/security/csp-report')
      .header('content-type', 'application/csp-report')
      .json({
        'csp-report': {
          'document-uri': 'https://example.test/dashboard?private=value',
          'effective-directive': 'script-src',
          'blocked-uri': 'inline',
          'disposition': 'report',
        },
      })
    report.assertStatus(204)
  })

  test('accepts long passwords and rejects values over the configured maximum', async ({
    client,
    assert,
  }) => {
    const acceptedPassword = `${'A'.repeat(62)}1!`
    const accepted = await client.post('/signup').redirects(0).withCsrfToken().form({
      fullName: 'Długie hasło',
      email: 'long-password@example.test',
      password: acceptedPassword,
      passwordConfirmation: acceptedPassword,
    })
    accepted.assertStatus(302)
    accepted.assertHeader('location', '/verify-email')

    const rejectedPassword = 'B'.repeat(129)
    const rejected = await client.post('/signup').redirects(0).withCsrfToken().form({
      fullName: 'Za długie hasło',
      email: 'too-long-password@example.test',
      password: rejectedPassword,
      passwordConfirmation: rejectedPassword,
    })
    rejected.assertStatus(302)
    assert.isNull(await User.findBy('email', 'too-long-password@example.test'))
  })
})
