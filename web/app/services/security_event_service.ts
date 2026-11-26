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

  static emailForLog(email: string, includePersonalData: boolean) {
    const safeEmail = this.safeText(email.trim().toLowerCase(), 254)
    if (includePersonalData) {
      return safeEmail
    }

    const separator = safeEmail.lastIndexOf('@')
    if (separator < 1) {
      return '[ukryto]'
    }
    return `${safeEmail.slice(0, 1)}•••${safeEmail.slice(separator)}`
  }

  static journeyForLog(
    input: {
      origin: string
      originStationId: number
      destination: string
      destinationStationId: number
      travelDate: string
      departureTime?: string
      onlyDirect: boolean
    },
    includePersonalData: boolean
  ) {
    const station = (name: string, id: number) =>
      includePersonalData ? `${JSON.stringify(this.safeText(name, 120))} (#${id})` : `#${id}`

    return `${station(input.origin, input.originStationId)} → ${station(input.destination, input.destinationStationId)}, ${input.travelDate} ${input.departureTime ?? 'dowolna godzina'}, bez przesiadek: ${input.onlyDirect ? 'tak' : 'nie'}`
  }

  static safeText(value: string, maximumLength: number) {
    return Array.from(value, (character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character
    })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maximumLength)
  }
}
