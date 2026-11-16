import ConnectionSearchService, {
  ConnectionSearchError,
  type ConnectionSearchInput,
} from '#services/connection_search_service'
import env from '#start/env'
import { connectionSearchValidator } from '#validators/connections'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class SearchController {
  async index({ view }: HttpContext) {
    return view.render('pages/dashboard', {
      defaultDate: this.defaultDate(),
      providerMode: env.get('PRICE_PROVIDER') ?? 'demo',
      alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
      stationSearchMinLength: env.get('STATION_SEARCH_MIN_LENGTH') ?? 2,
      defaultCheckInterval: env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15,
      minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
      maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
    })
  }

  async search({ request, view }: HttpContext) {
    const payload = await request.validateUsing(connectionSearchValidator)
    const searchInput: ConnectionSearchInput = {
      origin: payload.origin,
      destination: payload.destination,
      travelDate: payload.travelDate,
      departureTime: payload.departureTime,
      onlyDirect: payload.onlyDirect ?? false,
    }
    const service = new ConnectionSearchService()

    try {
      const results = await service.search(searchInput)
      return view.render('pages/dashboard', {
        defaultDate: this.defaultDate(),
        providerMode: service.provider,
        alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
        stationSearchMinLength: env.get('STATION_SEARCH_MIN_LENGTH') ?? 2,
        defaultCheckInterval: env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15,
        minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
        maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
        search: searchInput,
        results,
      })
    } catch (error) {
      const message =
        error instanceof ConnectionSearchError
          ? error.message
          : 'Nie udało się pobrać połączeń. Spróbuj ponownie później.'

      return view.render('pages/dashboard', {
        defaultDate: this.defaultDate(),
        providerMode: service.provider,
        alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
        stationSearchMinLength: env.get('STATION_SEARCH_MIN_LENGTH') ?? 2,
        defaultCheckInterval: env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15,
        minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
        maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
        search: searchInput,
        searchError: message,
      })
    }
  }

  private defaultDate() {
    return DateTime.now()
      .setZone(env.get('APP_TIMEZONE') ?? 'Europe/Warsaw')
      .plus({ days: 1 })
      .toISODate()
  }
}
