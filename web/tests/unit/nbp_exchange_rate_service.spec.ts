import NbpExchangeRateService from '#services/nbp_exchange_rate_service'
import { formatPriceWithConversion } from '#services/price_format_service'
import { test } from '@japa/runner'

test.group('NBP CZK conversion', () => {
  test('shows an indicative PLN value without changing the original currency', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    let requests = 0
    globalThis.fetch = async () => {
      requests += 1
      return Response.json({
        table: 'A',
        code: 'CZK',
        rates: [{ no: '1/A/NBP/2026', effectiveDate: '2026-11-26', mid: 0.1833 }],
      })
    }
    try {
      const service = new NbpExchangeRateService({
        url: 'https://nbp.example.test/czk',
        timeoutMs: 1_000,
        cacheSeconds: 300,
        failureRetrySeconds: 30,
        maxStaleSeconds: 600,
      })
      const rate = await service.getCzkRate()
      assert.equal(rate?.effectiveDate, '2026-11-26')
      assert.equal(rate?.mid, 0.1833)
      assert.include(formatPriceWithConversion(62_000, 'cd', rate), '620,00')
      assert.include(formatPriceWithConversion(62_000, 'cd', rate), '113,65')
      assert.notInclude(formatPriceWithConversion(62_000, 'cd', null), 'PLN')
      assert.notInclude(formatPriceWithConversion(62_000, 'koleo', rate), 'CZK')
      await service.getCzkRate()
      assert.equal(requests, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
