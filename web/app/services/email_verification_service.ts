import type User from '#models/user'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import hash from '@adonisjs/core/services/hash'
import { randomInt } from 'node:crypto'
import { DateTime } from 'luxon'

export const EMAIL_VERIFICATION_SESSION_KEY = 'pendingEmailVerificationUserId'

export type VerificationResult = 'verified' | 'invalid' | 'expired' | 'locked'

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
        user.email,
        code,
        validForMinutes
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

    user.emailVerifiedAt = DateTime.now()
    user.emailVerificationCodeHash = null
    user.emailVerificationExpiresAt = null
    user.emailVerificationSentAt = null
    user.emailVerificationAttempts = 0
    await user.save()
    return 'verified'
  }
}
