import type { HttpContext } from '@adonisjs/core/http'

export default class CspReportsController {
  async store({ request, response, logger }: HttpContext) {
    const payload = request.body() as Record<string, unknown> | undefined
    const report = this.record(payload?.['csp-report']) ?? this.record(payload)

    logger.warn(
      {
        csp: {
          documentUri: this.safeUri(report?.['document-uri']),
          blockedUri: this.safeUri(report?.['blocked-uri']),
          effectiveDirective: this.safeText(report?.['effective-directive']),
          disposition: this.safeText(report?.disposition),
        },
      },
      'Content Security Policy violation'
    )

    return response.noContent()
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  private safeUri(value: unknown) {
    const text = this.safeText(value)
    if (!text) {
      return null
    }

    try {
      const url = new URL(text)
      return `${url.origin}${url.pathname}`.slice(0, 500)
    } catch {
      return text.slice(0, 500)
    }
  }

  private safeText(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, 500) : null
  }
}
