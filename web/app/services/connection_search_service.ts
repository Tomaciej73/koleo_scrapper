import env from '#start/env'
import { createKoleoClient } from '#services/koleo_client_factory'
import MetricsService from '#services/metrics_service'
import KoleoCircuitBreakerService, {
  KoleoCircuitOpenError,
} from '#services/koleo_circuit_breaker_service'
import {
  KoleoTransportError,
  type KoleoConnection,
  type KoleoError,
  type KoleoPrice,
} from 'open-koleo'
import type Koleo from 'open-koleo'
import { DateTime } from 'luxon'
import CdPublicService from '#services/cd_public_service'

export type PriceProviderName = 'demo' | 'koleo' | 'cd'
export type TicketAvailability = 'available' | 'unavailable' | 'unknown'

export interface ConnectionSearchInput {
  provider?: PriceProviderName
  origin: string
  originStationId: number
  destination: string
  destinationStationId: number
  travelDate: string
  departureTime?: string
  onlyDirect: boolean
}

export interface ConnectionResult {
  uuid: string
  departure: string
  departureMinutes: number
  departureDate: string
  arrival: string
  arrivalDate: string
  arrivalDateLabel: string
  arrivalDayOffset: number
  durationMinutes: number
  trains: string
  changes: number
  priceCents: number | null
  purchasable: boolean | null
  ticketAvailability: TicketAvailability
  availabilityMessage: string | null
  provider: PriceProviderName
}

export type ConnectionMetadata = Omit<
  ConnectionResult,
  'priceCents' | 'purchasable' | 'ticketAvailability' | 'availabilityMessage'
>

export interface WatchedConnectionResult {
  connection: ConnectionResult | null
  resultCount: number
}

export class ConnectionSearchError extends Error {
  constructor(
    message: string,
    public readonly code = 'connectionSearchFailed',
    options?: ErrorOptions,
    public readonly status: number | null = null
  ) {
    super(message, options)
    this.name = 'ConnectionSearchError'
  }
}

export function resolvePriceProvider(requested?: PriceProviderName): PriceProviderName {
  const configured = env.get('PRICE_PROVIDER') ?? 'demo'
  if (!requested || requested === configured) return configured
  if (requested === 'cd' && env.get('CD_ENABLED')) return 'cd'
  if (requested === 'koleo' && configured === 'koleo') return 'koleo'
  throw new ConnectionSearchError('Wybrane źródło cen nie jest włączone.', 'providerUnavailable')
}

function upstreamStatus(response: { error?: string; status?: number }): number | null {
  if (typeof response.status === 'number') {
    return response.status
  }
  const match = /^HTTP (\d{3})$/.exec(response.error ?? '')
  return match ? Number(match[1]) : null
}

function isTemporaryUpstreamStatus(status: number | null) {
  return status === 408 || status === 429 || (status !== null && status >= 500 && status < 600)
}

export function isKoleoProviderFailure(error: unknown) {
  return (
    error instanceof KoleoTransportError ||
    (error instanceof ConnectionSearchError && isTemporaryUpstreamStatus(error.status))
  )
}

export function normalizeKoleoSearchResponse(
  response: KoleoConnection[] | KoleoError
): KoleoConnection[] {
  if (Array.isArray(response)) {
    return response
  }

  if (response.code === 'noConnectionsFound') {
    return []
  }

  const message =
    response.code === 'stationsNotFound' || response.code === 'slugConversionFailed'
      ? 'Nie znaleziono wybranej stacji w KOLEO. Wybierz stację ponownie z listy.'
      : 'Nie udało się pobrać połączeń z KOLEO. Spróbuj ponownie później.'

  throw new ConnectionSearchError(
    message,
    response.code ?? 'koleoSearchFailed',
    undefined,
    upstreamStatus(response)
  )
}

export default class ConnectionSearchService {
  readonly provider: PriceProviderName
  private readonly cd = new CdPublicService()
  private readonly watchedConnections = new Map<string, Promise<KoleoConnection[]>>()
  private readonly watchedPrices = new Map<string, Promise<KoleoPrice>>()

  constructor(provider?: PriceProviderName) {
    this.provider = resolvePriceProvider(provider)
  }

