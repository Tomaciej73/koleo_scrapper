import CdPublicService from '#services/cd_public_service'
import { ConnectionSearchError } from '#services/connection_search_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const webBaseUrl = 'https://cd.example.test/en/spojeni-a-jizdenka/'
const stationAutocompleteUrl = 'https://stations.example.test/ACEConnection'
const options = {
  webBaseUrl,
  stationAutocompleteUrl,
  stationCombination: 'test-combination',
  stationLanguage: 'en',
  requestTimeoutMs: 10_000,
  maxRedirects: 3,
  maxRetries: 0,
  retryBaseDelayMs: 0,
  maxConcurrency: 2,
  maxSearchPages: 3,
}

test.group('Public ČD adapter', () => {
  test('accepts Polish station spelling but retains ČD station ID and canonical name', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.get('prefixText'), 'Wroclaw Glowny')
      return new Response(
        'cdwatch([{"selectedText":"Wroclaw Glowny; Poland","value":"5100069","iconId":3}]);'
      )
    }
    try {
      const stations = await new CdPublicService(options).stations('Wrocław Główny', 5)
      assert.deepEqual(stations, [{ id: 5100069, name: 'Wroclaw Glowny; Poland', slug: null }])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('uses public station names and separates exact prices from route search', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    const date = DateTime.now().plus({ days: 3 }).toISODate()!
    const cdDate = DateTime.fromISO(date).toFormat('dd.LL.yyyy')
    let pageRequests = 0
    let redirectRequests = 0
    let priceRequests = 0
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.startsWith(stationAutocompleteUrl)) {
        return new Response(
          'cdwatch([{"selectedText":"Brno hl.n.","value":"5433295","iconId":3},{"selectedText":"Brno","value":"1","iconId":1}]);'
        )
      }
      if (url.includes('/apiform?')) {
        pageRequests += 1
        return new Response(null, {
          status: 302,
          headers: {
            'location': '/en/spojeni-a-jizdenka/spojeni-tam/test-guid',
            'set-cookie': 'session=test-cookie; Path=/; HttpOnly',
          },
        })
      }
      if (url.includes('/spojeni-tam/')) {
        redirectRequests += 1
        assert.include(JSON.stringify(init?.headers), 'session=test-cookie')
        const model = {
          guid: 'test-guid',
          pageType: 0,
          list: [
            {
              handle: 123,
              id: 456,
              auxDesc: 'opaque-route',
              changesCount: 0,
              trains: [
                {
                  trainName: 'EC 281',
                  trainNum: '281',
                  from: 'Brno hl.n.',
                  to: 'Wroclaw Glowny',
                  depDate: cdDate,
                  depTime: '14:56',
                  arrDate: cdDate,
                  arrTime: '18:45',
                },
              ],
            },
          ],
        }
        return new Response(
          `<input name="__RequestVerificationToken" type="hidden" value="test-token" />\nvar model = ${JSON.stringify(model)};`
        )
      }
      if (url.includes('/GetConnListPrice/')) {
        priceRequests += 1
        assert.equal(init?.method, 'POST')
        assert.include(String(init?.body), 'model%5BloadPrices%5D%5B0%5D%5BconnID%5D=456')
        return Response.json({
          list: [{ id: 456, price: { price: 62_000, canProceed: true, noPrice: false } }],
        })
      }
      throw new Error(`Unexpected test request: ${url}`)
    }

    try {
      const service = new CdPublicService(options)
      const stations = await service.stations('Brno', 5)
      assert.lengthOf(stations, 1)
      assert.equal(stations[0].name, 'Brno hl.n.')
      const input = {
        origin: 'Brno hl.n.',
        originStationId: stations[0].id,
        destination: 'Wroclaw Glowny',
        destinationStationId: 2,
        travelDate: date,
        departureTime: '14:00',
        onlyDirect: false,
      }
      const missing = await service.searchForWatch(input, () => 'other-connection')
      assert.isNull(missing.connection)
      assert.equal(priceRequests, 0)
      const watched = await service.searchForWatch(input, (rows) => rows[0]?.uuid)
      assert.equal(watched.connection?.priceCents, 62_000)
      assert.equal(watched.connection?.provider, 'cd')
      assert.equal(watched.connection?.ticketAvailability, 'available')
      const searchResults = await service.search(input)
      assert.equal(searchResults[0].uuid, watched.connection?.uuid)
      assert.equal(pageRequests, 1)
      assert.equal(redirectRequests, 1)
      assert.equal(priceRequests, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('searches the whole selected day using ČD result pagination without duplicate prices', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    const date = DateTime.now().plus({ days: 3 }).toISODate()!
    const previousDate = DateTime.fromISO(date).minus({ days: 1 }).toFormat('dd.LL.yyyy')
    const cdDate = DateTime.fromISO(date).toFormat('dd.LL.yyyy')
    let pageRequests = 0
    let nextRequests = 0
    let priceRequests = 0
    const connection = (id: number, time: string, departureDate = cdDate) => ({
      handle: id,
      id,
      changesCount: 0,
      trains: [
        {
          trainName: `EC ${id}`,
          trainNum: String(id),
          from: 'Brno hl.n.',
          to: 'Wroclaw Glowny',
          depDate: departureDate,
          depTime: time,
          arrDate: departureDate,
          arrTime: time,
        },
      ],
    })
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/apiform')) {
        pageRequests += 1
        assert.equal(url.searchParams.get('date'), previousDate)
        assert.equal(url.searchParams.get('time'), '23:59')
        return new Response(
          `<input name="__RequestVerificationToken" type="hidden" value="test-token" />\nvar model = ${JSON.stringify(
            {
              guid: 'test-guid',
              pageType: 0,
              allowNext: true,
              list: [connection(1, '00:05'), connection(2, '06:00'), connection(3, '10:00')],
            }
          )};`,
          { headers: { 'set-cookie': 'session=test-cookie; Path=/; HttpOnly' } }
        )
      }
      if (url.pathname.endsWith('/getconnectionlist/')) {
        nextRequests += 1
        assert.equal(init?.method, 'POST')
        const body = new URLSearchParams(String(init?.body))
        assert.equal(body.get('model[SearchType]'), '2')
        assert.equal(body.get('model[nextID]'), '2')
        assert.include(JSON.stringify(init?.headers), 'session=test-cookie')
        return Response.json({
          guid: 'test-guid',
          pageType: 0,
          allowNext: false,
          list: [
            connection(3, '10:00'),
            connection(4, '18:00'),
            connection(5, '00:30', DateTime.fromISO(date).plus({ days: 1 }).toFormat('dd.LL.yyyy')),
          ],
        })
      }
      if (url.pathname.endsWith('/GetConnListPrice/')) {
        priceRequests += 1
        const body = new URLSearchParams(String(init?.body))
        const id = Number(body.get('model[loadPrices][0][connID]'))
        return Response.json({ list: [{ id, price: { price: 12_000, canProceed: true } }] })
      }
      throw new Error(`Unexpected test request: ${url.pathname}`)
    }

    try {
      const results = await new CdPublicService(options).search({
        origin: 'Brno hl.n.',
        originStationId: 1,
        destination: 'Wroclaw Glowny',
        destinationStationId: 2,
        travelDate: date,
        onlyDirect: false,
      })
      assert.deepEqual(
        results.map((result) => result.departure),
        ['00:05', '06:00', '10:00', '18:00']
      )
      assert.equal(pageRequests, 1)
      assert.equal(nextRequests, 1)
      assert.equal(priceRequests, 4)

      const limitedResults = await new CdPublicService({ ...options, maxSearchPages: 1 }).search({
        origin: 'Brno hl.n.',
        originStationId: 1,
        destination: 'Wroclaw Glowny',
        destinationStationId: 2,
        travelDate: date,
        onlyDirect: false,
      })
      assert.lengthOf(limitedResults, 3)
      assert.equal(nextRequests, 1)

      const watched = await new CdPublicService(options).searchForWatch(
        {
          origin: 'Brno hl.n.',
          originStationId: 1,
          destination: 'Wroclaw Glowny',
          destinationStationId: 2,
          travelDate: date,
          departureTime: '00:05',
          onlyDirect: false,
        },
        (rows) => rows.find((row) => row.departure === '00:05')?.uuid
      )
      assert.equal(watched.connection?.departure, '00:05')
      assert.equal(pageRequests, 3)
      assert.equal(priceRequests, 8)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('reports ČD access denial instead of a malformed connection list without leaking the upstream address', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        `<input name="__RequestVerificationToken" type="hidden" value="test-token" />\nvar model = ${JSON.stringify(
          {
            doSearch: false,
            errors: {
              title: 'The connection cannot be found',
              content:
                'Access to the timetable server from address 192.0.2.10 denied due to the rule DENY/last.',
            },
          }
        )};`
      )

    try {
      let failure: unknown
      try {
        await new CdPublicService(options).search({
          origin: 'Brno hl.n.',
          originStationId: 1,
          destination: 'Wroclaw Glowny; Poland',
          destinationStationId: 2,
          travelDate: DateTime.now().plus({ days: 3 }).toISODate()!,
          onlyDirect: false,
        })
      } catch (error) {
        failure = error
      }
      assert.instanceOf(failure, ConnectionSearchError)
      assert.equal((failure as ConnectionSearchError).code, 'cdAccessDenied')
      assert.notInclude((failure as ConnectionSearchError).message, '192.0.2.10')
      assert.notInclude((failure as ConnectionSearchError).message, 'DENY/last')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('classifies an upstream search error even when the price token is missing', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        `var model = ${JSON.stringify({ errors: { title: 'Invalid journey', content: 'Invalid stations' } })};`
      )
    try {
      let failure: unknown
      try {
        await new CdPublicService(options).search({
          origin: 'Brno hl.n.',
          originStationId: 1,
          destination: 'Wroclaw Glowny; Poland',
          destinationStationId: 2,
          travelDate: DateTime.now().plus({ days: 3 }).toISODate()!,
          onlyDirect: false,
        })
      } catch (error) {
        failure = error
      }
      assert.instanceOf(failure, ConnectionSearchError)
      assert.equal((failure as ConnectionSearchError).code, 'cdSearchRejected')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

if (process.env.CD_LIVE_SMOKE === '1') {
  test('public ČD smoke check (explicitly enabled)', async ({ assert }) => {
    try {
      const service = new CdPublicService({
        webBaseUrl: process.env.CD_WEB_BASE_URL,
        stationAutocompleteUrl: process.env.CD_STATION_AUTOCOMPLETE_URL,
        stationCombination: process.env.CD_STATION_COMBINATION,
        stationLanguage: process.env.CD_STATION_LANGUAGE,
        requestTimeoutMs: Number(process.env.CD_REQUEST_TIMEOUT_MS),
        maxRedirects: Number(process.env.CD_WEB_MAX_REDIRECTS),
        maxRetries: Number(process.env.CD_REQUEST_MAX_RETRIES),
        retryBaseDelayMs: Number(process.env.CD_REQUEST_RETRY_BASE_DELAY_MS),
        maxConcurrency: Number(process.env.CD_REQUEST_MAX_CONCURRENCY),
      })
      const originStations = await service.stations('Brno hl.n.', 5)
      const destinationStations = await service.stations('Wrocław Główny', 10)
      const origin = originStations.find((row) => row.name === 'Brno hl.n.')
      const destination = destinationStations.find((row) => row.name.includes('Wroclaw Glowny'))
      assert.isDefined(origin)
      assert.isDefined(destination)
      const results = await service.search({
        origin: origin!.name,
        originStationId: origin!.id,
        destination: destination!.name,
        destinationStationId: destination!.id,
        travelDate: process.env.CD_SMOKE_TRAVEL_DATE!,
        departureTime: process.env.CD_SMOKE_DEPARTURE_TIME!,
        onlyDirect: false,
      })
      assert.isAbove(results.length, 0)
      assert.isTrue(results.some((row) => row.priceCents !== null && row.priceCents > 0))
    } catch (error) {
      throw new Error(`ČD smoke: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      })
    }
  })
}
