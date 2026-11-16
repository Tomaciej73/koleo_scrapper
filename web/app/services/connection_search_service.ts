import env from '#start/env'
import Koleo, { type KoleoConnection } from 'open-koleo'
import { DateTime } from 'luxon'

export type PriceProviderName = 'demo' | 'koleo'

export interface ConnectionSearchInput {
  origin: string
  destination: string
  travelDate: string
  departureTime?: string
  onlyDirect: boolean
}

export interface ConnectionResult {
  uuid: string
  departure: string
  arrival: string
  durationMinutes: number
  trains: string
  changes: number
  priceCents: number | null
  purchasable: boolean | null
  provider: PriceProviderName
}

export class ConnectionSearchError extends Error {}

export default class ConnectionSearchService {
  readonly provider: PriceProviderName = env.get('PRICE_PROVIDER') ?? 'demo'

  async search(input: ConnectionSearchInput): Promise<ConnectionResult[]> {
    if (this.provider === 'koleo') {
      return this.searchKoleo(input)
    }

    return this.searchDemo(input)
  }

  private searchDemo(input: ConnectionSearchInput): ConnectionResult[] {
    const requestedTime = input.departureTime || '08:00'
    const baseDeparture = DateTime.fromISO(`${input.travelDate}T${requestedTime}`, {
      zone: env.get('APP_TIMEZONE') ?? 'Europe/Warsaw',
    })

    if (!baseDeparture.isValid) {
      throw new ConnectionSearchError('Nieprawidłowa data lub godzina podróży.')
    }

    const count = input.departureTime ? 1 : 3
    const offset = env.get('DEMO_PRICE_OFFSET_CENTS') ?? 0
    const routeSeed = this.hash(`${input.origin}|${input.destination}|${input.travelDate}`)

    return Array.from({ length: count }, (_, index) => {
      const departure = baseDeparture.plus({ hours: index * 2 })
      const durationMinutes = 290 + ((routeSeed + index * 17) % 95)
      const arrival = departure.plus({ minutes: durationMinutes })
      const priceCents = Math.max(100, 2_900 + (routeSeed % 5_500) + index * 360 + offset)

      return {
        uuid: `demo-${routeSeed}-${index}`,
        departure: departure.toFormat('HH:mm'),
        arrival: arrival.toFormat('HH:mm'),
        durationMinutes,
        trains: `POŁĄCZENIE DEMO ${100 + index}`,
        changes: input.onlyDirect ? 0 : index % 2,
        priceCents,
        purchasable: false,
        provider: 'demo',
      }
    })
  }

  private async searchKoleo(input: ConnectionSearchInput): Promise<ConnectionResult[]> {
    const client = new Koleo()
    const response = await client.connections.findConnection(
      input.origin,
      input.destination,
      `${input.travelDate}T00:00:00`,
      input.onlyDirect
    )

    if (!Array.isArray(response)) {
      throw new ConnectionSearchError(response.error || 'Nie udało się pobrać połączeń.')
    }

    const resultLimit = env.get('SEARCH_RESULT_LIMIT') ?? 20
    const matching = response
      .filter((connection) => connection.departure?.startsWith(`${input.travelDate}T`))
      .filter((connection) => {
        return !input.departureTime || connection.departure.slice(11, 16) === input.departureTime
      })
      .slice(0, resultLimit)

    const results: ConnectionResult[] = []

    for (const connection of matching) {
      results.push(await this.mapKoleoConnection(client, connection))
    }

    return results
  }

  private async mapKoleoConnection(client: Koleo, connection: KoleoConnection) {
    const price = await client.connections.getConnectionTicketPrice(connection.uuid)
    const parsedPrice = Number(price.price)
    const departure = DateTime.fromISO(connection.departure)
    const arrival = DateTime.fromISO(connection.arrival)
    const durationMinutes = Math.max(0, Math.round(arrival.diff(departure, 'minutes').minutes))
    const trains = (connection.legs ?? [])
      .filter((leg) => leg.leg_type === 'train_leg')
      .map((leg) => leg.train_full_name)
      .filter((name): name is string => Boolean(name))
      .join(' → ')

    return {
      uuid: connection.uuid,
      departure: connection.departure.slice(11, 16),
      arrival: connection.arrival.slice(11, 16),
      durationMinutes,
      trains: trains || 'Brak nazwy pociągu',
      changes: connection.changes ?? 0,
      priceCents:
        price.error || !Number.isFinite(parsedPrice) ? null : Math.round(parsedPrice * 100),
      purchasable: price.error ? null : (price.purchasable ?? null),
      provider: 'koleo' as const,
    }
  }

  private hash(value: string) {
    let result = 0
    for (const character of value) {
      result = (result * 31 + character.charCodeAt(0)) >>> 0
    }
    return result
  }
}
