import type { HttpContext } from '@adonisjs/core/http'
import { createHash } from 'node:crypto'

export default class SecurityEventService {
  static emailHash(email: string) {
    return this.hash(email.trim().toLocaleLowerCase('en-US'))
  }

  static requestContext(request: HttpContext['request']) {
    return {
      ipHash: this.hash(request.ip()),
      userAgent: this.safeText(request.header('user-agent') ?? 'nieznany', 160),
    }
  }

  static hash(value: string) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24)
  }

  static safeText(value: string, maximumLength: number) {
    return Array.from(value, (character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127 ? ' ' : character
    })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maximumLength)
  }
}
