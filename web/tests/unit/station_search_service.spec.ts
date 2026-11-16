import StationSearchService from '#services/station_search_service'
import { test } from '@japa/runner'

test.group('Station search service', () => {
  test('matches station names regardless of case and Polish diacritics', async ({ assert }) => {
    const service = new StationSearchService()

    const lowercase = await service.search('wrocław')
    const uppercase = await service.search('WROCŁAW')
    const withoutDiacritics = await service.search('wroclaw')

    assert.equal(lowercase[0]?.name, 'Wrocław Główny')
    assert.deepEqual(uppercase, lowercase)
    assert.deepEqual(withoutDiacritics, lowercase)
  })
})
