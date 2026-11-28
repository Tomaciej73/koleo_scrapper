import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import User from '#models/user'
import PriceAlertService from '#services/price_alert_service'
import JourneyValidationService, {
  JourneyValidationError,
} from '#services/journey_validation_service'
import env from '#start/env'
import {
  priceWatchIntervalValidator,
  priceWatchSettingsValidator,
  priceWatchStatusValidator,
  priceWatchValidator,
} from '#validators/connections'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import ConnectionSearchService, {
  ConnectionSearchError,
  resolvePriceProvider,
  type ConnectionResult,
} from '#services/connection_search_service'
import NbpExchangeRateService from '#services/nbp_exchange_rate_service'
import {
  czkToPlnCents,
  formatPrice,
  formatPriceWithConversion,
} from '#services/price_format_service'
import SmsGatewayService from '#services/sms_gateway_service'

export default class PriceWatchesController {
  async index({ auth, request, view }: HttpContext) {
    const user = auth.getUserOrFail()
    const watches = await PriceWatch.query()
      .where('userId', auth.user!.id)
      .orderBy('status', 'asc')
      .orderBy('travelDate', 'asc')
      .orderBy('departureTime', 'asc')
    const requestedStatus = request.input('status')
    const selectedStatus =
      typeof requestedStatus === 'string' &&
      ['active', 'paused', 'connection_missing', 'expired'].includes(requestedStatus)
        ? requestedStatus
        : 'all'
    const watchFilters = [
      { status: 'all', label: 'Wszystkie', icon: 'lucide:layout-list', count: watches.length },
      {
        status: 'active',
        label: 'Aktywne',
        icon: 'lucide:bell-ring',
        count: watches.filter((watch) => watch.status === 'active').length,
      },
      {
        status: 'paused',
        label: 'Wstrzymane',
        icon: 'lucide:pause-circle',
        count: watches.filter((watch) => watch.status === 'paused').length,
      },
      {
        status: 'connection_missing',
        label: 'Nieodnalezione',
        icon: 'lucide:triangle-alert',
        count: watches.filter((watch) => watch.status === 'connection_missing').length,
      },
      {
        status: 'expired',
        label: 'Zakończone',
        icon: 'lucide:calendar-check',
        count: watches.filter((watch) => watch.status === 'expired').length,
      },
    ]
    const visibleWatches =
      selectedStatus === 'all'
        ? watches
        : watches.filter((watch) => watch.status === selectedStatus)
    const czkRate = visibleWatches.some((watch) => watch.provider === 'cd')
      ? await new NbpExchangeRateService().getCzkRate()
      : null

    const observations = visibleWatches.length
      ? await PriceObservation.query()
          .whereIn(
            'priceWatchId',
            visibleWatches.map((watch) => watch.id)
          )
          .orderBy('observedAt', 'asc')
      : []
    const observationsByWatch = new Map<number, PriceObservation[]>()
    for (const observation of observations) {
      const history = observationsByWatch.get(observation.priceWatchId) ?? []
      history.push(observation)
      observationsByWatch.set(observation.priceWatchId, history)
    }

    const historyLimit = Math.max(2, env.get('PRICE_HISTORY_DISPLAY_LIMIT') ?? 30)
    const watchItems = visibleWatches.map((watch) => {
      const legacyCzkTarget =
        watch.provider === 'cd' &&
        watch.targetPriceCurrency === 'CZK' &&
        watch.targetPriceCents !== null
      const targetPricePlnCents = legacyCzkTarget
        ? czkRate && watch.targetPriceCents !== null
          ? czkToPlnCents(watch.targetPriceCents, czkRate)
          : null
        : watch.targetPriceCents
      const storedHistory = (observationsByWatch.get(watch.id) ?? []).slice(-historyLimit)
      const priceHistory = storedHistory.map((observation) => ({
        priceCents: observation.priceCents,
        observedAt: observation.observedAt,
        nbpRate:
          observation.nbpRateMid && observation.nbpEffectiveDate && observation.nbpTableNumber
            ? {
                mid: Number(observation.nbpRateMid),
                effectiveDate: observation.nbpEffectiveDate,
                tableNumber: observation.nbpTableNumber,
              }
            : null,
        comparedPriceCents: observation.comparedPriceCents,
        targetPriceCents: observation.targetPriceCents,
        targetPriceCurrency: observation.targetPriceCurrency,
        targetMet: observation.targetMet === null ? null : Boolean(observation.targetMet),
      }))

      if (!priceHistory.length && watch.lastPriceCents !== null) {
        priceHistory.push({
          priceCents: watch.lastPriceCents,
          observedAt: watch.lastCheckedAt ?? watch.createdAt,
          nbpRate: null,
          comparedPriceCents: null,
          targetPriceCents: null,
          targetPriceCurrency: null,
          targetMet: null,
        })
      }

      const prices = priceHistory.map((entry) => entry.priceCents)
      const minimumPrice = prices.length ? Math.min(...prices) : null
      const maximumPrice = prices.length ? Math.max(...prices) : null
      const chartDots = priceHistory.map((entry, index) => {
        const x = priceHistory.length === 1 ? 50 : (index / (priceHistory.length - 1)) * 100
        const priceRange = (maximumPrice ?? 0) - (minimumPrice ?? 0)
        const y =
          priceRange === 0 ? 20 : 34 - ((entry.priceCents - minimumPrice!) / priceRange) * 28
        return {
          x: x.toFixed(2),
          y: y.toFixed(2),
          priceCents: entry.priceCents,
          observedAt: entry.observedAt,
          nbpRate: entry.nbpRate,
        }
      })
      const inferredArrivalOffset =
        watch.arrivalTime && watch.arrivalTime < watch.departureTime ? 1 : 0
      const arrivalDate =
        watch.arrivalDate ?? watch.travelDate.plus({ days: inferredArrivalOffset })
      const arrivalDayOffset = Math.max(
        0,
        Math.round(arrivalDate.startOf('day').diff(watch.travelDate.startOf('day'), 'days').days)
      )

      return {
        watch,
        arrivalDate,
        arrivalDayOffset,
        maskedDestination: [
          watch.notificationChannel !== 'sms' ? this.maskDestination(user.email, 'email') : null,
          watch.notificationChannel !== 'email' && user.phoneNumber
            ? this.maskDestination(user.phoneNumber, 'sms')
            : null,
        ]
          .filter(Boolean)
          .join(' + '),
        targetPriceValue:
          watch.targetPriceCents === null
            ? '0'
            : targetPricePlnCents === null
              ? ''
              : (targetPricePlnCents / 100).toFixed(2),
        targetPriceLabel:
          watch.targetPriceCents === null
            ? 'każda zmiana'
            : legacyCzkTarget
              ? `każda zmiana + dotychczasowy próg ≤ ${formatPriceWithConversion(watch.targetPriceCents, 'cd', czkRate)}`
              : `każda zmiana + próg ≤ ${formatPrice(watch.targetPriceCents, 'koleo')}`,
        legacyCzkTarget: legacyCzkTarget ? formatPrice(watch.targetPriceCents, 'cd') : null,
        priceHistory: [...priceHistory].reverse().slice(0, 8),
        chartDots,
        chartPoints: chartDots.map((point) => `${point.x},${point.y}`).join(' '),
        minimumPrice,
        maximumPrice,
      }
    })

    return view.render('pages/price_watches/index', {
      watchItems,
      watchFilters,
      selectedStatus,
      totalWatches: watches.length,
      providerMode: env.get('PRICE_PROVIDER') ?? 'demo',
      cdEnabled: env.get('CD_ENABLED') ?? false,
      alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
      mailEnabled: env.get('MAIL_ENABLED') ?? false,
      smsEnabled: SmsGatewayService.configured(),
      phoneVerified: Boolean(user.phoneNumber && user.phoneVerifiedAt),
      minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
      maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
      appTimezone: env.get('APP_TIMEZONE') ?? 'Europe/Warsaw',
      czkRate,
    })
  }

