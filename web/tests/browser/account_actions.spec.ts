import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Account actions', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('shows email and account deletion forms only after expanding their actions', async ({
    assert,
    browserContext,
    visit,
  }) => {
    const user = await User.create({
      email: 'account-actions@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })

    const page = await visit('/account')
    const emailInput = page.locator('#change-email input[name="email"]')
    const deletePassword = page.locator('#delete-account input[name="password"]')
    assert.isFalse(await emailInput.isVisible())
    assert.isFalse(await deletePassword.isVisible())

    await page.locator('#change-email > summary').click()
    assert.isTrue(await emailInput.isVisible())
    assert.isFalse(await deletePassword.isVisible())

    await page.locator('#delete-account > summary').click()
    assert.isTrue(await deletePassword.isVisible())
    assert.isTrue(await emailInput.isVisible())
  })

  test('keeps the email action open after an incorrect password', async ({
    assert,
    browserContext,
    visit,
  }) => {
    const user = await User.create({
      email: 'email-action-error@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })

    const page = await visit('/account')
    await page.locator('#change-email > summary').click()
    await page.locator('#change-email input[name="email"]').fill('updated@example.test')
    await page.locator('#change-email input[name="currentPassword"]').fill('wrong-password')
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#change-email button[type="submit"]').click(),
    ])

    assert.isTrue((await page.locator('#change-email').getAttribute('open')) !== null)
    assert.isTrue(await page.locator('#change-email input[name="email"]').isVisible())
    assert.isFalse(await page.locator('#delete-account input[name="password"]').isVisible())
  })

  test('keeps the email action open after invalid form data', async ({
    assert,
    browserContext,
    visit,
  }) => {
    const user = await User.create({
      email: 'email-action-validation@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })

    const page = await visit('/account')
    await page.locator('#change-email > summary').click()
    await page.locator('#change-email input[name="email"]').fill('')
    await page.locator('#change-email input[name="currentPassword"]').fill('Qa-Test-2026!')
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#change-email button[type="submit"]').click(),
    ])

    assert.isTrue((await page.locator('#change-email').getAttribute('open')) !== null)
    assert.isTrue(await page.locator('#change-email input[name="email"]').isVisible())
  })

  test('keeps the delete action open without deleting the account after an incorrect password', async ({
    assert,
    browserContext,
    visit,
  }) => {
    const user = await User.create({
      email: 'delete-action-error@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })

    const page = await visit('/account')
    await page.locator('#delete-account > summary').click()
    await page.locator('#delete-account input[name="password"]').fill('wrong-password')
    await page.locator('#delete-account input[name="confirmation"]').fill('USUŃ')
    page.once('dialog', (dialog) => dialog.accept())
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#delete-account button[type="submit"]').click(),
    ])

    assert.isTrue((await page.locator('#delete-account').getAttribute('open')) !== null)
    assert.isTrue(await page.locator('#delete-account input[name="password"]').isVisible())
    assert.isNotNull(await User.find(user.id))
  })
})