  async search(input: ConnectionSearchInput): Promise<ConnectionResult[]> {
    if (this.provider === 'cd') return this.cd.search(input)
    if (this.provider === 'koleo') {
      return this.withKoleoMonitoring(() => this.searchKoleo(input))
    }

    return this.searchDemo(input)
  }

  async searchForWatch(
    input: ConnectionSearchInput,
    select: (connections: ConnectionMetadata[]) => string | undefined
  ): Promise<WatchedConnectionResult> {
    if (this.provider === 'cd') return this.cd.searchForWatch(input, select)
    if (this.provider !== 'koleo') {
      const results = await this.search(input)
      const uuid = select(results)
      return {
        connection: results.find((result) => result.uuid === uuid) ?? null,
        resultCount: results.length,
      }
    }

    return this.withKoleoMonitoring(async () => {
      const client = createKoleoClient()
      const key = JSON.stringify([
        input.originStationId,
        input.destinationStationId,
        input.travelDate,
        input.departureTime ?? null,
        input.onlyDirect,
      ])
      const connections = await this.cached(this.watchedConnections, key, () =>
        this.findKoleoConnections(client, input)
      )
      const candidates = connections.map((connection) => this.mapKoleoMetadata(connection))
      const uuid = select(candidates)
      const matching = uuid && connections.find((connection) => connection.uuid === uuid)
      if (!matching) {
        return { connection: null, resultCount: candidates.length }
      }

      const price = await this.cached(this.watchedPrices, matching.uuid, async () => {
        const response = await client.connections.getConnectionTicketPrice(matching.uuid)
        this.assertPriceResponse(response)
        return response
      })
      return {
        connection: this.withKoleoPrice(this.mapKoleoMetadata(matching), price),
        resultCount: candidates.length,
      }
    })
  }

  private async withKoleoMonitoring<T>(operation: () => Promise<T>): Promise<T> {
    const startedAt = performance.now()
    let failed = false
    const circuitBreaker = new KoleoCircuitBreakerService()
    try {
      await circuitBreaker.assertAvailable()
      const result = await operation()
      await circuitBreaker.recordSuccess()
      return result
    } catch (error) {
      failed = true
      if (!(error instanceof KoleoCircuitOpenError) && isKoleoProviderFailure(error)) {
        await circuitBreaker.recordFailure(error)
      }
      throw error
    } finally {
      await new MetricsService().recordKoleoRequest(performance.now() - startedAt, failed)
    }
  }

  private async cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
    let pending = cache.get(key)
    if (!pending) {
      pending = load()
      cache.set(key, pending)
    }
    try {
      return await pending
    } catch (error) {
      if (cache.get(key) === pending) {
        cache.delete(key)
      }
      throw error
    }
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
    const routeSeed = this.hash(
      `${input.originStationId ?? input.origin}|${input.destinationStationId ?? input.destination}|${input.travelDate}`
    )

