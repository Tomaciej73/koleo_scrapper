import type { HttpContext } from '@adonisjs/core/http'
import SecurityEventService from '#services/security_event_service'

export default class CspReportsController {
  async store({ request, response, logger }: HttpContext) {
    const payload = request.body() as Record<string, unknown> | undefined
    const report = this.record(payload?.['csp-report']) ?? this.record(payload)
    const directive = this.safeText(report?.['effective-directive'], 80) || 'nieznana dyrektywa'
    const blockedSource = this.safeBlockedSource(report?.['blocked-uri'])
    const documentPath = this.safePath(report?.['document-uri']) ?? 'nieznana'
    const sourcePath = this.safePath(report?.['source-file'])
    const lineNumber = this.safeLineNumber(report?.['line-number'])

    logger.warn(
      {
        csp: {
          documentUri: this.safeUri(report?.['document-uri']),
          blockedUri: this.safeUri(report?.['blocked-uri']),
          effectiveDirective: directive,
          disposition: this.safeText(report?.disposition),
          sourceFile: this.safeUri(report?.['source-file']),
          lineNumber,
        },
      },
      `Naruszenie CSP: ${directive}; zablokowano ${blockedSource}; strona ${documentPath}${sourcePath ? `; źródło ${sourcePath}${lineNumber === null ? '' : `:${lineNumber}`}` : ''}`
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
      return this.redactResetToken(`${url.origin}${url.pathname}`).slice(0, 500)
    } catch {
      return null
    }
  }

  private safeBlockedSource(value: unknown) {
    const text = this.safeText(value)
    if (!text) {
      return 'nieznane źródło'
    }

    try {
      const url = new URL(text)
      return url.origin === 'null' ? url.protocol : url.origin
    } catch {
      return ['inline', 'eval', 'data', 'blob', 'self'].includes(text) ? text : 'inne źródło'
    }
  }

  private safePath(value: unknown) {
    const text = this.safeText(value)
    if (!text) {
      return null
    }

    try {
      return this.redactResetToken(new URL(text).pathname).slice(0, 120)
    } catch {
      return null
    }
  }

  private safeLineNumber(value: unknown) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
      return null
    }
    const number = Number(value)
    return Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000 ? number : null
  }

  private redactResetToken(value: string) {
    return value.replace(/(\/reset-password\/)[a-f0-9]{64}(?=\/|$)/gi, '$1[ukryto]')
  }

  private safeText(value: unknown, maximumLength = 500) {
    return typeof value === 'string' ? SecurityEventService.safeText(value, maximumLength) : null
  }
}
