import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import AlertOutboxService from '#services/alert_outbox_service'
import ConnectionSearchService, { ConnectionSearchError } from '#services/connection_search_service'
import MetricsService from '#services/metrics_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

export interface AlertCheckSummary {
  checked: number
  priceDrops: number
  delivered: number
  errors: number
}

interface ClaimedWatch {
  token: string
  watch: PriceWatch
}

export default class PriceAlertService {
  async checkAllActive(): Promise<AlertCheckSummary> {
    const now = DateTime.utc()
    const candidates = await PriceWatch.query()
      .select('id')
      .where('status', 'active')
      .where((query) => {
        query.whereNull('nextCheckAt').orWhere('nextCheckAt', '<=', now.toSQL()!)
      })
      .orderBy('id', 'asc')

    return this.checkWatches(
      candidates.map((watch) => watch.id),
      true
    )
  }

  async checkForUser(userId: number): Promise<AlertCheckSummary> {
    const candidates = await PriceWatch.query()
      .select('id')
      .where('userId', userId)
      .where('status', 'active')
      .orderBy('id', 'asc')

    return this.checkWatches(
      candidates.map((watch) => watch.id),
      false,
      userId
    )
  }

  private async checkWatches(
    watchIds: number[],
    requireDue: boolean,
    outboxUserId?: number
  ): Promise<AlertCheckSummary> {
    const summary: AlertCheckSummary = { checked: 0, priceDrops: 0, delivered: 0, errors: 0 }
    const searchService = new ConnectionSearchService()
    const outboxService = new AlertOutboxService()
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'

    for (const watchId of watchIds) {
      const claimed = await this.claimWatch(watchId, requireDue)
      if (!claimed) {
        continue
      }

      const { watch, token } = claimed
      const now = DateTime.utc()
      try {
        const localNow = now.setZone(timezone)
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

        if (watch.originStationId === null || watch.destinationStationId === null) {
          throw new ConnectionSearchError(
            'Obserwacja nie ma identyfikatorów stacji. Usuń ją i dodaj ponownie z listy podpowiedzi.'
          )
        }

        if (!watch.connectionUuid) {
          await this.markConnectionMissing(
            watch,
            now,
            'Obserwacja nie ma identyfikatora połączenia. Usuń ją i dodaj ponownie.'
          )
          summary.errors += 1
          continue
        }

        const results = await searchService.search({
          origin: watch.origin,
          originStationId: watch.originStationId,
          destination: watch.destination,
          destinationStationId: watch.destinationStationId,
          travelDate: watch.travelDate.toISODate()!,
          departureTime: watch.departureTime,
          onlyDirect: false,
        })
        const connection = results.find((result) => result.uuid === watch.connectionUuid)

        if (!connection) {
          await this.markConnectionMissing(
            watch,
            now,
            'Nie znaleziono dokładnie obserwowanego połączenia. Alert został zatrzymany.'
          )
          summary.errors += 1
          continue
        }

        if (connection.priceCents === null) {
          summary.errors += 1
          watch.lastErrorMessage = 'Cena tego połączenia jest obecnie niedostępna.'
          watch.lastErrorAt = now
          await watch.save()
          await new MetricsService().increment('worker_watch_errors_total')
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
        await watch.save()

        await PriceObservation.create({
          priceWatchId: watch.id,
          priceCents: connection.priceCents,
          observedAt: now,
        })

        if (shouldNotify) {
          const enqueueResult = await outboxService.enqueuePriceAlert(
            watch,
            previousPrice,
            connection.priceCents
          )
          if (enqueueResult === 'queued') {
            summary.priceDrops += 1
          } else if (enqueueResult === 'daily_limit') {
            summary.errors += 1
            watch.lastErrorMessage = `Osiągnięto dzienny limit ${env.get('ALERT_DAILY_MAX_MESSAGES_PER_USER')} alertów.`
            watch.lastErrorAt = now
            await watch.save()
            await new MetricsService().increment('worker_watch_errors_total')
          }
        }
      } catch (error) {
        summary.errors += 1
        watch.lastErrorMessage = this.userFacingError(error)
        watch.lastErrorAt = now
        await watch.save()
        logger.error({ err: error, watchId: watch.id }, 'Price watch check failed')
        await new MetricsService().increment('worker_watch_errors_total')
      } finally {
        await this.releaseWatch(watch.id, token)
      }
    }

    const delivery = await outboxService.processPending(outboxUserId)
    summary.delivered += delivery.delivered
    summary.errors += delivery.errors
    return summary
  }

  private async claimWatch(id: number, requireDue: boolean): Promise<ClaimedWatch | null> {
    const now = DateTime.utc()
    const staleAt = now.minus({ seconds: env.get('ALERT_WATCH_LOCK_TIMEOUT_SECONDS') })
    const token = randomUUID()
    const query = db
      .from('price_watches')
      .where('id', id)
      .where('status', 'active')
      .where((lock) => {
        lock.whereNull('processing_token').orWhere('processing_started_at', '<=', staleAt.toSQL()!)
      })

    if (requireDue) {
      query.where((due) => {
        due.whereNull('next_check_at').orWhere('next_check_at', '<=', now.toSQL()!)
      })
    }

    const updated = await query.update({
      processing_token: token,
      processing_started_at: now.toSQL(),
    })
    if (Number(updated) !== 1) {
      return null
    }

    const watch = await PriceWatch.findOrFail(id)
    return { token, watch }
  }

  private async releaseWatch(id: number, token: string) {
    await db
      .from('price_watches')
      .where('id', id)
      .where('processing_token', token)
      .update({ processing_token: null, processing_started_at: null })
  }

  private async markConnectionMissing(watch: PriceWatch, now: DateTime, message: string) {
    watch.status = 'connection_missing'
    watch.nextCheckAt = null
    watch.lastErrorMessage = message
    watch.lastErrorAt = now
    await watch.save()
    await new MetricsService().increment('worker_watch_errors_total')
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
