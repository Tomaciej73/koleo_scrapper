import { test } from '@japa/runner'

test.group('Page metadata', () => {
  test('public pages have distinct titles and the application favicon', async ({
    client,
    assert,
  }) => {
    const pages = [
      ['/', 'Monitoring cen biletów kolejowych'],
      ['/login', 'Logowanie'],
      ['/signup', 'Rejestracja konta'],
      ['/forgot-password', 'Odzyskiwanie hasła'],
    ] as const

    for (const [path, title] of pages) {
      const response = await client.get(path)
      response.assertStatus(200)
      assert.include(response.text(), `<title>${title} - Koleo Watch</title>`)
      assert.include(
        response.text(),
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />'
      )
    }

    const favicon = await client.get('/favicon.svg')
    favicon.assertStatus(200)
    assert.match(favicon.header('content-type') ?? '', /^image\/svg\+xml/)
  })
})
