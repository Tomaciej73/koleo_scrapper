import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Phone settings', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('shows the phone entry only after choosing to change a verified number', async ({
    assert,
    browserContext,
    visit,
  }) => {
    const user = await User.create({
      email: 'phone-settings@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
      phoneNumber: '+48500600700',
      phoneVerifiedAt: DateTime.utc(),
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })

    const page = await visit('/account')
    const phoneInput = page.locator('#smsPhoneNumber')
    const removePassword = page.locator('#removePhonePassword')
    assert.isFalse(await phoneInput.isVisible())
    assert.isFalse(await removePassword.isVisible())

    await page.locator('#change-phone > summary').click()
    assert.isTrue(await phoneInput.isVisible())
    assert.isFalse(await removePassword.isVisible())

    await page.locator('#remove-phone > summary').click()
    assert.isTrue(await removePassword.isVisible())
  })

  test('shows the phone entry immediately when no number is verified', async ({
    assert,
    browserContext,
    visit,
  }) => {
    const user = await User.create({
      email: 'phone-new@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })

    const page = await visit('/account')
    assert.isTrue(await page.locator('#smsPhoneNumber').isVisible())
    assert.equal(await page.locator('#change-phone').count(), 0)
    assert.equal(await page.locator('#remove-phone').count(), 0)
  })
})
