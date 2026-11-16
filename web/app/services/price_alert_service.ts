import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import ConnectionSearchService, { ConnectionSearchError } from '#services/connection_search_service'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import { DateTime } from 'luxon'

export interface AlertCheckSummary {
  checked: number
  priceDrops: number
  delivered: number
  errors: number
}

export default class PriceAlertService {
  async checkAllActive(): Promise<AlertCheckSummary> {
    const now = DateTime.utc()
    const watches = await PriceWatch.query()
      .where('status', 'active')
      .where((query) => {
        query.whereNull('nextCheckAt').orWhere('nextCheckAt', '<=', now.toSQL()!)
      })
      .orderBy('id', 'asc')
    return this.checkWatches(watches)
  }

  async checkForUser(userId: number): Promise<AlertCheckSummary> {
    const watches = await PriceWatch.query()
      .where('userId', userId)
      .where('status', 'active')
      .orderBy('id', 'asc')
    return this.checkWatches(watches)
  }

  private async checkWatches(watches: PriceWatch[]): Promise<AlertCheckSummary> {
    const summary: AlertCheckSummary = { checked: 0, priceDrops: 0, delivered: 0, errors: 0 }
    const searchService = new ConnectionSearchService()
    const notificationService = new NotificationService()
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    const now = DateTime.utc()
    const localNow = now.setZone(timezone)

    for (const watch of watches) {
      const departureAt = DateTime.fromISO(
        `${watch.travelDate.toISODate()}T${watch.departureTime}`,
        { zone: timezone }
      )

      if (departureAt.isValid && departureAt <= localNow) {
        watch.status = 'expired'
        watch.nextCheckAt = null
        await watch.save()
        continue
      }

      summary.checked += 1
      watch.lastCheckedAt = now
      watch.nextCheckAt = now.plus({ minutes: this.checkIntervalFor(watch) })

      try {
        const results = await searchService.search({
          origin: watch.origin,
          destination: watch.destination,
          travelDate: watch.travelDate.toISODate()!,
          departureTime: watch.departureTime,
          onlyDirect: false,
        })
        const connection =
          results.find((result) => result.uuid === watch.connectionUuid) ?? results.at(0)

        if (!connection) {
          watch.lastErrorMessage = 'Nie znaleziono obserwowanego połączenia w aktualnych wynikach.'
          watch.lastErrorAt = now
          await watch.save()
          continue
        }

        if (connection.priceCents === null) {
          watch.lastErrorMessage = 'Cena tego połączenia jest obecnie niedostępna.'
          watch.lastErrorAt = now
          await watch.save()
          continue
        }

        const previousPrice = watch.lastPriceCents ?? connection.priceCents
        const notificationReference =
          watch.lastNotifiedPriceCents ?? watch.baselinePriceCents ?? previousPrice
        const isNewAlertPrice = connection.priceCents < notificationReference
        const isWithinTarget =
          watch.targetPriceCents === null || connection.priceCents <= watch.targetPriceCents
        const firstTargetMatch =
          watch.targetPriceCents !== null &&
          connection.priceCents <= watch.targetPriceCents &&
          watch.lastNotifiedPriceCents === null
        const shouldNotify = isWithinTarget && (isNewAlertPrice || firstTargetMatch)

        watch.lastPriceCents = connection.priceCents
        watch.lowestPriceCents = Math.min(
          watch.lowestPriceCents ?? connection.priceCents,
          connection.priceCents
        )
        watch.arrivalTime = connection.arrival
        watch.arrivalDate = DateTime.fromISO(connection.arrivalDate, { zone: timezone })
        watch.trainName = connection.trains
        watch.lastErrorMessage = null
        watch.lastErrorAt = null

        if (shouldNotify) {
          summary.priceDrops += 1
          const notification = await notificationService.sendPriceDrop(watch, previousPrice)
          if (notification.delivered) {
            watch.lastNotifiedAt = now
            watch.lastNotifiedPriceCents = connection.priceCents
            summary.delivered += 1
          }
        }

        await watch.save()
        await PriceObservation.create({
          priceWatchId: watch.id,
          priceCents: connection.priceCents,
          observedAt: now,
        })
      } catch (error) {
        summary.errors += 1
        watch.lastErrorMessage = this.userFacingError(error)
        watch.lastErrorAt = now
        await watch.save()
      }
    }

    return summary
  }

  private checkIntervalFor(watch: PriceWatch) {
    const minimum = Math.max(1, env.get('ALERT_MIN_CHECK_INTERVAL_MINUTES') ?? 5)
    const maximum = Math.max(minimum, env.get('ALERT_MAX_CHECK_INTERVAL_MINUTES') ?? 1_440)
    return Math.min(maximum, Math.max(minimum, watch.checkIntervalMinutes))
  }

  private userFacingError(error: unknown) {
    if (error instanceof ConnectionSearchError && error.message.trim()) {
      return error.message.trim().slice(0, 500)
    }

    return 'Nie udało się sprawdzić ceny. Próba zostanie ponowiona zgodnie z harmonogramem.'
  }
}
