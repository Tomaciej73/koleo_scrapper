import AlertOutbox from '#models/alert_outbox'
import PriceWatch from '#models/price_watch'
import User from '#models/user'
import NotificationService, { type PriceAlertReason } from '#services/notification_service'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import NbpExchangeRateService from '#services/nbp_exchange_rate_service'
import type { CzkExchangeRate } from '#services/nbp_exchange_rate_service'
import SmsGatewayService from '#services/sms_gateway_service'

export interface OutboxProcessingSummary {
  delivered: number
  errors: number
}

export type EnqueueResult = 'queued' | 'duplicate' | 'daily_limit'

export default class AlertOutboxService {
  async enqueuePriceAlert(
    watch: PriceWatch,
    previousPriceCents: number,
    currentPriceCents: number,
    idempotencyEvent?: string,
    options: { czkRate?: CzkExchangeRate | null; reason?: PriceAlertReason } = {}
  ): Promise<EnqueueResult> {
    const idempotencyKey = idempotencyEvent
      ? `price-watch:${watch.id}:${idempotencyEvent}`
      : `price-watch:${watch.id}:transition:${previousPriceCents}:${currentPriceCents}`
    const timezone = env.get('APP_TIMEZONE') ?? 'Europe/Warsaw'
    const dayStart = DateTime.now().setZone(timezone).startOf('day').toUTC()
    const czkRate =
      watch.provider === 'cd'
        ? options.czkRate === undefined
          ? await new NbpExchangeRateService().getCzkRate()
          : options.czkRate
        : null
    const message = new NotificationService().buildPriceChange(
      watch,
      previousPriceCents,
      currentPriceCents,
      czkRate,
      options.reason
    )

    return db.transaction(async (trx) => {
      const user = await User.query({ client: trx })
        .where('id', watch.userId)
        .forUpdate()
        .firstOrFail()

      const existing = await AlertOutbox.query({ client: trx })
        .whereIn('idempotencyKey', [idempotencyKey, `${idempotencyKey}:sms`])
        .first()
      if (existing) {
        return 'duplicate'
      }

      const channels: Array<'email' | 'sms'> =
        watch.notificationChannel === 'both'
          ? ['email', 'sms']
          : watch.notificationChannel === 'sms'
            ? ['sms']
            : ['email']
      if (channels.includes('sms') && (!user.phoneNumber || !user.phoneVerifiedAt)) {
        throw new Error('Numer telefonu do alertów SMS nie jest potwierdzony.')
      }

      const dailyCount = await AlertOutbox.query({ client: trx })
        .where('userId', user.id)
        .where('createdAt', '>=', dayStart.toSQL()!)
        .count('* as total')
        .firstOrFail()
        .then((row) => Number(row.$extras.total))

      if (dailyCount + channels.length > env.get('ALERT_DAILY_MAX_MESSAGES_PER_USER')) {
        return 'daily_limit'
      }

      for (const channel of channels) {
        await AlertOutbox.create(
          {
            deliveryId: randomUUID(),
            idempotencyKey: channel === 'email' ? idempotencyKey : `${idempotencyKey}:sms`,
            channel,
            userId: user.id,
            priceWatchId: watch.id,
            priceCents: currentPriceCents,
            previousPriceCents,
            subject: message.subject,
            body: message.content,
            status: 'pending',
            attemptCount: 0,
            availableAt: DateTime.utc(),
            lockToken: null,
            lockedAt: null,
            sentAt: null,
            lastError: null,
          },
          { client: trx }
        )
      }
      return 'queued'
    })
  }