    return Array.from({ length: count }, (_, index) => {
      const departure = baseDeparture.plus({ hours: index * 2 })
      const durationMinutes = 290 + ((routeSeed + index * 17) % 95)
      const arrival = departure.plus({ minutes: durationMinutes })
      const priceCents = Math.max(100, 2_900 + (routeSeed % 5_500) + index * 360 + offset)

      return {
        uuid: `demo-${routeSeed}-${index}`,
        departure: departure.toFormat('HH:mm'),
        departureMinutes: departure.hour * 60 + departure.minute,
        departureDate: departure.toISODate()!,
        arrival: arrival.toFormat('HH:mm'),
        arrivalDate: arrival.toISODate()!,
        arrivalDateLabel: arrival.toFormat('dd.LL.yyyy'),
        arrivalDayOffset: this.dayOffset(departure, arrival),
        durationMinutes,
        trains: `POŁĄCZENIE DEMO ${100 + index}`,
        changes: input.onlyDirect ? 0 : index % 2,
        priceCents,
        purchasable: false,
        ticketAvailability: 'unavailable' as const,
        availabilityMessage: 'Tryb demonstracyjny — zakup biletu nie jest dostępny.',
        provider: 'demo',
      }
    })
  }

  private async searchKoleo(input: ConnectionSearchInput): Promise<ConnectionResult[]> {
    const client = createKoleoClient()
    const matching = await this.findKoleoConnections(client, input)
    return Promise.all(matching.map((connection) => this.mapKoleoConnection(client, connection)))
  }

  private async findKoleoConnections(client: Koleo, input: ConnectionSearchInput) {
    const departureTime = input.departureTime ?? '00:00'
    const response = await client.connections.findConnectionByStationIds(
      input.originStationId,
      input.destinationStationId,
      `${input.travelDate}T${departureTime}:00`,
      input.onlyDirect
    )
    const connections = normalizeKoleoSearchResponse(response)

    const resultLimit = env.get('SEARCH_RESULT_LIMIT') ?? 20
    const matching = connections
      .filter((connection) => connection.departure?.startsWith(`${input.travelDate}T`))
      .slice(0, resultLimit)

    return matching
  }

  private async mapKoleoConnection(client: Koleo, connection: KoleoConnection) {
    const price = await client.connections.getConnectionTicketPrice(connection.uuid)
    this.assertPriceResponse(price)
    return this.withKoleoPrice(this.mapKoleoMetadata(connection), price)
  }

  private assertPriceResponse(price: KoleoPrice) {
    const status = upstreamStatus(price)
    if (isTemporaryUpstreamStatus(status)) {
      throw new ConnectionSearchError(
        'Nie udało się pobrać ceny z KOLEO. Spróbuj ponownie później.',
        'koleoPriceFailed',
        undefined,
        status
      )
    }
  }

  private withKoleoPrice(metadata: ConnectionMetadata, price: KoleoPrice): ConnectionResult {
    const parsedPrice = Number(price.price)
    const purchasable = price.error ? null : (price.purchasable ?? null)
    const ticketAvailability: TicketAvailability =
      purchasable === true
        ? 'available'
        : price.error || purchasable === false
          ? 'unavailable'
          : 'unknown'
    const availabilityMessage = this.availabilityMessage(price, ticketAvailability)
    return {
      ...metadata,
      priceCents:
        price.error || !Number.isFinite(parsedPrice) ? null : Math.round(parsedPrice * 100),
      purchasable,
      ticketAvailability,
      availabilityMessage,
    }
  }

  private mapKoleoMetadata(connection: KoleoConnection): ConnectionMetadata {
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
      departureMinutes: departure.hour * 60 + departure.minute,
      departureDate: departure.toISODate() ?? connection.departure.slice(0, 10),
      arrival: connection.arrival.slice(11, 16),
      arrivalDate: arrival.toISODate() ?? connection.arrival.slice(0, 10),
      arrivalDateLabel: arrival.isValid
        ? arrival.toFormat('dd.LL.yyyy')
        : connection.arrival.slice(0, 10),
      arrivalDayOffset: this.dayOffset(departure, arrival),
      durationMinutes,
      trains: trains || 'Brak nazwy pociągu',
      changes: connection.changes ?? 0,
      provider: 'koleo' as const,
    }
  }

  private availabilityMessage(
    price: {
      error?: unknown
      respBody?: { json?: { message?: unknown } }
    },
    availability: TicketAvailability
  ) {
    const upstreamMessage = price.respBody?.json?.message
    if (typeof upstreamMessage === 'string' && upstreamMessage.trim()) {
      return upstreamMessage.replace(/\s+/g, ' ').trim().slice(0, 500)
    }

    if (availability === 'unavailable') {
      return 'KOLEO nie udostępnia obecnie zakupu biletu dla tego połączenia.'
    }

    if (availability === 'unknown') {
      return 'KOLEO nie przekazało informacji o możliwości zakupu biletu.'
    }

    return null
  }

  private hash(value: string) {
    let result = 0
    for (const character of value) {
      result = (result * 31 + character.charCodeAt(0)) >>> 0
    }
    return result
  }

  private dayOffset(departure: DateTime, arrival: DateTime) {
    if (!departure.isValid || !arrival.isValid) {
      return 0
    }

    return Math.max(
      0,
      Math.round(arrival.startOf('day').diff(departure.startOf('day'), 'days').days)
    )
  }
}
