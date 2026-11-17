import User from '#models/user'
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

    const resetMessage = fakeMailer.messages.sent()[0]
    resetMessage.assertTo(user.email)
    resetMessage.assertSubject('Reset hasła — Koleo Watch')
    const resetBody = String(resetMessage.nodeMailerMessage.text)
    const token = resetBody.match(/\/reset-password\/([a-f0-9]{64})/)?.[1]
    assert.match(token ?? '', /^[a-f0-9]{64}$/)

    const resetPage = await client.get(`/reset-password/${token}`)
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
