import ConnectionSearchService, {
  ConnectionSearchError,
  isKoleoProviderFailure,
  normalizeKoleoSearchResponse,
} from '#services/connection_search_service'
import { KoleoTransportError } from 'open-koleo'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const futureDate = () => DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate()!

test.group('Connection search service', () => {
  test('returns deterministic offline results in demo mode', async ({ assert }) => {
    const service = new ConnectionSearchService()
    const results = await service.search({
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDate(),
      departureTime: '14:54',
      onlyDirect: true,
    })

    assert.equal(service.provider, 'demo')
    assert.lengthOf(results, 1)
    assert.equal(results[0].departure, '14:54')
    assert.equal(results[0].changes, 0)
    assert.equal(results[0].provider, 'demo')
    assert.isAbove(results[0].priceCents!, 0)
  })

  test('returns several suggestions when time is omitted', async ({ assert }) => {
    const results = await new ConnectionSearchService().search({
      origin: 'Olsztyn Główny',
      originStationId: 4,
      destination: 'Wrocław Główny',
      destinationStationId: 1,
      travelDate: futureDate(),
      onlyDirect: false,
    })

    assert.lengthOf(results, 3)
    assert.deepEqual(
      results.map((result) => result.departure),
      ['08:00', '10:00', '12:00']
    )
  })

  test('marks an overnight arrival with the next calendar date', async ({ assert }) => {
    const [connection] = await new ConnectionSearchService().search({
      origin: 'Wrocław Główny',
      originStationId: 1,
      destination: 'Olsztyn Główny',
      destinationStationId: 4,
      travelDate: futureDate(),
      departureTime: '22:30',
      onlyDirect: true,
    })

    const expectedDeparture = futureDate()
    const expectedArrival = DateTime.fromISO(expectedDeparture).plus({ days: 1 })
    assert.equal(connection.departureDate, expectedDeparture)
    assert.equal(connection.arrivalDate, expectedArrival.toISODate())
    assert.equal(connection.arrivalDateLabel, expectedArrival.toFormat('dd.LL.yyyy'))
    assert.equal(connection.arrivalDayOffset, 1)
  })

  test('treats the KOLEO no-connections response as an empty successful result', ({ assert }) => {
    const results = normalizeKoleoSearchResponse({
      error: 'No connections found.',
      code: 'noConnectionsFound',
    })

    assert.deepEqual(results, [])
  })

  test('translates other KOLEO search errors without exposing the upstream message', ({
    assert,
  }) => {
    const run = () =>
      normalizeKoleoSearchResponse({
        error: 'Internal upstream diagnostic that must not reach the browser',
        code: 'upstreamFailure',
      })

    assert.throws(run, ConnectionSearchError)
    assert.throws(run, 'Nie udało się pobrać połączeń z KOLEO. Spróbuj ponownie później.')
  })

  test('counts only temporary upstream and transport failures for the circuit breaker', ({
    assert,
  }) => {
    const errorFor = (status: number) => {
      try {
        normalizeKoleoSearchResponse({ error: `HTTP ${status}`, status })
      } catch (error) {
        return error
      }
    }

    assert.isFalse(isKoleoProviderFailure(errorFor(400)))
    assert.isFalse(isKoleoProviderFailure(errorFor(404)))
    assert.isFalse(
      isKoleoProviderFailure(new ConnectionSearchError('Nieprawidłowa stacja', 'stationsNotFound'))
    )
    assert.isTrue(isKoleoProviderFailure(errorFor(408)))
    assert.isTrue(isKoleoProviderFailure(errorFor(429)))
    assert.isTrue(isKoleoProviderFailure(errorFor(503)))
    assert.isTrue(isKoleoProviderFailure(new KoleoTransportError(new TypeError('fetch failed'))))
    assert.isFalse(isKoleoProviderFailure(new TypeError('Błąd aplikacji')))
  })
})
