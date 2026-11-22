import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import AlertOutboxService, { type EnqueueResult } from '#services/alert_outbox_service'
import ConnectionSearchService, {
  ConnectionSearchError,
  type ConnectionResult,
} from '#services/connection_search_service'
import MetricsService from '#services/metrics_service'
import { KoleoCircuitOpenError } from '#services/koleo_circuit_breaker_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

export interface AlertCheckSummary {
  checked: number
  priceChanges: number
  priceDrops: number
  priceIncreases: number
  unchanged: number
  alertsQueued: number
  delivered: number
  errors: number
}

export type PriceCheckTrigger = 'worker' | 'manual' | 'command'

interface ClaimedWatch {
  token: string
  watch: PriceWatch
}

export default class PriceAlertService {
  async checkAllActive(trigger: PriceCheckTrigger = 'worker'): Promise<AlertCheckSummary> {
    const now = DateTime.utc()
    const candidates = await PriceWatch.query()
      .select('id')
      .where('status', 'active')
      .where((query) => {
        query.whereNull('nextCheckAt').orWhere('nextCheckAt', '<=', now.toSQL()!)
      })
      .orderBy('id', 'asc')
      .limit(env.get('ALERT_WORKER_BATCH_SIZE'))

    return this.checkWatches(
      candidates.map((watch) => watch.id),
      true,
      undefined,
      trigger
    )
  }

  async checkForUser(
    userId: number,
    trigger: PriceCheckTrigger = 'manual'
  ): Promise<AlertCheckSummary> {
    const candidates = await PriceWatch.query()
      .select('id')
      .where('userId', userId)
      .where('status', 'active')
      .orderBy('id', 'asc')

    return this.checkWatches(
      candidates.map((watch) => watch.id),
      false,
      userId,
      trigger
    )
  }

