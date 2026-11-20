import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

test.group('Station autocomplete', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('keeps suggestions closed after selecting a station', async ({
    assert,
    browserContext,
    visit,
  }) => {
    const user = await User.create({
      fullName: 'Konto autouzupełniania',
      email: 'autocomplete@example.test',
      password: 'Qa-Test-2026!',
    })
    await browserContext.loginAs(user)
    await browserContext.setSession({ authVersion: user.authVersion })

    const page = await visit('/dashboard')
    const input = page.locator('#destination-station')
    const list = page.locator('#destination-stations-list')

    await input.fill('Olsz')
    await page.waitForResponse((response) => response.url().includes('/stations/search?'))
    await list.getByRole('option').first().click()

    await page.waitForTimeout(400)
    assert.isFalse(await list.isVisible())
    assert.equal(await input.inputValue(), 'Olsztyn Główny')
    assert.equal(await page.locator('input[name="destinationStationId"]').inputValue(), '4')
  })
})
