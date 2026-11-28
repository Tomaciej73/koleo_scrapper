import User from '#models/user'
import TotpService, { totpAt } from '#services/totp_service'
import env from '#start/env'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('New-device login security', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.setup(() => {
    mail.fake()
    env.set('NEW_DEVICE_CHALLENGE_ENABLED', 'true')
    return () => {
      env.set('NEW_DEVICE_CHALLENGE_ENABLED', 'false')
      mail.restore()
    }
  })

  test('requires an email code before creating a session and lets the alert revoke it', async ({
    visit,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      email: 'new-device@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const page = await visit('/login')
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/login/confirm'),
      page.locator('button[type="submit"]').first().click(),
    ])
    assert.include(page.url(), '/login/confirm')
    const messages = fakeMailer.messages.sent()
    assert.lengthOf(messages, 1)
    const code = String(messages[0].nodeMailerMessage.text).match(/\b\d{6}\b/)?.[0]
    assert.match(code ?? '', /^\d{6}$/)
    await page.locator('input[name="code"]').fill('99999999')
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    assert.include(page.url(), '/login/confirm')
    await page.locator('input[name="code"]').fill(code!)
    await Promise.all([
      page.waitForURL('**/dashboard'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    assert.lengthOf(fakeMailer.messages.sent(), 2)
    const alertText = String(fakeMailer.messages.sent()[1].nodeMailerMessage.text)
    const revokeUrl = new URL(alertText.match(/https?:\/\/\S+/)?.[0] ?? '')
    await page.goto(`${revokeUrl.pathname}${revokeUrl.search}`)
    assert.include(await page.locator('body').innerText(), 'To nie Twoje logowanie?')
    await Promise.all([
      page.waitForURL('**/login'),
      page.getByRole('button', { name: 'Unieważnij tę sesję' }).click(),
    ])
    await page.goto('/dashboard')
    assert.include(page.url(), '/login')
  })

  test('does not email a code again for the same trusted browser', async ({ visit, assert }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      email: 'trusted-browser@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const page = await visit('/login')
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/login/confirm'),
      page.locator('button[type="submit"]').first().click(),
    ])
    const code = String(fakeMailer.messages.sent()[0].nodeMailerMessage.text).match(
      /\b\d{6}\b/
    )?.[0]
    await page.locator('input[name="code"]').fill(code!)
    await Promise.all([
      page.waitForURL('**/dashboard'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    assert.lengthOf(fakeMailer.messages.sent(), 2)
    await Promise.all([
      page.waitForURL('**/login'),
      page.getByRole('button', { name: 'Wyloguj', exact: true }).click(),
    ])
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/dashboard'),
      page.locator('button[type="submit"]').first().click(),
    ])
    assert.lengthOf(fakeMailer.messages.sent(), 2)
  })

  test('revokes the reported session from a different browser', async ({ visit, assert }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      email: 'remote-revoke@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const page = await visit('/login')
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/login/confirm'),
      page.locator('button[type="submit"]').first().click(),
    ])
    const code = String(fakeMailer.messages.sent()[0].nodeMailerMessage.text).match(
      /\b\d{6}\b/
    )?.[0]
    await page.locator('input[name="code"]').fill(code!)
    await Promise.all([
      page.waitForURL('**/dashboard'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    const text = String(fakeMailer.messages.sent()[1].nodeMailerMessage.text)
    const revokeUrl = new URL(text.match(/https?:\/\/\S+/)?.[0] ?? '')
    const browser = page.context().browser()!
    const otherContext = await browser.newContext()
    try {
      const otherPage = await otherContext.newPage()
      await otherPage.goto(
        new URL(`${revokeUrl.pathname}${revokeUrl.search}`, page.url()).toString()
      )
      await Promise.all([
        otherPage.waitForURL('**/login'),
        otherPage.getByRole('button', { name: 'Unieważnij tę sesję' }).click(),
      ])
      await page.goto('/dashboard')
      assert.include(page.url(), '/login')
    } finally {
      await otherContext.close()
    }
  })

  test('rejects a pending code after all sessions are invalidated', async ({ visit, assert }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      email: 'stale-challenge@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const page = await visit('/login')
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/login/confirm'),
      page.locator('button[type="submit"]').first().click(),
    ])
    const code = String(fakeMailer.messages.sent()[0].nodeMailerMessage.text).match(
      /\b\d{6}\b/
    )?.[0]
    user.authVersion += 1
    await user.save()
    await page.locator('input[name="code"]').fill(code!)
    await Promise.all([
      page.waitForURL('**/login'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    assert.lengthOf(fakeMailer.messages.sent(), 1)
  })

  test('requires TOTP and consumes a recovery code exactly once', async ({ visit, assert }) => {
    const fakeMailer = mail.fake()
    const user = await User.create({
      email: 'totp@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const totp = new TotpService()
    const secret = totp.generateSecret()
    const counter = Math.floor(Date.now() / (env.get('LOGIN_TOTP_PERIOD_SECONDS') * 1000))
    const codes = await totp.enable(
      user,
      secret,
      totpAt(secret, counter, env.get('LOGIN_TOTP_DIGITS'))
    )
    assert.isArray(codes)
    const page = await visit('/login')
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/login/confirm'),
      page.locator('button[type="submit"]').first().click(),
    ])
    assert.lengthOf(fakeMailer.messages.sent(), 0)
    await page.locator('input[name="code"]').fill(codes![0])
    await Promise.all([
      page.waitForURL('**/dashboard'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    assert.isFalse(await totp.consumeRecovery(user, codes![0]))
  })

  test('accepts a fresh TOTP code once and rejects replay', async ({ visit, assert }) => {
    const user = await User.create({
      email: 'totp-replay@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const totp = new TotpService()
    const secret = totp.generateSecret()
    const counter = Math.floor(Date.now() / (env.get('LOGIN_TOTP_PERIOD_SECONDS') * 1000))
    await totp.enable(user, secret, totpAt(secret, counter - 1, env.get('LOGIN_TOTP_DIGITS')))
    const code = totpAt(secret, counter, env.get('LOGIN_TOTP_DIGITS'))
    const page = await visit('/login')
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/login/confirm'),
      page.locator('button[type="submit"]').first().click(),
    ])
    await page.locator('input[name="code"]').fill(code)
    await Promise.all([
      page.waitForURL('**/dashboard'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    await Promise.all([
      page.waitForURL('**/login'),
      page.getByRole('button', { name: 'Wyloguj', exact: true }).click(),
    ])
    await page.locator('input[name="email"]').fill(user.email)
    await page.locator('input[name="password"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForURL('**/login/confirm'),
      page.locator('button[type="submit"]').first().click(),
    ])
    await page.locator('input[name="code"]').fill(code)
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Potwierdź i zaloguj się' }).click(),
    ])
    assert.include(page.url(), '/login/confirm')
  })

  test('enables and disables TOTP in account settings with password and recovery code', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const user = await User.create({
      email: 'totp-settings@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })
    const page = await visit('/account')
    await page.locator('#account-totp input[name="currentPassword"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Skonfiguruj aplikację TOTP' }).click(),
    ])
    const secret = await page.locator('#totp-setup-secret').innerText()
    assert.match(secret, /^[A-Z2-7]{32}$/)
    const counter = Math.floor(Date.now() / (env.get('LOGIN_TOTP_PERIOD_SECONDS') * 1000))
    await page
      .locator('#account-totp input[name="code"]')
      .fill(totpAt(secret, counter, env.get('LOGIN_TOTP_DIGITS')))
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Włącz TOTP' }).click(),
    ])
    await user.refresh()
    assert.isString(user.totpSecret)
    assert.notInclude(user.totpSecret!, secret)
    const recoveryText = await page.locator('#totp-recovery-codes').innerText()
    const firstRecovery = recoveryText.split(/\s+/)[0]
    assert.match(firstRecovery, /^[a-f0-9]{24}$/)
    await page.reload()
    assert.equal(await page.locator('#totp-recovery-codes').count(), 0)
    await page.getByText('Wyłącz uwierzytelnianie dwuskładnikowe').click()
    await page.locator('#account-totp input[name="currentPassword"]').fill('Qa-Test-2026!')
    await page.locator('#account-totp input[name="code"]').fill(firstRecovery)
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Wyłącz TOTP' }).click(),
    ])
    await user.refresh()
    assert.isNull(user.totpSecret)
  })
})
