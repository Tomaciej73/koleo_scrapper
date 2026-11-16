import env from '#start/env'
import Koleo from 'open-koleo'

export class KoleoClientConfigurationError extends Error {}

export function createKoleoClient() {
  const options = {
    apiBaseUrl: env.get('KOLEO_API_BASE_URL'),
    userAgent: env.get('KOLEO_CLIENT_USER_AGENT'),
    clientName: env.get('KOLEO_CLIENT_NAME'),
    clientVersion: env.get('KOLEO_CLIENT_VERSION'),
    eolResponseVersion: env.get('KOLEO_EOL_RESPONSE_VERSION'),
    requestTimeoutMs: env.get('KOLEO_REQUEST_TIMEOUT_MS'),
    maxRetries: env.get('KOLEO_REQUEST_MAX_RETRIES'),
    retryBaseDelayMs: env.get('KOLEO_REQUEST_RETRY_BASE_DELAY_MS'),
    retryMaxDelayMs: env.get('KOLEO_REQUEST_RETRY_MAX_DELAY_MS'),
    maxConcurrency: env.get('KOLEO_REQUEST_MAX_CONCURRENCY'),
  }

  const missing = Object.entries(options)
    .filter(([, value]) => value === undefined || value === '')
    .map(([name]) => name)
  if (missing.length) {
    throw new KoleoClientConfigurationError(
      `Brak konfiguracji klienta KOLEO: ${missing.join(', ')}`
    )
  }

  return new Koleo({
    apiBaseUrl: options.apiBaseUrl!,
    userAgent: options.userAgent!,
    clientName: options.clientName!,
    clientVersion: options.clientVersion!,
    eolResponseVersion: options.eolResponseVersion!,
    requestTimeoutMs: options.requestTimeoutMs!,
    maxRetries: options.maxRetries!,
    retryBaseDelayMs: options.retryBaseDelayMs!,
    retryMaxDelayMs: options.retryMaxDelayMs!,
    maxConcurrency: options.maxConcurrency!,
  })
}
