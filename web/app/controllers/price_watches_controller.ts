import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
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
import { DateTime } from 'luxon'

export default class PriceWatchesController {
  async index({ auth, view }: HttpContext) {
    const watches = await PriceWatch.query()
      .where('userId', auth.user!.id)
      .orderBy('status', 'asc')
      .orderBy('travelDate', 'asc')
      .orderBy('departureTime', 'asc')

    const observations = watches.length
      ? await PriceObservation.query()
          .whereIn(
            'priceWatchId',
            watches.map((watch) => watch.id)
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
    const watchItems = watches.map((watch) => {
      const storedHistory = (observationsByWatch.get(watch.id) ?? []).slice(-historyLimit)
      const priceHistory = storedHistory.map((observation) => ({
        priceCents: observation.priceCents,
        observedAt: observation.observedAt,
      }))

      if (!priceHistory.length && watch.lastPriceCents !== null) {
        priceHistory.push({
          priceCents: watch.lastPriceCents,
          observedAt: watch.lastCheckedAt ?? watch.createdAt,
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
        maskedDestination: this.maskDestination(
          watch.notificationDestination,
          watch.notificationChannel
        ),
        targetPriceValue:
          watch.targetPriceCents === null ? '0' : (watch.targetPriceCents / 100).toFixed(2),
        priceHistory: [...priceHistory].reverse().slice(0, 8),
        chartDots,
        chartPoints: chartDots.map((point) => `${point.x},${point.y}`).join(' '),
        minimumPrice,
        maximumPrice,
      }
    })

    return view.render('pages/price_watches/index', {
      watchItems,
      providerMode: env.get('PRICE_PROVIDER') ?? 'demo',
      alertsEnabled: env.get('ALERTS_ENABLED') ?? false,
      mailEnabled: env.get('MAIL_ENABLED') ?? false,
      minimumCheckInterval: env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5,
      maximumCheckInterval: env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440,
      appTimezone: env.get('APP_TIMEZONE') ?? 'Europe/Warsaw',
    })
  }

  async store({ auth, request, response, session }: HttpContext) {
    const payload = await request.validateUsing(priceWatchValidator)
    try {
      await new JourneyValidationService().validate(payload)
    } catch (error) {
      session.flash(
        'error',
        error instanceof JourneyValidationError
          ? error.message
          : 'Nie udało się zweryfikować wybranych stacji.'
      )
      return response.redirect().back()
    }
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    const travelDate = DateTime.fromISO(payload.travelDate, { zone: timezone })
    const arrivalDate = payload.arrivalDate
      ? DateTime.fromISO(payload.arrivalDate, { zone: timezone })
      : null
    const checkIntervalMinutes = this.normalizeCheckInterval(payload.checkIntervalMinutes)

    if (!travelDate.isValid || (arrivalDate && !arrivalDate.isValid)) {
      session.flash('error', 'Nieprawidłowa data podróży.')
      return response.redirect().back()
    }

    const existing = await PriceWatch.query()
      .where('userId', auth.user!.id)
      .where('origin', payload.origin)
      .where('destination', payload.destination)
      .where('travelDate', travelDate.toISODate()!)
      .where('departureTime', payload.departureTime)
      .first()

    const attributes = {
      originStationId: payload.originStationId,
      destinationStationId: payload.destinationStationId,
      arrivalTime: payload.arrivalTime ?? null,
      arrivalDate,
      connectionUuid: payload.connectionUuid ?? null,
      trainName: payload.trainName ?? null,
      baselinePriceCents: payload.priceCents ?? null,
      lastPriceCents: payload.priceCents ?? null,
      lowestPriceCents: payload.priceCents ?? null,
      targetPriceCents: payload.targetPrice ? Math.round(payload.targetPrice * 100) : null,
      notificationChannel: payload.notificationChannel,
      notificationDestination: payload.notificationDestination,
      checkIntervalMinutes,
      nextCheckAt: DateTime.utc(),
      lastNotifiedAt: null,
      lastNotifiedPriceCents: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      status: 'active',
    }

    let watch: PriceWatch
    if (existing) {
      existing.merge(attributes)
      await existing.save()
      watch = existing
      session.flash('success', 'Zaktualizowano obserwację tego połączenia.')
    } else {
      watch = await PriceWatch.create({
        userId: auth.user!.id,
        origin: payload.origin,
        destination: payload.destination,
        travelDate,
        departureTime: payload.departureTime,
        ...attributes,
      })
      session.flash('success', 'Połączenie dodano do obserwowanych.')
    }

    if (payload.priceCents !== undefined) {
      await PriceObservation.create({
        priceWatchId: watch.id,
        priceCents: payload.priceCents,
        observedAt: DateTime.utc(),
      })
    }

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

    watch.targetPriceCents =
      payload.targetPrice === 0 ? null : Math.round(payload.targetPrice * 100)
    watch.checkIntervalMinutes = this.normalizeCheckInterval(payload.checkIntervalMinutes)
    if (watch.status === 'active') {
      watch.nextCheckAt = DateTime.utc()
    }
    await watch.save()

    session.flash('success', 'Ustawienia obserwacji zostały zapisane.')
    return response.redirect().toRoute('price_watches.index')
  }

  async updateStatus({ auth, params, request, response, session }: HttpContext) {
    const payload = await request.validateUsing(priceWatchStatusValidator)
    const watch = await PriceWatch.query()
      .where('id', params.id)
      .where('userId', auth.user!.id)
      .firstOrFail()

    if (watch.status === 'expired') {
      session.flash('error', 'Nie można wznowić obserwacji po odjeździe pociągu.')
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

  async checkNow({ auth, response, session }: HttpContext) {
    if (!(env.get('ALERTS_ENABLED') ?? false)) {
      session.flash(
        'error',
        'Automatyczne sprawdzanie jest wyłączone. Włącz je dopiero po skonfigurowaniu uprawnionego dostępu.'
      )
      return response.redirect().toRoute('price_watches.index')
    }

    const summary = await new PriceAlertService().checkForUser(auth.user!.id)
    session.flash(
      'success',
      `Sprawdzono ${summary.checked} obserwacji. Spadki: ${summary.priceDrops}, wysłane alerty: ${summary.delivered}.`
    )
    return response.redirect().toRoute('price_watches.index')
  }

  private normalizeCheckInterval(value?: number) {
    const minimum = Math.max(1, env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5)
    const maximum = Math.max(minimum, env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440)
    const defaultInterval = env.get('ALERT_CHECK_INTERVAL_MINUTES') ?? 15
    return Math.min(maximum, Math.max(minimum, value ?? defaultInterval))
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
