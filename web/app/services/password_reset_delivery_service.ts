import PasswordResetDelivery from '#models/password_reset_delivery'
import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import encryption from '@adonisjs/core/services/encryption'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

const ENCRYPTION_PURPOSE = 'password-reset-delivery'

export interface PasswordResetDeliverySummary {
  delivered: number
  errors: number
}

export function encryptPasswordResetToken(token: string) {
  return encryption.encrypt(token, undefined, ENCRYPTION_PURPOSE)
}

export default class PasswordResetDeliveryService {
  async processPending(): Promise<PasswordResetDeliverySummary> {
    const summary = { delivered: 0, errors: 0 }
    const now = DateTime.utc()
    await PasswordResetToken.query().where('expiresAt', '<=', now.toSQL()!).delete()

    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return summary
    }

    const staleAt = now.minus({ seconds: env.get('ALERT_OUTBOX_LOCK_TIMEOUT_SECONDS') })
    const candidates = await PasswordResetDelivery.query()
      .select('id')
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

    for (const candidate of candidates) {
      const lockToken = randomUUID()
      const claimed = await db
        .from('password_reset_deliveries')
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

      const delivery = await PasswordResetDelivery.query()
        .where('id', candidate.id)
        .where('lockToken', lockToken)
        .first()
      if (!delivery) {
        continue
      }

      try {
        const resetToken = await PasswordResetToken.query()
          .where('id', delivery.resetTokenId)
          .whereNull('usedAt')
          .where('expiresAt', '>', DateTime.utc().toSQL()!)
          .first()
        if (!resetToken) {
          await this.cancel(delivery)
          continue
        }

        const token = encryption.decrypt(delivery.encryptedToken, ENCRYPTION_PURPOSE)
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
          throw new Error('Nie udało się odszyfrować tokenu resetu hasła.')
        }

        const user = await User.findOrFail(delivery.userId)
        const resetUrl = new URL('/reset-password', env.get('APP_URL'))
        resetUrl.hash = new URLSearchParams({ token }).toString()
        const validForMinutes = Math.max(
          1,
          Math.ceil(resetToken.expiresAt.diff(DateTime.utc(), 'minutes').minutes)
        )
        const result = await new NotificationService().sendPasswordReset(
          user.email,
          resetUrl.toString(),
          validForMinutes
        )
        if (!result.delivered) {
          throw new Error(result.reason ?? 'Wiadomość resetująca nie została dostarczona.')
        }

        delivery.status = 'sent'
        delivery.sentAt = DateTime.utc()
        delivery.lockToken = null
        delivery.lockedAt = null
        delivery.lastError = null
        await delivery.save()
        summary.delivered += 1
      } catch (error) {
        summary.errors += 1
        await this.scheduleRetry(delivery, error)
        logger.error(
          { err: error, passwordResetDeliveryId: delivery.id },
          'Nie udało się wysłać wiadomości resetującej hasło'
        )
      }
    }

    return summary
  }

  private async cancel(delivery: PasswordResetDelivery) {
    delivery.status = 'cancelled'
    delivery.lockToken = null
    delivery.lockedAt = null
    delivery.lastError = null
    await delivery.save()
  }

  private async scheduleRetry(delivery: PasswordResetDelivery, error: unknown) {
    const retrySeconds = Math.min(
      env.get('ALERT_OUTBOX_RETRY_MAX_SECONDS'),
      env.get('ALERT_OUTBOX_RETRY_BASE_SECONDS') * 2 ** Math.max(0, delivery.attemptCount - 1)
    )

    delivery.status =
      delivery.attemptCount >= env.get('ALERT_OUTBOX_MAX_ATTEMPTS') ? 'failed' : 'retry'
    delivery.availableAt = DateTime.utc().plus({ seconds: retrySeconds })
    delivery.lockToken = null
    delivery.lockedAt = null
    delivery.lastError = (
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Nieznany błąd wysyłki'
    ).slice(0, 500)
    await delivery.save()
  }
}
