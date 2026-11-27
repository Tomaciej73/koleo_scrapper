import type User from '#models/user'
import PriceWatch from '#models/price_watch'
import PasswordResetToken from '#models/password_reset_token'
import UserModel from '#models/user'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { randomInt } from 'node:crypto'
import { DateTime } from 'luxon'

export const EMAIL_VERIFICATION_SESSION_KEY = 'pendingEmailVerificationUserId'

export type VerificationResult =
  'verified' | 'email_changed' | 'conflict' | 'invalid' | 'expired' | 'locked'

export class EmailVerificationDeliveryError extends Error {}

export default class EmailVerificationService {
  async issueCode(user: User, enforceCooldown = false) {
    const now = DateTime.now()
    const cooldownSeconds = Math.max(1, env.get('EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS') ?? 60)

    if (enforceCooldown && user.emailVerificationSentAt) {
      const elapsedSeconds = now.diff(user.emailVerificationSentAt, 'seconds').seconds
      if (elapsedSeconds < cooldownSeconds) {
        return {
          sent: false as const,
          retryAfterSeconds: Math.ceil(cooldownSeconds - elapsedSeconds),
        }
      }
    }

    const codeLength = Math.trunc(
      Math.min(8, Math.max(6, env.get('EMAIL_VERIFICATION_CODE_LENGTH') ?? 6))
    )
    const code = randomInt(0, 10 ** codeLength)
      .toString()
      .padStart(codeLength, '0')
    const validForMinutes = Math.max(1, env.get('EMAIL_VERIFICATION_CODE_TTL_MINUTES') ?? 10)

    user.emailVerificationCodeHash = await hash.make(code)
    user.emailVerificationExpiresAt = now.plus({ minutes: validForMinutes })
    user.emailVerificationSentAt = now
    user.emailVerificationAttempts = 0
    await user.save()

    try {
      const notification = await new NotificationService().sendEmailVerification(
        user.pendingEmail ?? user.email,
        code,
        validForMinutes,
        user.pendingEmail ? 'email_change' : 'signup'
      )

      if (!notification.delivered) {
        throw new EmailVerificationDeliveryError(notification.reason)
      }
    } catch (error) {
      user.emailVerificationCodeHash = null
      user.emailVerificationExpiresAt = null
      user.emailVerificationSentAt = null
      await user.save()

      if (error instanceof EmailVerificationDeliveryError) {
        throw error
      }
      throw new EmailVerificationDeliveryError('Nie udało się wysłać kodu aktywacyjnego.')
    }

    return { sent: true as const, retryAfterSeconds: 0 }
  }

  async verifyCode(user: User, code: string): Promise<VerificationResult> {
    const maxAttempts = Math.max(1, env.get('EMAIL_VERIFICATION_MAX_ATTEMPTS') ?? 5)

    if (user.emailVerificationAttempts >= maxAttempts) {
      return 'locked'
    }

    if (
      !user.emailVerificationCodeHash ||
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt < DateTime.now()
    ) {
      return 'expired'
    }

    const valid = await hash.verify(user.emailVerificationCodeHash, code)
    if (!valid) {
      user.emailVerificationAttempts += 1
      await user.save()
      return user.emailVerificationAttempts >= maxAttempts ? 'locked' : 'invalid'
    }

    try {
      return await db.transaction(async (trx) => {
        const current = await UserModel.query({ client: trx })
          .where('id', user.id)
          .forUpdate()
          .firstOrFail()
        if (
          current.emailVerificationCodeHash !== user.emailVerificationCodeHash ||
          !current.emailVerificationExpiresAt ||
          current.emailVerificationExpiresAt < DateTime.now()
        ) {
          return 'expired'
        }
        const pendingEmail = current.pendingEmail
        if (pendingEmail) {
          const occupied = await UserModel.query({ client: trx })
            .whereNot('id', user.id)
            .whereRaw('LOWER(TRIM(email)) = ?', [pendingEmail])
            .first()
          if (occupied) {
            return 'conflict'
          }
          current.email = pendingEmail
          current.pendingEmail = null
          current.emailVerifiedAt = DateTime.now()
          current.authVersion += 1
        } else {
          current.emailVerifiedAt = DateTime.now()
        }
        current.emailVerificationCodeHash = null
        current.emailVerificationExpiresAt = null
        current.emailVerificationSentAt = null
        current.emailVerificationAttempts = 0
        await current.save()
        if (pendingEmail) {
          await PasswordResetToken.query({ client: trx }).where('userId', user.id).delete()
          await PriceWatch.query({ client: trx })
            .where('userId', user.id)
            .update({ notificationDestination: current.email })
        }
        user.email = current.email
        user.pendingEmail = current.pendingEmail
        user.emailVerifiedAt = current.emailVerifiedAt
        user.authVersion = current.authVersion
        return pendingEmail ? 'email_changed' : 'verified'
      })
    } catch (error) {
      if (
        (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        (error as { code?: string }).code === '23505'
      ) {
        return 'conflict'
      }
      throw error
    }
  }
}