  async store({ auth, request, response, session }: HttpContext) {
    const payload = await request.validateUsing(priceWatchValidator)
    const notificationChannel = payload.notificationChannel ?? 'email'
    if (notificationChannel !== 'email' && !this.smsAvailable(auth.user!)) {
      session.flash(
        'error',
        'Najpierw potwierdź numer telefonu w ustawieniach konta i skonfiguruj bramkę SMS.'
      )
      return response.redirect().back()
    }
    let provider
    try {
      provider = resolvePriceProvider(payload.provider)
      await new JourneyValidationService().validate({ ...payload, provider })
    } catch (error) {
      session.flash(
        'error',
        error instanceof JourneyValidationError || error instanceof ConnectionSearchError
          ? error.message
          : 'Nie udało się zweryfikować wybranych stacji.'
      )
      return response.redirect().back()
    }
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    const travelDate = DateTime.fromISO(payload.travelDate, { zone: timezone })
    let verifiedConnection: ConnectionResult | null = null
    if (provider === 'cd') {
      try {
        const result = await new ConnectionSearchService(provider).searchForWatch(
          {
            provider,
            origin: payload.origin,
            originStationId: payload.originStationId,
            destination: payload.destination,
            destinationStationId: payload.destinationStationId,
            travelDate: payload.travelDate,
            departureTime: payload.departureTime,
            onlyDirect: false,
          },
          (connections) => connections.find((row) => row.uuid === payload.connectionUuid)?.uuid
        )
        verifiedConnection = result.connection
        if (!verifiedConnection) {
          session.flash('error', 'Nie znaleziono wybranego kursu ČD. Wyszukaj go ponownie.')
          return response.redirect().back()
        }
      } catch (error) {
        session.flash(
          'error',
          error instanceof ConnectionSearchError
            ? error.message
            : 'Nie udało się sprawdzić kursu ČD.'
        )
        return response.redirect().back()
      }
    }
    const arrivalDateValue = verifiedConnection?.arrivalDate ?? payload.arrivalDate
    const arrivalDate = arrivalDateValue
      ? DateTime.fromISO(arrivalDateValue, { zone: timezone })
      : null
    const priceCents =
      provider === 'cd' ? verifiedConnection!.priceCents : (payload.priceCents ?? null)
    const checkIntervalMinutes = this.normalizeCheckInterval(payload.checkIntervalMinutes)

    if (!travelDate.isValid || (arrivalDate && !arrivalDate.isValid)) {
      session.flash('error', 'Nieprawidłowa data podróży.')
      return response.redirect().back()
    }

    const attributes = {
      provider,
      originStationId: payload.originStationId,
      destinationStationId: payload.destinationStationId,
      arrivalTime: verifiedConnection?.arrival ?? payload.arrivalTime ?? null,
      arrivalDate,
      connectionUuid: verifiedConnection?.uuid ?? payload.connectionUuid ?? null,
      trainName: verifiedConnection?.trains ?? payload.trainName ?? null,
      baselinePriceCents: priceCents,
      lastPriceCents: priceCents,
      lowestPriceCents: priceCents,
      targetPriceCents: payload.targetPrice ? Math.round(payload.targetPrice * 100) : null,
      targetPriceCurrency: 'PLN',
      notificationChannel,
      notificationDestination: auth.user!.email,
      checkIntervalMinutes,
      nextCheckAt: DateTime.utc(),
      lastNotifiedAt: null,
      lastNotifiedPriceCents: null,
      lastTargetMet: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      connectionMissCount: 0,
      lastTicketAvailability:
        verifiedConnection?.ticketAvailability ?? payload.ticketAvailability ?? 'unknown',
      lastAvailabilityMessage:
        verifiedConnection?.availabilityMessage ?? payload.availabilityMessage ?? null,
      status: 'active',
    }

    const result = await db.transaction(async (trx) => {
      await User.query({ client: trx }).where('id', auth.user!.id).forUpdate().firstOrFail()
      const existing = await PriceWatch.query({ client: trx })
        .where('userId', auth.user!.id)
        .where('provider', provider)
        .where('origin', payload.origin)
        .where('destination', payload.destination)
        .where('travelDate', travelDate.toISODate()!)
        .where('departureTime', payload.departureTime)
        .first()

      if (!existing) {
        const watchCount = await PriceWatch.query({ client: trx })
          .where('userId', auth.user!.id)
          .count('* as total')
          .firstOrFail()
          .then((row) => Number(row.$extras.total))
        if (watchCount >= env.get('PRICE_WATCH_MAX_PER_USER')) {
          return { watch: null, updated: false }
        }
      }

      const storedPrice = existing?.lastPriceCents ?? null
      let watch: PriceWatch
      if (existing) {
        existing.merge(attributes)
        await existing.save()
        watch = existing
      } else {
        watch = await PriceWatch.create(
          {
            userId: auth.user!.id,
            origin: payload.origin,
            destination: payload.destination,
            travelDate,
            departureTime: payload.departureTime,
            ...attributes,
          },
          { client: trx }
        )
      }

      if (priceCents !== null && storedPrice !== priceCents) {
        await PriceObservation.create(
          {
            priceWatchId: watch.id,
            priceCents,
            observedAt: DateTime.utc(),
          },
          { client: trx }
        )
      }

      return { watch, updated: Boolean(existing) }
    })

    if (!result.watch) {
      session.flash(
        'error',
        `Osiągnięto limit ${env.get('PRICE_WATCH_MAX_PER_USER')} obserwowanych połączeń.`
      )
      return response.redirect().back()
    }

    session.flash(
      'success',
      result.updated
        ? 'Zaktualizowano obserwację tego połączenia.'
        : 'Połączenie dodano do obserwowanych.'
    )

    return response.redirect().toRoute('price_watches.index')
  }

