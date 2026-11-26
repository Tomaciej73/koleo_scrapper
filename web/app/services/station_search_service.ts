import env from '#start/env'
import { createKoleoClient } from '#services/koleo_client_factory'
import { type KoleoStation, type KoleoStationSearch } from 'open-koleo'
import CdPublicService from '#services/cd_public_service'
import { resolvePriceProvider, type PriceProviderName } from '#services/connection_search_service'

export interface StationSuggestion {
  id: number
  name: string
  slug: string | null
}

interface CacheEntry {
  expiresAt: number
  stations: StationSuggestion[]
}

const demoStations: StationSuggestion[] = [
  { id: 1, name: 'Wrocław Główny', slug: 'wroclaw-glowny' },
  { id: 2, name: 'Wrocław Mikołajów', slug: 'wroclaw-mikolajow' },
  { id: 3, name: 'Wrocław Nadodrze', slug: 'wroclaw-nadodrze' },
  { id: 4, name: 'Olsztyn Główny', slug: 'olsztyn-glowny' },
  { id: 5, name: 'Warszawa Centralna', slug: 'warszawa-centralna' },
  { id: 6, name: 'Kraków Główny', slug: 'krakow-glowny' },
]

export class StationSearchError extends Error {}

export default class StationSearchService {
  readonly minimumQueryLength = env.get('STATION_SEARCH_MIN_LENGTH') ?? 2
  readonly resultLimit = env.get('STATION_SEARCH_RESULT_LIMIT') ?? 8
  private static cache = new Map<string, CacheEntry>()

  constructor(private readonly requestedProvider?: PriceProviderName) {}

  async search(rawQuery: string): Promise<StationSuggestion[]> {
    const query = rawQuery.trim().slice(0, 80)
    if (query.length < this.minimumQueryLength) {
      return []
    }

    const provider = resolvePriceProvider(this.requestedProvider)
    const cacheKey = `${provider}:${this.normalize(query)}`
    const cached = StationSearchService.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.stations
    }

    const stations =
      provider === 'koleo'
        ? await this.searchKoleo(query)
        : provider === 'cd'
          ? await new CdPublicService().stations(query, this.resultLimit)
          : this.searchDemo(query)

    const cacheSeconds = Math.max(1, env.get('STATION_SEARCH_CACHE_SECONDS') ?? 300)
    StationSearchService.cache.set(cacheKey, {
      expiresAt: Date.now() + cacheSeconds * 1_000,
      stations,
    })

    if (StationSearchService.cache.size > 100) {
      const oldestKey = StationSearchService.cache.keys().next().value
      if (oldestKey) {
        StationSearchService.cache.delete(oldestKey)
      }
    }

    return stations
  }

  private searchDemo(query: string) {
    const normalizedQuery = this.normalize(query)
    return demoStations
      .filter((station) => this.normalize(station.name).includes(normalizedQuery))
      .slice(0, this.resultLimit)
  }

  private async searchKoleo(query: string) {
    const response = await createKoleoClient().stations.findStationsByName(query)
    if (!Array.isArray(response) && response.error) {
      throw new StationSearchError('Nie udało się pobrać listy stacji.')
    }

    const rows = Array.isArray(response)
      ? response
      : ((response as KoleoStationSearch).stations ?? [])

    return rows.slice(0, this.resultLimit).map((station: KoleoStation) => ({
      id: station.id,
      name: station.localised_name || station.name,
      slug: station.name_slug ?? null,
    }))
  }

  private normalize(value: string) {
    return value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pl-PL')
      .replaceAll('ł', 'l')
  }
}
