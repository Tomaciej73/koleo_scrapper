import User from '#models/user'
import { EMAIL_VERIFICATION_SESSION_KEY } from '#services/email_verification_service'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'

test.group('Account verification', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('sends a code and activates the account after valid confirmation', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    const signup = await client.post('/signup').redirects(0).withCsrfToken().form({
      fullName: 'Konto do aktywacji',
      email: 'verify@example.test',
      password: 'Qa-Test-2026!',
      passwordConfirmation: 'Qa-Test-2026!',
    })

    signup.assertStatus(302)
    signup.assertHeader('location', '/verify-email')

    const user = await User.findByOrFail('email', 'verify@example.test')
    assert.isNull(user.emailVerifiedAt)
    signup.assertSession(EMAIL_VERIFICATION_SESSION_KEY, user.id)

    const sentMessages = fakeMailer.messages.sent()
    assert.lengthOf(sentMessages, 1)
    sentMessages[0].assertTo(user.email)
    sentMessages[0].assertSubject('Kod aktywacyjny — Koleo Watch')

    const content = String(sentMessages[0].nodeMailerMessage.text)
    const code = content.match(/\b\d{6}\b/)?.[0]
    assert.match(code ?? '', /^\d{6}$/)

    const verificationPage = await client
      .get('/verify-email')
      .withSession({ [EMAIL_VERIFICATION_SESSION_KEY]: user.id })
    verificationPage.assertStatus(200)
    assert.include(verificationPage.text(), 'data-code-index="0"')
    assert.include(verificationPage.text(), 'data-code-index="5"')
    assert.include(verificationPage.text(), 'data-seconds=')

    const verification = await client
      .post('/verify-email')
      .redirects(0)
      .withSession({ [EMAIL_VERIFICATION_SESSION_KEY]: user.id })
      .withCsrfToken()
      .form({ code })

    verification.assertStatus(302)
    verification.assertHeader('location', '/dashboard')

    await user.refresh()
    assert.isNotNull(user.emailVerifiedAt)
    assert.isNull(user.emailVerificationCodeHash)
  })

  test('returns autocomplete results through the authenticated HTTP endpoint', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      fullName: 'Autocomplete tester',
      email: 'stations@example.test',
      password: 'Qa-Test-2026!',
    })

    const response = await client.get('/stations/search?q=WROCLAW').loginAs(user)

    response.assertStatus(200)
    const names = response.body().stations.map((station: { name: string }) => station.name)
    assert.include(names, 'Wrocław Główny')
    assert.include(names, 'Wrocław Mikołajów')
  })
})