  async updateInterval({ auth, params, request, response, session }: HttpContext) {
    const payload = await request.validateUsing(priceWatchIntervalValidator)
    const watch = await PriceWatch.query()
      .where('id', params.id)
      .where('userId', auth.user!.id)
      .firstOrFail()

    watch.checkIntervalMinutes = this.normalizeCheckInterval(payload.checkIntervalMinutes)
    watch.nextCheckAt = DateTime.utc()
    await watch.save()

    session.flash(
      'success',
      `Częstotliwość sprawdzania ustawiono na ${watch.checkIntervalMinutes} min.`
    )
    return response.redirect().toRoute('price_watches.index')
  }

  async updateSettings({ auth, params, request, response, session }: HttpContext) {
    const payload = await request.validateUsing(priceWatchSettingsValidator)
    const watch = await PriceWatch.query()
      .where('id', params.id)
      .where('userId', auth.user!.id)
      .firstOrFail()
    const notificationChannel = payload.notificationChannel ?? watch.notificationChannel
    if (
      notificationChannel !== 'email' &&
      notificationChannel !== watch.notificationChannel &&
      !this.smsAvailable(auth.user!)
    ) {
      session.flash(
        'error',
        'Najpierw potwierdź numer telefonu w ustawieniach konta i skonfiguruj bramkę SMS.'
      )
      return response.redirect().back()
    }

    const targetPriceCents =
      payload.targetPrice === 0 ? null : Math.round(payload.targetPrice * 100)
    if (watch.targetPriceCents !== targetPriceCents || watch.targetPriceCurrency !== 'PLN') {
      watch.lastTargetMet = targetPriceCents === null ? null : false
    }
    watch.targetPriceCents = targetPriceCents
    watch.targetPriceCurrency = 'PLN'
    watch.notificationChannel = notificationChannel
    watch.checkIntervalMinutes = this.normalizeCheckInterval(payload.checkIntervalMinutes)
    if (watch.status === 'active') {
      watch.nextCheckAt = DateTime.utc()
    }
    await watch.save()
    const excludedChannel =
      notificationChannel === 'email' ? 'sms' : notificationChannel === 'sms' ? 'email' : null
    if (excludedChannel) {
      await db
        .from('alert_outbox')
        .where('price_watch_id', watch.id)
        .where('channel', excludedChannel)
        .whereIn('status', ['pending', 'retry'])
        .update({ status: 'failed', last_error: 'Kanał powiadomień został zmieniony.' })
    }

    session.flash('success', 'Ustawienia obserwacji zostały zapisane.')
    return response.redirect().toRoute('price_watches.index')
  }

