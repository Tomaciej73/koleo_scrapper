import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { createHash, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { DateTime } from 'luxon'

export type PasswordResetResult = 'reset' | 'invalid'

export default class PasswordResetService {
  async request(email: string) {
    const startedAt = Date.now()
    const normalizedEmail = email.trim().toLocaleLowerCase('en-US')
    const token = randomBytes(32).toString('hex')
    const tokenHash = this.hashToken(token)
    let createdToken = false

    try {
      const user = await User.query().whereRaw('LOWER(email) = ?', [normalizedEmail]).first()

      if (!user) {
        return
      }

      const validForMinutes = env.get('PASSWORD_RESET_TOKEN_TTL_MINUTES')
      await db.transaction(async (trx) => {
        await User.query({ client: trx }).where('id', user.id).forUpdate().firstOrFail()
        await PasswordResetToken.query({ client: trx }).where('userId', user.id).delete()
        await PasswordResetToken.create(
          {
            userId: user.id,
            tokenHash,
            expiresAt: DateTime.utc().plus({ minutes: validForMinutes }),
            usedAt: null,
          },
          { client: trx }
        )
      })
      createdToken = true

      const resetUrl = new URL(`/reset-password/${token}`, env.get('APP_URL')).toString()
      const notification = await new NotificationService().sendPasswordReset(
        user.email,
        resetUrl,
        validForMinutes
      )
      if (!notification.delivered) {
        throw new Error(notification.reason ?? 'Wiadomość resetująca nie została dostarczona.')
      }
    } catch (error) {
      if (createdToken) {
        await PasswordResetToken.query().where('tokenHash', tokenHash).delete()
      }
      throw error
    } finally {
      const remainingDelay = env.get('PASSWORD_RESET_MIN_RESPONSE_MS') - (Date.now() - startedAt)
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
      logger.error({ err: error, userId: user.id }, 'Password reset confirmation delivery failed')
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
