import env from '#start/env'

export class SmsGatewayError extends Error {}

export default class SmsGatewayService {
  static enabled() {
    return env.get('SMS_ENABLED') ?? false
  }

  static configured() {
    const messagesUrl = env.get('SMS_GATEWAY_MESSAGES_URL')
    return Boolean(
      this.enabled() &&
      messagesUrl &&
      new URL(messagesUrl).protocol === 'https:' &&
      env.get('SMS_GATEWAY_USERNAME') &&
      env.get('SMS_GATEWAY_PASSWORD')?.release()
    )
  }

  static normalizePolishNumber(value: string): string | null {
    const countryCode = env.get('SMS_PHONE_COUNTRY_CODE')
    const nationalLength = env.get('SMS_PHONE_NATIONAL_LENGTH')
    if (!countryCode || !nationalLength || !/^\d{1,3}$/.test(countryCode)) return null
    const compact = value.replace(/[\s()-]/g, '')
    const national = compact.startsWith(`+${countryCode}`)
      ? compact.slice(countryCode.length + 1)
      : compact
    if (!new RegExp(`^[1-9]\\d{${nationalLength - 1}}$`).test(national)) return null
    return `+${countryCode}${national}`
  }

  async send(recipient: string, message: string, messageId: string): Promise<void> {
    if (!SmsGatewayService.configured()) {
      throw new SmsGatewayError('Wysyłka SMS nie jest skonfigurowana.')
    }
    const endpoint = new URL(env.get('SMS_GATEWAY_MESSAGES_URL')!)
    if (endpoint.protocol !== 'https:') {
      throw new SmsGatewayError('Bramka SMS wymaga połączenia HTTPS.')
    }
    const username = env.get('SMS_GATEWAY_USERNAME')!
    const password = env.get('SMS_GATEWAY_PASSWORD')!.release()
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    const timeout = Math.max(1, env.get('SMS_REQUEST_TIMEOUT_MS') ?? 10_000)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: messageId,
          textMessage: { text: message },
          phoneNumbers: [recipient],
          ttl: env.get('SMS_MESSAGE_TTL_SECONDS') ?? 3600,
        }),
        signal: AbortSignal.timeout(timeout),
      })
    } catch {
      throw new SmsGatewayError('Bramka SMS nie odpowiedziała w wymaganym czasie.')
    }
    if (response.ok) return
    if (response.status === 409) {
      const statusUrl = new URL(
        `${endpoint.pathname.replace(/\/$/, '')}/${encodeURIComponent(messageId)}`,
        endpoint
      )
      try {
        const status = await fetch(statusUrl, {
          headers: { authorization },
          signal: AbortSignal.timeout(timeout),
        })
        if (status.ok) {
          const statusMessage = (await status.json()) as { state?: unknown }
          if (
            typeof statusMessage.state === 'string' &&
            ['pending', 'processed', 'sent', 'delivered'].includes(
              statusMessage.state.toLowerCase()
            )
          ) {
            return
          }
        }
      } catch {
        // The request below will be retried with the same message ID.
      }
    }
    throw new SmsGatewayError(`Bramka SMS odrzuciła żądanie (HTTP ${response.status}).`)
  }
}