  async processPending(userId?: number): Promise<OutboxProcessingSummary> {
    const summary: OutboxProcessingSummary = { delivered: 0, errors: 0 }
    const activeChannels: Array<'email' | 'sms'> = []
    if (env.get('MAIL_ENABLED') ?? false) activeChannels.push('email')
    if (SmsGatewayService.configured()) activeChannels.push('sms')
    if (activeChannels.length === 0) {
      return summary
    }

    const now = DateTime.utc()
    const staleAt = now.minus({ seconds: env.get('ALERT_OUTBOX_LOCK_TIMEOUT_SECONDS') })
    const candidates = AlertOutbox.query()
      .select('id')
      .whereIn('channel', activeChannels)
      .where((query) => {
        query
          .where((available) => {
            available
              .whereIn('status', ['pending', 'retry'])
              .where('availableAt', '<=', now.toSQL()!)
          })
          .orWhere((stale) => {
            stale.where('status', 'processing').where('lockedAt', '<=', staleAt.toSQL()!)
          })
      })
      .orderBy('availableAt', 'asc')
      .orderBy('id', 'asc')
      .limit(env.get('ALERT_OUTBOX_BATCH_SIZE'))

    if (userId !== undefined) {
      candidates.where('userId', userId)
    }

    for (const candidate of await candidates) {
      const lockToken = randomUUID()
      const claimed = await db
        .from('alert_outbox')
        .where('id', candidate.id)
        .where((query) => {
          query
            .where((available) => {
              available
                .whereIn('status', ['pending', 'retry'])
                .where('available_at', '<=', now.toSQL()!)
            })
            .orWhere((stale) => {
              stale.where('status', 'processing').where('locked_at', '<=', staleAt.toSQL()!)
            })
        })
        .update({
          status: 'processing',
          lock_token: lockToken,
          locked_at: now.toSQL(),
          attempt_count: db.raw('attempt_count + 1'),
          updated_at: now.toSQL(),
        })

      if (Number(claimed) !== 1) {
        continue
      }

      const alert = await AlertOutbox.query()
        .where('id', candidate.id)
        .where('lockToken', lockToken)
        .first()
      if (!alert) {
        continue
      }

      try {
        const user = await User.findOrFail(alert.userId)
        if (alert.channel === 'sms' && (!user.phoneNumber || !user.phoneVerifiedAt)) {
          throw new Error('Numer telefonu do alertu SMS nie jest już potwierdzony.')
        }
        const recipient = alert.channel === 'sms' ? user.phoneNumber! : user.email
        const delivery = await new NotificationService().sendQueuedAlert(alert, recipient)
        if (!delivery.delivered) {
          throw new Error(delivery.reason ?? 'Wiadomość nie została dostarczona.')
        }

        await db.transaction(async (trx) => {
          alert.useTransaction(trx)
          alert.status = 'sent'
          alert.sentAt = DateTime.utc()
          alert.lockToken = null
          alert.lockedAt = null
          alert.lastError = null
          await alert.save()

          if (alert.priceWatchId !== null) {
            const watch = await PriceWatch.query({ client: trx })
              .where('id', alert.priceWatchId)
              .forUpdate()
              .first()
            if (watch) {
              watch.lastNotifiedAt = alert.sentAt
              watch.lastNotifiedPriceCents = alert.priceCents
              await watch.save()
            }
          }
        })
        summary.delivered += 1
        logger.info(
          {
            event: 'price_alert_delivered',
            outboxId: alert.id,
            deliveryId: alert.deliveryId,
            channel: alert.channel,
            watchId: alert.priceWatchId,
            previousPriceCents: alert.previousPriceCents,
            currentPriceCents: alert.priceCents,
          },
          'Wysłano alert cenowy'
        )
      } catch (error) {
        summary.errors += 1
        await this.scheduleRetry(alert, error)
        logger.error(
          { err: error, outboxId: alert.id, deliveryId: alert.deliveryId },
          'Nie udało się wysłać alertu z kolejki'
        )
      }
    }

    return summary
  }

  private async scheduleRetry(alert: AlertOutbox, error: unknown) {
    const maxAttempts = env.get('ALERT_OUTBOX_MAX_ATTEMPTS')
    const retryBase = env.get('ALERT_OUTBOX_RETRY_BASE_SECONDS')
    const retryMaximum = env.get('ALERT_OUTBOX_RETRY_MAX_SECONDS')
    const retrySeconds = Math.min(
      retryMaximum,
      retryBase * 2 ** Math.max(0, alert.attemptCount - 1)
    )

    alert.status = alert.attemptCount >= maxAttempts ? 'failed' : 'retry'
    alert.availableAt = DateTime.utc().plus({ seconds: retrySeconds })
    alert.lockToken = null
    alert.lockedAt = null
    alert.lastError = this.errorMessage(error)
    await alert.save()

    if (alert.status === 'failed' && alert.priceWatchId !== null) {
      const watch = await PriceWatch.find(alert.priceWatchId)
      if (watch) {
        watch.lastErrorMessage =
          'Nie udało się wysłać alertu po wykorzystaniu wszystkich prób. Kolejne zmiany ceny utworzą nowe powiadomienie.'
        watch.lastErrorAt = DateTime.utc()
        await watch.save()
      }
    }
  }

  private errorMessage(error: unknown) {
    return (
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Nieznany błąd wysyłki'
    ).slice(0, 500)
  }
}
