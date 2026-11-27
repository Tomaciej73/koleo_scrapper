import ConnectionSearchService, {
  ConnectionSearchError,
  resolvePriceProvider,
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
import SecurityEventService from '#services/security_event_service'
import NbpExchangeRateService from '#services/nbp_exchange_rate_service'
import SmsGatewayService from '#services/sms_gateway_service'

export default class SearchController {
  async index({ view, auth }: HttpContext) {
    return view.render('pages/dashboard', {
      smsEnabled: SmsGatewayService.configured(),
      phoneVerified: Boolean(auth.user?.phoneNumber && auth.user?.phoneVerifiedAt),
      czkRate: null,
      defaultDate: this.defaultDate(),
      providerMode: env.get('PRICE_PROVIDER') ?? 'demo',
      koleoEnabled: (env.get('PRICE_PROVIDER') ?? 'demo') === 'koleo',
      cdEnabled: env.get('CD_ENABLED') ?? false,
      alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
      stationSearchMinLength: env.get('STATION_SEARCH_MIN_LENGTH') ?? 2,
      defaultCheckInterval: env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15,
      minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
      maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
    })
  }

  async search({ request, auth, view, logger }: HttpContext) {
    const payload = await request.validateUsing(connectionSearchValidator)
    const searchInput: ConnectionSearchInput = {
      provider: payload.provider,
      origin: payload.origin,
      originStationId: payload.originStationId,
      destination: payload.destination,
      destinationStationId: payload.destinationStationId,
      travelDate: payload.travelDate,
      departureTime: payload.departureTime,
      onlyDirect: payload.onlyDirect ?? false,
    }
    let provider
    try {
      provider = resolvePriceProvider(payload.provider)
    } catch (error) {
      return view.render('pages/dashboard', {
        smsEnabled: SmsGatewayService.configured(),
        phoneVerified: Boolean(auth.user?.phoneNumber && auth.user?.phoneVerifiedAt),
        czkRate: null,
        defaultDate: this.defaultDate(),
        providerMode: env.get('PRICE_PROVIDER') ?? 'demo',
        koleoEnabled: (env.get('PRICE_PROVIDER') ?? 'demo') === 'koleo',
        cdEnabled: env.get('CD_ENABLED') ?? false,
        alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
        stationSearchMinLength: env.get('STATION_SEARCH_MIN_LENGTH') ?? 2,
        defaultCheckInterval: env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15,
        minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
        maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
        search: searchInput,
        searchError:
          error instanceof ConnectionSearchError ? error.message : 'Nieznane źródło cen.',
      })
    }
    searchInput.provider = provider
    const service = new ConnectionSearchService(provider)
    const startedAt = performance.now()
    const user = auth.user!
    const includePersonalData = env.get('AUDIT_LOG_PERSONAL_DATA') ?? false
    const emailForLog = SecurityEventService.emailForLog(user.email, includePersonalData)
    const journeyForLog = SecurityEventService.journeyForLog(searchInput, includePersonalData)
    const searchDescription = `użytkownik #${user.id} (${emailForLog}); ${journeyForLog}`
    const logContext = {
      userId: user.id,
      emailHash: SecurityEventService.emailHash(user.email),
      ...(includePersonalData
        ? {
            email: emailForLog,
            origin: SecurityEventService.safeText(searchInput.origin, 120),
            destination: SecurityEventService.safeText(searchInput.destination, 120),
          }
        : {}),
      ...SecurityEventService.requestContext(request),
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
      `Rozpoczęto wyszukiwanie połączeń: ${searchDescription}`
    )

    try {
      await new JourneyValidationService().validate(searchInput)
      const results = await service.search(searchInput)
      const czkRate =
        provider === 'cd' && results.some((row) => row.priceCents !== null)
          ? await new NbpExchangeRateService().getCzkRate()
          : null
      const resultContext = {
        event: results.length === 0 ? 'connection_search_empty' : 'connection_search_succeeded',
        ...logContext,
        resultCount: results.length,
        durationMs: Math.round(performance.now() - startedAt),
      }
      if (results.length === 0) {
        logger.warn(
          resultContext,
          `Nie znaleziono połączeń: ${searchDescription}; ${resultContext.durationMs} ms`
        )
      } else {
        logger.info(
          resultContext,
          `Zakończono wyszukiwanie: ${searchDescription}; ${results.length} połączeń, ${resultContext.durationMs} ms`
        )
      }

      return view.render('pages/dashboard', {
        smsEnabled: SmsGatewayService.configured(),
        phoneVerified: Boolean(auth.user?.phoneNumber && auth.user?.phoneVerifiedAt),
        defaultDate: this.defaultDate(),
        providerMode: service.provider,
        koleoEnabled: (env.get('PRICE_PROVIDER') ?? 'demo') === 'koleo',
        cdEnabled: env.get('CD_ENABLED') ?? false,
        alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
        stationSearchMinLength: env.get('STATION_SEARCH_MIN_LENGTH') ?? 2,
        defaultCheckInterval: env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15,
        minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
        maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
        search: searchInput,
        results,
        czkRate,
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
        logger.warn(
          { ...errorContext, err: error },
          `Wyszukiwanie połączeń nie powiodło się: ${searchDescription}; kod: ${errorContext.errorCode}; ${message}`
        )
      } else {
        logger.error(
          { ...errorContext, err: error },
          `Nieoczekiwany błąd wyszukiwania połączeń: ${searchDescription}; kod: ${errorContext.errorCode}`
        )
      }

      return view.render('pages/dashboard', {
        smsEnabled: SmsGatewayService.configured(),
        phoneVerified: Boolean(auth.user?.phoneNumber && auth.user?.phoneVerifiedAt),
        czkRate: null,
        defaultDate: this.defaultDate(),
        providerMode: service.provider,
        koleoEnabled: (env.get('PRICE_PROVIDER') ?? 'demo') === 'koleo',
        cdEnabled: env.get('CD_ENABLED') ?? false,
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