  private async checkWatches(
    watchIds: number[],
    requireDue: boolean,
    outboxUserId: number | undefined,
    trigger: PriceCheckTrigger
  ): Promise<AlertCheckSummary> {
    const summary: AlertCheckSummary = {
      checked: 0,
      priceChanges: 0,
      priceDrops: 0,
      priceIncreases: 0,
      unchanged: 0,
      alertsQueued: 0,
      delivered: 0,
      errors: 0,
    }
    const searchService = new ConnectionSearchService()
    const outboxService = new AlertOutboxService()
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    let circuitOpen = false

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

        const results = await searchService.search({
          origin: watch.origin,
          originStationId: watch.originStationId,
          destination: watch.destination,
          destinationStationId: watch.destinationStationId,
          travelDate: watch.travelDate.toISODate()!,
          departureTime: watch.departureTime,
          onlyDirect: false,
        })
        const exactConnection = watch.connectionUuid
          ? results.find((result) => result.uuid === watch.connectionUuid)
          : undefined
        const equivalentConnection = exactConnection
          ? undefined
          : this.findUniqueEquivalentConnection(watch, results)
        const connection = exactConnection ?? equivalentConnection
        const matchStrategy = exactConnection ? 'uuid' : 'equivalent'

        if (!connection) {
          await this.registerConnectionMiss(watch, now, trigger, results.length)
          summary.errors += 1
          continue
        }

        const previousConnectionUuid = watch.connectionUuid
        if (connection.uuid !== watch.connectionUuid) {
          watch.connectionUuid = connection.uuid
          logger.info(
            {
              event: 'connection_uuid_refreshed',
              trigger,
              previousConnectionUuid,
              ...this.watchLogContext(watch),
            },
            'Odświeżono techniczny identyfikator obserwowanego połączenia'
          )
        }

        watch.connectionMissCount = 0
        watch.arrivalTime = connection.arrival
        watch.arrivalDate = DateTime.fromISO(connection.arrivalDate, { zone: timezone })
        watch.trainName = connection.trains
        watch.lastTicketAvailability = connection.ticketAvailability
        watch.lastAvailabilityMessage = connection.availabilityMessage

        if (connection.priceCents === null) {
          watch.lastErrorMessage = null
          watch.lastErrorAt = null
          await watch.save()
          logger.info(
            {
              event: 'ticket_unavailable',
              trigger,
              matchStrategy,
              previousConnectionUuid,
              providerConnectionUuid: connection.uuid,
              provider: connection.provider,
              resultArrivalTime: connection.arrival,
              resultArrivalDate: connection.arrivalDate,
              resultTrains: connection.trains,
              reason:
                connection.availabilityMessage ??
                'Cena i możliwość zakupu biletu są obecnie niedostępne.',
              ...this.watchLogContext(watch),
            },
            'Obserwacja oczekuje na udostępnienie sprzedaży biletu'
          )
          continue
        }

        const storedPrice = watch.lastPriceCents
        const previousPrice = storedPrice ?? connection.priceCents
        const priceChanged = storedPrice !== null && storedPrice !== connection.priceCents
        const priceDropped = storedPrice !== null && connection.priceCents < storedPrice
        const priceIncreased = storedPrice !== null && connection.priceCents > storedPrice
        const firstTargetMatch =
          watch.targetPriceCents !== null &&
          connection.priceCents <= watch.targetPriceCents &&
          watch.lastNotifiedPriceCents === null
        const notificationReason = priceChanged
          ? 'price_change'
          : firstTargetMatch
            ? 'target_reached'
            : null
        const shouldNotify = notificationReason !== null

        watch.lastPriceCents = connection.priceCents
        watch.lowestPriceCents = Math.min(
          watch.lowestPriceCents ?? connection.priceCents,
          connection.priceCents
        )
        watch.lastErrorMessage = null
        watch.lastErrorAt = null
        await watch.save()

        const observation =
          storedPrice === null || storedPrice !== connection.priceCents
            ? await PriceObservation.create({
                priceWatchId: watch.id,
                priceCents: connection.priceCents,
                observedAt: now,
              })
            : null

        if (priceChanged) {
          summary.priceChanges += 1
          if (priceDropped) {
            summary.priceDrops += 1
          } else if (priceIncreased) {
            summary.priceIncreases += 1
          }
        } else if (storedPrice !== null) {
          summary.unchanged += 1
        }

        let enqueueResult: EnqueueResult | 'not_requested' = 'not_requested'
        if (shouldNotify) {
          const idempotencyEvent =
            priceChanged && observation
              ? `observation:${observation.id}`
              : `target:${watch.targetPriceCents}:${connection.priceCents}`
          enqueueResult = await outboxService.enqueuePriceAlert(
            watch,
            previousPrice,
            connection.priceCents,
            idempotencyEvent
          )
          if (enqueueResult === 'queued') {
            summary.alertsQueued += 1
          } else if (enqueueResult === 'daily_limit') {
            summary.errors += 1
            watch.lastErrorMessage = `Osiągnięto dzienny limit ${env.get('ALERT_DAILY_MAX_MESSAGES_PER_USER')} alertów.`
            watch.lastErrorAt = now
            await watch.save()
            this.logWatchWarning(
              watch,
              'daily_alert_limit',
              watch.lastErrorMessage,
              'Alert cenowy nie został dodany do kolejki'
            )
            await new MetricsService().increment('worker_watch_errors_total')
          }
        }

        logger.info(
          {
            event: 'price_watch_checked',
            trigger,
            matchStrategy,
            previousConnectionUuid,
            providerConnectionUuid: connection.uuid,
            provider: connection.provider,
            previousPriceCents: storedPrice,
            currentPriceCents: connection.priceCents,
            priceDeltaCents: storedPrice === null ? null : connection.priceCents - storedPrice,
            priceChanged,
            notificationReason,
            enqueueResult,
            ticketAvailability: connection.ticketAvailability,
            resultDepartureTime: connection.departure,
            resultArrivalTime: connection.arrival,
            resultArrivalDate: connection.arrivalDate,
            resultTrains: connection.trains,
            ...this.watchLogContext(watch),
          },
          priceChanged
            ? 'Wykryto zmianę ceny obserwowanego połączenia'
            : 'Cena obserwowanego połączenia nie zmieniła się'
        )
      } catch (error) {
        summary.errors += 1
        watch.lastErrorMessage = this.userFacingError(error)
        watch.lastErrorAt = now
        await watch.save()
        logger.error(
          { err: error, event: 'watch_check_failed', trigger, ...this.watchLogContext(watch) },
          'Sprawdzenie obserwowanej ceny nie powiodło się'
        )
        await new MetricsService().increment('worker_watch_errors_total')
        if (error instanceof KoleoCircuitOpenError) {
          circuitOpen = true
          logger.warn(
            {
              event: 'koleo_circuit_breaker_open',
              retryAfterSeconds: error.retryAfterSeconds,
              trigger,
            },
            'Przerwano cykl sprawdzania po otwarciu circuit breakera KOLEO'
          )
        }
      } finally {
        await this.releaseWatch(watch.id, token)
      }
      if (circuitOpen) {
        break
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

  private async registerConnectionMiss(
    watch: PriceWatch,
    now: DateTime,
    trigger: PriceCheckTrigger,
    resultCount: number
  ) {
    const threshold = Math.max(1, env.get('ALERT_CONNECTION_MISSING_THRESHOLD'))
    watch.connectionMissCount += 1
    const thresholdReached = watch.connectionMissCount >= threshold
    const message = thresholdReached
      ? `Nie znaleziono jednoznacznie obserwowanego połączenia w ${threshold} kolejnych sprawdzeniach. Obserwacja została zatrzymana.`
      : `Nie znaleziono jednoznacznie obserwowanego połączenia. Próba ${watch.connectionMissCount} z ${threshold}; obserwacja pozostaje aktywna.`

    if (thresholdReached) {
      watch.status = 'connection_missing'
      watch.nextCheckAt = null
    }
    watch.lastTicketAvailability = 'unknown'
    watch.lastAvailabilityMessage = 'Nie można obecnie potwierdzić możliwości zakupu biletu.'
    watch.lastErrorMessage = message
    watch.lastErrorAt = now
    await watch.save()
    logger.warn(
      {
        event: thresholdReached ? 'connection_missing' : 'connection_temporarily_missing',
        trigger,
        resultCount,
        reason: message,
        ...this.watchLogContext(watch),
      },
      thresholdReached
        ? 'Obserwowane połączenie nie zostało jednoznacznie odnalezione'
        : 'Tymczasowo nie odnaleziono obserwowanego połączenia'
    )
    await new MetricsService().increment('worker_watch_errors_total')
  }

  private findUniqueEquivalentConnection(watch: PriceWatch, results: ConnectionResult[]) {
    if (!watch.trainName || !watch.arrivalTime) {
      return undefined
    }

    const expectedArrivalDate =
      watch.arrivalDate?.toISODate() ??
      watch.travelDate.plus({ days: watch.arrivalTime < watch.departureTime ? 1 : 0 }).toISODate()
    const expectedTrainName = this.normalizeTrainName(watch.trainName)
    const matches = results.filter(
      (result) =>
        result.departure === watch.departureTime &&
        result.arrival === watch.arrivalTime &&
        result.arrivalDate === expectedArrivalDate &&
        this.normalizeTrainName(result.trains) === expectedTrainName
    )

    return matches.length === 1 ? matches[0] : undefined
  }

  private normalizeTrainName(value: string) {
    return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pl-PL')
  }

  private logWatchWarning(watch: PriceWatch, event: string, reason: string, logMessage: string) {
    logger.warn({ event, reason, ...this.watchLogContext(watch) }, logMessage)
  }

  private watchLogContext(watch: PriceWatch) {
    return {
      watchId: watch.id,
      status: watch.status,
      originStationId: watch.originStationId,
      destinationStationId: watch.destinationStationId,
      travelDate: watch.travelDate.toISODate(),
      departureTime: watch.departureTime,
      connectionUuid: watch.connectionUuid,
      connectionMissCount: watch.connectionMissCount,
    }
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
