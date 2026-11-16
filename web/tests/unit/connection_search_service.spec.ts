import ConnectionSearchService from '#services/connection_search_service'
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
})
