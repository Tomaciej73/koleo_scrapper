import ConnectionSearchService, {
  ConnectionSearchError,
  type ConnectionSearchInput,
} from '#services/connection_search_service'
import JourneyValidationService, {
  JourneyValidationError,
} from '#services/journey_validation_service'
import { KoleoCircuitOpenError } from '#services/koleo_circuit_breaker_service'
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

  async search({ request, view, logger }: HttpContext) {
    const payload = await request.validateUsing(connectionSearchValidator)
    const searchInput: ConnectionSearchInput = {
      origin: payload.origin,
      originStationId: payload.originStationId,
      destination: payload.destination,
      destinationStationId: payload.destinationStationId,
      travelDate: payload.travelDate,
      departureTime: payload.departureTime,
      onlyDirect: payload.onlyDirect ?? false,
    }
    const service = new ConnectionSearchService()
    const startedAt = performance.now()
    const logContext = {
      provider: service.provider,
      originStationId: searchInput.originStationId,
      destinationStationId: searchInput.destinationStationId,
      travelDate: searchInput.travelDate,
      departureTime: searchInput.departureTime ?? null,
      onlyDirect: searchInput.onlyDirect,
    }

    logger.info(
      {
        event: 'connection_search_started',
        ...logContext,
      },
      'Rozpoczęto wyszukiwanie połączeń'
    )

    try {
      await new JourneyValidationService().validate(searchInput)
      const results = await service.search(searchInput)
      const resultContext = {
        event: results.length === 0 ? 'connection_search_empty' : 'connection_search_succeeded',
        ...logContext,
        resultCount: results.length,
        durationMs: Math.round(performance.now() - startedAt),
      }
      if (results.length === 0) {
        logger.warn(
          resultContext,
          'KOLEO nie zwróciło połączeń dla wybranych parametrów wyszukiwania'
        )
      } else {
        logger.info(resultContext, 'Zakończono wyszukiwanie połączeń')
      }

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
      const isExpectedError =
        error instanceof ConnectionSearchError ||
        error instanceof JourneyValidationError ||
        error instanceof KoleoCircuitOpenError
      const message = isExpectedError
        ? error.message
        : 'Nie udało się pobrać połączeń. Spróbuj ponownie później.'
      const errorContext = {
        event: 'connection_search_failed',
        ...logContext,
        errorCode:
          error instanceof ConnectionSearchError
            ? error.code
            : error instanceof JourneyValidationError
              ? 'journeyValidationFailed'
              : error instanceof KoleoCircuitOpenError
                ? 'koleoCircuitOpen'
                : 'unexpectedSearchFailure',
        durationMs: Math.round(performance.now() - startedAt),
      }

      if (isExpectedError) {
        logger.warn({ ...errorContext, err: error }, 'Wyszukiwanie połączeń nie powiodło się')
      } else {
        logger.error({ ...errorContext, err: error }, 'Nieoczekiwany błąd wyszukiwania połączeń')
      }

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
