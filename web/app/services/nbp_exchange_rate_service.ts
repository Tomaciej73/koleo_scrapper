import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

export interface CzkExchangeRate {
  mid: number
  effectiveDate: string
  tableNumber: string
}

interface RateOptions {
  url?: string
  timeoutMs?: number
  cacheSeconds?: number
  failureRetrySeconds?: number
  maxStaleSeconds?: number
}

interface RateConfig {
  url: string
  timeoutMs: number
  cacheSeconds: number
  failureRetrySeconds: number
  maxStaleSeconds: number
}

function isPositiveInteger(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export default class NbpExchangeRateService {
  private static cachedUrl: string | null = null
  private static cached: CzkExchangeRate | null = null
  private static fetchedAt = 0
  private static retryAt = 0
  private static pending: Promise<CzkExchangeRate | null> | null = null
  private static invalidConfigLogged = false

  constructor(private readonly options: RateOptions = {}) {}

  async getCzkRate(): Promise<CzkExchangeRate | null> {
    const url = this.options.url ?? env.get('NBP_CZK_RATE_URL')
    if (!url) return null
    if (NbpExchangeRateService.cachedUrl !== url) {
      NbpExchangeRateService.cachedUrl = url
      NbpExchangeRateService.cached = null
      NbpExchangeRateService.fetchedAt = 0
      NbpExchangeRateService.retryAt = 0
      NbpExchangeRateService.pending = null
    }
    const timeoutMs = this.options.timeoutMs ?? env.get('NBP_REQUEST_TIMEOUT_MS')
    const cacheSeconds = this.options.cacheSeconds ?? env.get('NBP_RATE_CACHE_SECONDS')
    const failureRetrySeconds =
      this.options.failureRetrySeconds ?? env.get('NBP_RATE_FAILURE_RETRY_SECONDS')
    const maxStaleSeconds = this.options.maxStaleSeconds ?? env.get('NBP_RATE_MAX_STALE_SECONDS')
    if (
      !isPositiveInteger(timeoutMs) ||
      !isPositiveInteger(cacheSeconds) ||
      !isPositiveInteger(failureRetrySeconds) ||
      !isPositiveInteger(maxStaleSeconds)
    ) {
      if (!NbpExchangeRateService.invalidConfigLogged) {
        NbpExchangeRateService.invalidConfigLogged = true
        logger.warn(
          { event: 'nbp_configuration_invalid' },
          'Konfiguracja kursu NBP jest niekompletna'
        )
      }
      return null
    }
    const config: RateConfig = {
      url,
      timeoutMs,
      cacheSeconds,
      failureRetrySeconds,
      maxStaleSeconds,
    }

    const now = Date.now()
    const cacheMs = config.cacheSeconds * 1_000
    if (NbpExchangeRateService.cached && now < NbpExchangeRateService.fetchedAt + cacheMs) {
      return NbpExchangeRateService.cached
    }
    if (now < NbpExchangeRateService.retryAt) return this.staleRate(now, config)

    if (!NbpExchangeRateService.pending) {
      NbpExchangeRateService.pending = this.fetchRate(config).finally(() => {
        NbpExchangeRateService.pending = null
      })
    }
    return NbpExchangeRateService.pending
  }

  private async fetchRate(config: RateConfig): Promise<CzkExchangeRate | null> {
    try {
      const response = await fetch(config.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(config.timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as {
        table?: unknown
        code?: unknown
        rates?: Array<{ no?: unknown; effectiveDate?: unknown; mid?: unknown }>
      }
      const rate = data.rates?.[0]
      if (
        data.table !== 'A' ||
        data.code !== 'CZK' ||
        typeof rate?.mid !== 'number' ||
        !Number.isFinite(rate.mid) ||
        rate.mid <= 0 ||
        typeof rate.effectiveDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveDate) ||
        typeof rate.no !== 'string'
      ) {
        throw new Error('Nieprawidłowa odpowiedź kursowa')
      }
      NbpExchangeRateService.cached = {
        mid: rate.mid,
        effectiveDate: rate.effectiveDate,
        tableNumber: rate.no,
      }
      NbpExchangeRateService.fetchedAt = Date.now()
      NbpExchangeRateService.retryAt = 0
      return NbpExchangeRateService.cached
    } catch (error) {
      const now = Date.now()
      NbpExchangeRateService.retryAt = now + config.failureRetrySeconds * 1_000
      logger.warn(
        {
          event: 'nbp_rate_unavailable',
          reason: error instanceof Error ? error.message : 'Nieznany błąd',
        },
        'Nie udało się pobrać kursu CZK z NBP; ceny źródłowe pozostają dostępne'
      )
      return this.staleRate(now, config)
    }
  }

  private staleRate(now: number, config: RateConfig) {
    const maxStaleMs = config.maxStaleSeconds * 1_000
    if (NbpExchangeRateService.cached && now - NbpExchangeRateService.fetchedAt <= maxStaleMs) {
      return NbpExchangeRateService.cached
    }
    return null
  }
}
