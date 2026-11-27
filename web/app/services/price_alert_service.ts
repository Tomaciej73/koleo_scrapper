import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import AlertOutboxService, { type EnqueueResult } from '#services/alert_outbox_service'
import ConnectionSearchService, {
  ConnectionSearchError,
  type ConnectionMetadata,
} from '#services/connection_search_service'
import MetricsService from '#services/metrics_service'
import NbpExchangeRateService from '#services/nbp_exchange_rate_service'
import { czkToPlnCents } from '#services/price_format_service'
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
  constructor(private readonly exchangeRateService = new NbpExchangeRateService()) {}

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
    const searchServices = new Map<string, ConnectionSearchService>()
    const outboxService = new AlertOutboxService()
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    let circuitOpen = false

    for (const watchId of watchIds) {
      const claimed = await this.claimWatch(watchId, requireDue)
      if (!claimed) {
        continue
      }

      const { watch, token } = claimed
      if (circuitOpen && watch.provider === 'koleo') {
        await this.releaseWatch(watch.id, token)
        continue
      }
      const now = DateTime.utc()
      let targetStateBeforeUnqueuedAlert: boolean | null | undefined
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

        const watchProvider = watch.provider
        if (watchProvider !== 'demo' && watchProvider !== 'koleo' && watchProvider !== 'cd') {
          throw new ConnectionSearchError(
            'Nieznane źródło ceny obserwacji.',
            'invalidWatchProvider'
          )
        }
        let searchService = searchServices.get(watchProvider)
        if (!searchService) {
          searchService = new ConnectionSearchService(watchProvider)
          searchServices.set(watchProvider, searchService)
        }
        const { connection, resultCount } = await searchService.searchForWatch(
          {
            provider: watchProvider,
            origin: watch.origin,
            originStationId: watch.originStationId,
            destination: watch.destination,
            destinationStationId: watch.destinationStationId,
            travelDate: watch.travelDate.toISODate()!,
            departureTime: watch.departureTime,
            onlyDirect: false,
          },
          (results) => {
            const exactConnection = watch.connectionUuid
              ? results.find((result) => result.uuid === watch.connectionUuid)
              : undefined
            return (exactConnection ?? this.findUniqueEquivalentConnection(watch, results))?.uuid
          }
        )
        const matchStrategy = connection?.uuid === watch.connectionUuid ? 'uuid' : 'equivalent'

        if (!connection) {
          await this.registerConnectionMiss(watch, now, trigger, resultCount)
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
        const needsPlnConversion =
          watch.provider === 'cd' &&
          watch.targetPriceCurrency !== 'CZK' &&
          watch.targetPriceCents !== null
        const czkRate = needsPlnConversion ? await this.exchangeRateService.getCzkRate() : null
        const comparedPriceCents = needsPlnConversion
          ? czkRate
            ? czkToPlnCents(connection.priceCents, czkRate)
            : null
          : connection.priceCents
        const previousTargetMet = watch.lastTargetMet === null ? null : Boolean(watch.lastTargetMet)
        const targetMet =
          watch.targetPriceCents !== null && comparedPriceCents !== null
            ? comparedPriceCents <= watch.targetPriceCents
            : null
        const rateChanged =
          czkRate !== null &&
          watch.lastNbpTableNumber !== null &&
          watch.lastNbpRateMid !== null &&
          (watch.lastNbpTableNumber !== czkRate.tableNumber ||
            watch.lastNbpRateMid !== String(czkRate.mid))
        const rateSnapshotNeeded =
          czkRate !== null && (watch.lastNbpTableNumber === null || rateChanged)
        if (needsPlnConversion && !czkRate) {
          logger.warn(
            { event: 'price_target_rate_unavailable', ...this.watchLogContext(watch) },
            'Nie można sprawdzić progu PLN bez kursu NBP; cena źródłowa jest nadal śledzona'
          )
        }
        const targetReached =
          targetMet === true &&
          (previousTargetMet === false ||
            (previousTargetMet === null && watch.lastNotifiedPriceCents === null))
        const notificationReason = priceChanged
          ? 'price_change'
          : targetReached
            ? needsPlnConversion && rateChanged && previousTargetMet === false
              ? 'exchange_rate_target_reached'
              : 'target_reached'
            : null
        const shouldNotify = notificationReason !== null
        if (targetReached && !priceChanged) {
          targetStateBeforeUnqueuedAlert = previousTargetMet
        }

        watch.lastPriceCents = connection.priceCents
        watch.lowestPriceCents = Math.min(
          watch.lowestPriceCents ?? connection.priceCents,
          connection.priceCents
        )
        watch.lastErrorMessage = null
        watch.lastErrorAt = null
        if (watch.targetPriceCents === null) {
          watch.lastTargetMet = null
        } else if (targetMet !== null) {
          watch.lastTargetMet = targetMet
        }
        if (czkRate) {
          watch.lastNbpRateMid = String(czkRate.mid)
          watch.lastNbpTableNumber = czkRate.tableNumber
        }
        await watch.save()

        const observation =
          storedPrice === null ||
          priceChanged ||
          rateSnapshotNeeded ||
          (targetMet !== null && previousTargetMet !== targetMet)
            ? await PriceObservation.create({
                priceWatchId: watch.id,
                priceCents: connection.priceCents,
                comparedPriceCents: watch.targetPriceCents === null ? null : comparedPriceCents,
                targetPriceCents: watch.targetPriceCents,
                targetPriceCurrency:
                  watch.targetPriceCents === null ? null : watch.targetPriceCurrency,
                targetMet,
                nbpRateMid: czkRate ? String(czkRate.mid) : null,
                nbpEffectiveDate: czkRate?.effectiveDate ?? null,
                nbpTableNumber: czkRate?.tableNumber ?? null,
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
              : previousTargetMet === false
                ? `target-crossed:${watch.targetPriceCurrency}:${watch.targetPriceCents}:${connection.priceCents}:${czkRate?.tableNumber}:${czkRate?.mid}`
                : `target:${watch.targetPriceCurrency}:${watch.targetPriceCents}:${connection.priceCents}`
          enqueueResult = await outboxService.enqueuePriceAlert(
            watch,
            previousPrice,
            connection.priceCents,
            idempotencyEvent,
            { czkRate: needsPlnConversion ? czkRate : undefined, reason: notificationReason }
          )
          if (enqueueResult === 'queued') {
            summary.alertsQueued += 1
          } else if (enqueueResult === 'daily_limit') {
            summary.errors += 1
            if (targetStateBeforeUnqueuedAlert !== undefined) {
              watch.lastTargetMet = targetStateBeforeUnqueuedAlert
            }
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
          targetStateBeforeUnqueuedAlert = undefined
        }

        logger.info(
          {
            event: 'price_watch_checked',
            trigger,
            matchStrategy,
            previousConnectionUuid,
            providerConnectionUuid: connection.uuid,
            previousPriceCents: storedPrice,
            currentPriceCents: connection.priceCents,
            priceDeltaCents: storedPrice === null ? null : connection.priceCents - storedPrice,
            targetPriceCurrency: watch.targetPriceCurrency,
            comparedPriceCents,
            nbpEffectiveDate: czkRate?.effectiveDate ?? null,
            nbpRateMid: czkRate?.mid ?? null,
            nbpTableNumber: czkRate?.tableNumber ?? null,
            previousTargetMet,
            targetMet,
            rateChanged,
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
            : notificationReason === 'exchange_rate_target_reached'
              ? 'Próg PLN został osiągnięty po zmianie kursu NBP'
              : 'Cena obserwowanego połączenia nie zmieniła się'
        )
      } catch (error) {
        summary.errors += 1
        if (targetStateBeforeUnqueuedAlert !== undefined) {
          watch.lastTargetMet = targetStateBeforeUnqueuedAlert
        }
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

  private findUniqueEquivalentConnection(watch: PriceWatch, results: ConnectionMetadata[]) {
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
      provider: watch.provider,
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
