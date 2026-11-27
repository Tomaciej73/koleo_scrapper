import User from '#models/user'
import { EMAIL_VERIFICATION_SESSION_KEY } from '#services/email_verification_service'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import edge from 'edge.js'

test.group('Account verification', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
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
    sentMessages[0].assertSubject('Kod aktywacyjny - Koleo Watch')

    const content = String(sentMessages[0].nodeMailerMessage.text)
    const code = content.match(/\b\d{6}\b/)?.[0]
    assert.match(code ?? '', /^\d{6}$/)
    const html = String(sentMessages[0].nodeMailerMessage.html)
    assert.include(html, '<html lang="pl">')
    assert.include(html, '<title>Potwierdź adres e-mail - Koleo Watch</title>')
    assert.include(html, code!)
    assert.include(html, 'style=')

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

  test('resumes signup verification after the original session is lost', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      email: 'resume@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: null,
    })

    const missingSession = await client.get('/verify-email').redirects(0)
    missingSession.assertStatus(302)
    missingSession.assertHeader('location', '/login')

    const login = await client.post('/login').redirects(0).withCsrfToken().form({
      email: user.email,
      password: 'Qa-Test-2026!',
    })
    login.assertStatus(302)
    login.assertHeader('location', '/verify-email')
    login.assertSession(EMAIL_VERIFICATION_SESSION_KEY, user.id)
    assert.isNull(user.emailVerifiedAt)
  })

  test('limits name and email length and rejects control characters in names', async ({
    client,
    assert,
  }) => {
    const values = [
      { fullName: 'A'.repeat(121), email: 'long-name@example.test' },
      { fullName: 'Jan\nKowalski', email: 'control-name@example.test' },
      { fullName: 'Jan', email: `${'a'.repeat(245)}@example.test` },
    ]
    for (const value of values) {
      const response = await client
        .post('/signup')
        .redirects(0)
        .withCsrfToken()
        .form({
          ...value,
          password: 'Qa-Test-2026!',
          passwordConfirmation: 'Qa-Test-2026!',
        })
      response.assertStatus(302)
      assert.isNull(await User.findBy('email', value.email))
    }
    const valid = await client.post('/signup').redirects(0).withCsrfToken().form({
      fullName: "  Anna Kowalska-Nowak O'Connor  ",
      email: 'valid-name@example.test',
      password: 'Qa-Test-2026!',
      passwordConfirmation: 'Qa-Test-2026!',
    })
    valid.assertStatus(302)
    const user = await User.findByOrFail('email', 'valid-name@example.test')
    assert.equal(user.fullName, "Anna Kowalska-Nowak O'Connor")
  })

  test('escapes untrusted text passed to shared view components', async ({ assert }) => {
    const payload = '<img src=x onerror=alert(1)>'
    const rendered = await edge.renderRaw(
      "@!alert.title({ text: payload })\n@!alert.description({ text: payload })\n@!button({ text: payload })\n@!link({ href: '#', text: payload })",
      { payload }
    )
    assert.notInclude(rendered, payload)
    assert.include(rendered, '&lt;img src=x onerror=alert(1)&gt;')
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

    const response = await client
      .get('/stations/search?q=WROCLAW')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)

    response.assertStatus(200)
    const names = response.body().stations.map((station: { name: string }) => station.name)
    assert.include(names, 'Wrocław Główny')
    assert.include(names, 'Wrocław Mikołajów')
  })

  test('rate limits expensive station searches per IP and user', async ({ client }) => {
    const user = await User.create({
      fullName: 'Tester limitów',
      email: 'limits@example.test',
      password: 'Qa-Test-2026!',
    })

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await client
        .get('/stations/search?q=WROCLAW')
        .withSession({ authVersion: user.authVersion })
        .loginAs(user)
      response.assertStatus(200)
    }

    const blocked = await client
      .get('/stations/search?q=WROCLAW')
      .withSession({ authVersion: user.authVersion })
      .loginAs(user)
    blocked.assertStatus(429)
    blocked.assertHeader('retry-after')
  })

  test('rate limits failed logins by IP and normalized email', async ({ client }) => {
    await User.create({
      fullName: 'Konto logowania',
      email: 'login-limits@example.test',
      password: 'Qa-Test-2026!',
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client.post('/login').redirects(0).withCsrfToken().form({
        email: 'LOGIN-LIMITS@example.test',
        password: 'nieprawidłowe-hasło',
      })
    }

    const blocked = await client.post('/login').redirects(0).withCsrfToken().form({
      email: 'login-limits@example.test',
      password: 'nieprawidłowe-hasło',
    })
    blocked.assertStatus(429)
    blocked.assertHeader('retry-after')
  })
})