  async updateStatus({ auth, params, request, response, session }: HttpContext) {
    const payload = await request.validateUsing(priceWatchStatusValidator)
    const watch = await PriceWatch.query()
      .where('id', params.id)
      .where('userId', auth.user!.id)
      .firstOrFail()

    if (!['active', 'paused'].includes(watch.status)) {
      session.flash(
        'error',
        watch.status === 'connection_missing'
          ? 'Nie można wznowić obserwacji bez dokładnie dopasowanego połączenia. Dodaj ją ponownie.'
          : 'Nie można wznowić obserwacji po odjeździe pociągu.'
      )
      return response.redirect().toRoute('price_watches.index')
    }

    watch.status = payload.status
    watch.nextCheckAt = payload.status === 'active' ? DateTime.utc() : null
    await watch.save()

    session.flash(
      'success',
      payload.status === 'active'
        ? 'Obserwacja została wznowiona.'
        : 'Obserwacja została wstrzymana.'
    )
    return response.redirect().toRoute('price_watches.index')
  }

  async destroy({ auth, params, response, session }: HttpContext) {
    const watch = await PriceWatch.query()
      .where('id', params.id)
      .where('userId', auth.user!.id)
      .firstOrFail()

    await watch.delete()
    session.flash('success', 'Obserwacja została usunięta.')
    return response.redirect().toRoute('price_watches.index')
  }

