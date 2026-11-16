import PriceWatch from '#models/price_watch'
import PriceAlertService from '#services/price_alert_service'
import env from '#start/env'
import { priceWatchIntervalValidator, priceWatchValidator } from '#validators/connections'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class PriceWatchesController {
  async index({ auth, view }: HttpContext) {
    const watches = await PriceWatch.query()
      .where('userId', auth.user!.id)
      .orderBy('status', 'asc')
      .orderBy('travelDate', 'asc')
      .orderBy('departureTime', 'asc')

    return view.render('pages/price_watches/index', {
      watches,
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
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    const travelDate = DateTime.fromISO(payload.travelDate, { zone: timezone })
    const checkIntervalMinutes = this.normalizeCheckInterval(payload.checkIntervalMinutes)

    if (!travelDate.isValid) {
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
      arrivalTime: payload.arrivalTime ?? null,
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
      status: 'active',
    }

    if (existing) {
      existing.merge(attributes)
      await existing.save()
      session.flash('success', 'Zaktualizowano obserwację tego połączenia.')
    } else {
      await PriceWatch.create({
        userId: auth.user!.id,
        origin: payload.origin,
        destination: payload.destination,
        travelDate,
        departureTime: payload.departureTime,
        ...attributes,
      })
      session.flash('success', 'Połączenie dodano do obserwowanych.')
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
}
