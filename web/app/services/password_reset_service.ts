import PasswordResetDelivery from '#models/password_reset_delivery'
import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import { encryptPasswordResetToken } from '#services/password_reset_delivery_service'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { DateTime } from 'luxon'

export type PasswordResetResult = 'reset' | 'invalid'

export default class PasswordResetService {
  async request(email: string) {
    const startedAt = Date.now()
    const normalizedEmail = email.trim().toLocaleLowerCase('en-US')
    const token = randomBytes(32).toString('hex')
    const tokenHash = this.hashToken(token)
    try {
      const user = await User.query().whereRaw('LOWER(email) = ?', [normalizedEmail]).first()

      if (!user) {
        return
      }

      const validForMinutes = env.get('PASSWORD_RESET_TOKEN_TTL_MINUTES')
      await db.transaction(async (trx) => {
        await User.query({ client: trx }).where('id', user.id).forUpdate().firstOrFail()
        await PasswordResetToken.query({ client: trx }).where('userId', user.id).delete()
        const resetToken = await PasswordResetToken.create(
          {
            userId: user.id,
            tokenHash,
            expiresAt: DateTime.utc().plus({ minutes: validForMinutes }),
            usedAt: null,
          },
          { client: trx }
        )
        await PasswordResetDelivery.create(
          {
            userId: user.id,
            resetTokenId: resetToken.id,
            encryptedToken: encryptPasswordResetToken(token),
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
      })
    } finally {
      const jitterMaximum = env.get('PASSWORD_RESET_RESPONSE_JITTER_MS')
      const targetDuration =
        env.get('PASSWORD_RESET_MIN_RESPONSE_MS') +
        (jitterMaximum > 0 ? randomInt(jitterMaximum + 1) : 0)
      const remainingDelay = targetDuration - (Date.now() - startedAt)
      if (remainingDelay > 0) {
        await delay(remainingDelay)
      }
    }
  }

  async isActive(token: string) {
    if (!this.validTokenFormat(token)) {
      return false
    }

    return Boolean(
      await PasswordResetToken.query()
        .where('tokenHash', this.hashToken(token))
        .whereNull('usedAt')
        .where('expiresAt', '>', DateTime.utc().toSQL()!)
        .first()
    )
  }

  async reset(token: string, password: string): Promise<PasswordResetResult> {
    if (!this.validTokenFormat(token)) {
      return 'invalid'
    }

    const user = await db.transaction(async (trx) => {
      const resetToken = await PasswordResetToken.query({ client: trx })
        .where('tokenHash', this.hashToken(token))
        .whereNull('usedAt')
        .where('expiresAt', '>', DateTime.utc().toSQL()!)
        .forUpdate()
        .first()

      if (!resetToken) {
        return null
      }

      const account = await User.query({ client: trx })
        .where('id', resetToken.userId)
        .forUpdate()
        .firstOrFail()
      account.password = password
      account.authVersion += 1
      await account.save()

      await PasswordResetToken.query({ client: trx })
        .where('userId', account.id)
        .whereNull('usedAt')
        .update({ usedAt: DateTime.utc().toSQL() })

      return account
    })

    if (!user) {
      return 'invalid'
    }

    try {
      await new NotificationService().sendPasswordChanged(user.email)
    } catch (error) {
      logger.error(
        { err: error, userId: user.id },
        'Nie udało się wysłać potwierdzenia zmiany hasła'
      )
    }

    return 'reset'
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private validTokenFormat(token: string) {
    return /^[a-f0-9]{64}$/i.test(token)
  }
}