  async checkNow({ auth, response, session, logger }: HttpContext) {
    if (!(env.get('ALERTS_ENABLED') ?? false)) {
      session.flash(
        'error',
        'Automatyczne sprawdzanie jest wyłączone. Włącz je dopiero po skonfigurowaniu uprawnionego dostępu.'
      )
      return response.redirect().toRoute('price_watches.index')
    }

    const summary = await new PriceAlertService().checkForUser(auth.user!.id)
    logger.info(
      { event: 'manual_price_check_completed', userId: auth.user!.id, ...summary },
      'Zakończono ręczne sprawdzanie obserwowanych cen'
    )
    session.flash(
      'success',
      `Sprawdzono ${summary.checked} obserwacji. Zmiany: ${summary.priceChanges} (spadki: ${summary.priceDrops}, wzrosty: ${summary.priceIncreases}), bez zmian: ${summary.unchanged}, alerty w kolejce: ${summary.alertsQueued}, wysłane: ${summary.delivered}, błędy: ${summary.errors}.`
    )
    return response.redirect().toRoute('price_watches.index')
  }

  private normalizeCheckInterval(value?: number) {
    const minimum = Math.max(1, env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5)
    const maximum = Math.max(minimum, env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440)
    const defaultInterval = env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15
    return Math.min(maximum, Math.max(minimum, value ?? defaultInterval))
  }

  private smsAvailable(user: User) {
    return SmsGatewayService.configured() && Boolean(user.phoneNumber && user.phoneVerifiedAt)
  }

  private maskDestination(destination: string, channel: string) {
    if (channel === 'email') {
      const [localPart, domain] = destination.split('@')
      if (!localPart || !domain) {
        return '••••••'
      }

      const visible = localPart.slice(0, Math.min(2, localPart.length))
      return `${visible}${'•'.repeat(Math.max(3, localPart.length - visible.length))}@${domain}`
    }

    const visibleSuffix = destination.slice(-3)
    return `${'•'.repeat(Math.max(4, destination.length - visibleSuffix.length))}${visibleSuffix}`
  }
}
