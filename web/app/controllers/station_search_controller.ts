import StationSearchService, { StationSearchError } from '#services/station_search_service'
import { resolvePriceProvider, type PriceProviderName } from '#services/connection_search_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class StationSearchController {
  async index({ request, response }: HttpContext) {
    const query = String(request.input('q', ''))
    try {
      const provider = resolvePriceProvider(
        String(request.input('provider', '')) as PriceProviderName
      )
      const service = new StationSearchService(provider)
      return response.ok({ stations: await service.search(query) })
    } catch (error) {
      const message =
        error instanceof StationSearchError
          ? error.message
          : 'Wyszukiwanie stacji jest chwilowo niedostępne.'

      return response.serviceUnavailable({ stations: [], message })
    }
  }
}
