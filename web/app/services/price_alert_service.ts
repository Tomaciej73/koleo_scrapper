import PriceWatch from '#models/price_watch'
import ConnectionSearchService from '#services/connection_search_service'
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
    const watches = await PriceWatch.query().where('status', 'active').orderBy('id', 'asc')
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
    const now = DateTime.now().setZone(env.get('APP_TIMEZONE') ?? 'Europe/Warsaw')

    for (const watch of watches) {
      if (watch.travelDate.endOf('day') < now) {
        watch.status = 'expired'
        await watch.save()
        continue
      }

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

        summary.checked += 1
        watch.lastCheckedAt = now

        if (!connection || connection.priceCents === null) {
          await watch.save()
          continue
        }

        const previousPrice = watch.lastPriceCents ?? connection.priceCents
        const reachedTarget =
          watch.targetPriceCents !== null &&
          connection.priceCents <= watch.targetPriceCents &&
          previousPrice > watch.targetPriceCents
        const priceDropped = connection.priceCents < previousPrice || reachedTarget

        watch.lastPriceCents = connection.priceCents
        watch.lowestPriceCents = Math.min(
          watch.lowestPriceCents ?? connection.priceCents,
          connection.priceCents
        )
        watch.arrivalTime = connection.arrival
        watch.trainName = connection.trains

        if (priceDropped) {
          summary.priceDrops += 1
          const notification = await notificationService.sendPriceDrop(watch, previousPrice)
          if (notification.delivered) {
            watch.lastNotifiedAt = now
            summary.delivered += 1
          }
        }

        await watch.save()
      } catch {
        summary.errors += 1
      }
    }

    return summary
  }
}
