import type { CzkExchangeRate } from '#services/nbp_exchange_rate_service'

export function formatPrice(priceCents: number | null, provider: string = 'koleo') {
  if (priceCents === null || priceCents === undefined) return 'brak ceny'
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: provider === 'cd' ? 'CZK' : 'PLN',
  }).format(priceCents / 100)
}

export function formatPriceWithConversion(
  priceCents: number | null,
  provider: string,
  rate: CzkExchangeRate | null
) {
  const original = formatPrice(priceCents, provider)
  if (provider !== 'cd' || priceCents === null || !rate) return original
  const converted = new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
  }).format((priceCents / 100) * rate.mid)
  return `${original} (≈ ${converted})`
}
