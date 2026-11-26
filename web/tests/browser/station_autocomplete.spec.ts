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

  if (process.env.CD_BROWSER_TEST === '1') {
    test('clears station IDs when switching to ČD and requests ČD suggestions', async ({
      assert,
      browserContext,
      visit,
    }) => {
      const user = await User.create({
        fullName: 'Konto źródła ČD',
        email: 'cd-browser@example.test',
        password: 'Qa-Test-2026!',
      })
      await browserContext.loginAs(user)
      await browserContext.setSession({ authVersion: user.authVersion })
      const page = await visit('/dashboard')
      const input = page.locator('#origin-station')
      await input.fill('Wroc')
      await page.waitForResponse((response) => response.url().includes('/stations/search?'))
      await page.locator('#origin-stations-list').getByRole('option').first().click()
      assert.isNotEmpty(await page.locator('input[name="originStationId"]').inputValue())
      await page.locator('select[name="provider"]').selectOption('cd')
      assert.equal(await input.inputValue(), '')
      assert.equal(await page.locator('input[name="originStationId"]').inputValue(), '')
      await page.route('**/stations/search?**', async (route) => {
        assert.include(route.request().url(), 'provider=cd')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            stations: [{ id: 5_100_069, name: 'Wroclaw Glowny; Poland', slug: null }],
          }),
        })
      })
      await input.fill('Wrocław Główny')
      await page.locator('#origin-stations-list').getByRole('option').first().click()
      assert.equal(await input.inputValue(), 'Wroclaw Glowny; Poland')
      assert.equal(await page.locator('input[name="originStationId"]').inputValue(), '5100069')
    })
  }
})
