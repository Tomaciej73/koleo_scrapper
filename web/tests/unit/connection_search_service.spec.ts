import ConnectionSearchService from '#services/connection_search_service'
import { test } from '@japa/runner'

test.group('Connection search service', () => {
  test('returns deterministic offline results in demo mode', async ({ assert }) => {
    const service = new ConnectionSearchService()
    const results = await service.search({
      origin: 'Wrocław Główny',
      destination: 'Olsztyn Główny',
      travelDate: '2026-11-17',
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
      destination: 'Wrocław Główny',
      travelDate: '2026-12-01',
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
      travelDate: '2026-11-17',
      departureTime: '22:30',
      onlyDirect: true,
    })

    assert.equal(connection.departureDate, '2026-11-17')
    assert.equal(connection.arrivalDate, '2026-11-18')
    assert.equal(connection.arrivalDateLabel, '18.11.2026')
    assert.equal(connection.arrivalDayOffset, 1)
  })
})
