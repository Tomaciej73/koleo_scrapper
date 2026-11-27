import { createHash } from 'node:crypto'

export interface SmsApiConfiguration {
  url: string
  sender: string
  token?: string
  username?: string
  password?: string
  passwordMd5?: string
  timeoutMs: number
}

export class SmsApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number
  ) {
    super(message)
  }
}

export default class SmsApiService {
  constructor(
    private readonly configuration: SmsApiConfiguration,
    private readonly request: typeof fetch = globalThis.fetch
  ) {}

  async send(recipient: string, message: string, messageId: string): Promise<void> {
    const endpoint = new URL(this.configuration.url)
    if (endpoint.protocol !== 'https:') {
      throw new SmsApiError('SMSAPI wymaga połączenia HTTPS.')
    }

    // SMSAPI accepts letters and digits in idx. A stable digest also keeps the
    // same idempotency key across outbox retries without exposing internal IDs.
    const idx = createHash('sha256').update(messageId).digest('hex')
    const body = new URLSearchParams({
      to: recipient.replace(/^\+/, ''),
      from: this.configuration.sender,
      message,
      encoding: 'utf-8',
      format: 'json',
      idx,
      check_idx: '1',
    })
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    }
    if (this.configuration.token) {
      headers.authorization = `Bearer ${this.configuration.token}`
    } else if (this.configuration.username && this.configuration.password) {
      // The broker's SMSAPI library accepts a raw API password and hashes it
      // before constructing HTTP Basic credentials. Never send the raw value.
      const passwordMd5 = createHash('md5').update(this.configuration.password).digest('hex')
      headers.authorization = `Basic ${Buffer.from(`${this.configuration.username}:${passwordMd5}`).toString('base64')}`
    } else if (this.configuration.username && this.configuration.passwordMd5) {
      body.set('username', this.configuration.username)
      body.set('password', this.configuration.passwordMd5)
    } else {
      throw new SmsApiError('Brakuje danych uwierzytelniających SMSAPI.')
    }

    let response: Response
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      })
    } catch {
      throw new SmsApiError('SMSAPI nie odpowiedziało w wymaganym czasie.')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new SmsApiError(`SMSAPI zwróciło nieprawidłową odpowiedź (HTTP ${response.status}).`)
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new SmsApiError('SMSAPI zwróciło nieprawidłową odpowiedź.')
    }

    const result = payload as {
      error?: unknown
      count?: unknown
      list?: Array<{ id?: unknown; error?: unknown }>
    }
    const errorCode = Number(result.error)
    // With check_idx=1, error 53 means the same message was already accepted
    // within the provider's duplicate-check window (for example, before a lost HTTP reply).
    if (errorCode === 53) return
    if (result.error !== null && result.error !== undefined) {
      throw new SmsApiError(
        `SMSAPI odrzuciło wiadomość (kod ${Number.isInteger(errorCode) ? errorCode : 'nieznany'}).`,
        Number.isInteger(errorCode) ? errorCode : undefined
      )
    }
    if (
      !response.ok ||
      result.count !== 1 ||
      !Array.isArray(result.list) ||
      result.list.length !== 1 ||
      typeof result.list[0]?.id !== 'string' ||
      (result.list[0].error !== null && result.list[0].error !== undefined)
    ) {
      throw new SmsApiError(
        `SMSAPI nie potwierdziło przyjęcia wiadomości (HTTP ${response.status}).`
      )
    }
  }
}
