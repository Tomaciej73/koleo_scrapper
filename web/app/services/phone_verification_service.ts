import User from '#models/user'
import SmsGatewayService from '#services/sms_gateway_service'
import env from '#start/env'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { randomInt, randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

export default class PhoneVerificationService {
  async request(user: User, phoneNumber: string) {
    const now = DateTime.utc()
    const existing = await db.from('phone_verifications').where('user_id', user.id).first()
    const cooldown = env.get('SMS_VERIFICATION_RESEND_COOLDOWN_SECONDS') ?? 60
    if (existing) {
      const elapsed = now.diff(
        DateTime.fromSQL(existing.sent_at, { zone: 'utc' }),
        'seconds'
      ).seconds
      if (elapsed < cooldown)
        return { sent: false, retryAfterSeconds: Math.ceil(cooldown - elapsed) }
    }
    const length = Math.trunc(env.get('SMS_VERIFICATION_CODE_LENGTH') ?? 6)
    if (length < 6 || length > 8) {
      throw new Error('SMS_VERIFICATION_CODE_LENGTH musi mieć wartość od 6 do 8.')
    }
    const code = randomInt(0, 10 ** length)
      .toString()
      .padStart(length, '0')
    const codeHash = await hash.make(code)
    const expiresAt = now.plus({ minutes: env.get('SMS_VERIFICATION_TTL_MINUTES') ?? 10 })
    await db.from('phone_verifications').where('user_id', user.id).delete()
    await db.table('phone_verifications').insert({
      user_id: user.id,
      phone_number: phoneNumber,
      code_hash: codeHash,
      expires_at: expiresAt.toSQL(),
      sent_at: now.toSQL(),
      attempts: 0,
    })
    await new SmsGatewayService().send(
      phoneNumber,
      `Koleo Watch: kod potwierdzenia numeru ${code}. Wazny ${env.get('SMS_VERIFICATION_TTL_MINUTES') ?? 10} min. Jesli nie prosiles o kod, zignoruj SMS.`,
      randomUUID()
    )
    return { sent: true, retryAfterSeconds: 0 }
  }

  async verify(
    user: User,
    code: string
  ): Promise<'verified' | 'invalid' | 'expired' | 'locked' | 'conflict'> {
    return db.transaction(async (trx) => {
      const pending = await trx
        .from('phone_verifications')
        .where('user_id', user.id)
        .forUpdate()
        .first()
      if (!pending || DateTime.fromSQL(pending.expires_at, { zone: 'utc' }) <= DateTime.utc())
        return 'expired'
      const maxAttempts = env.get('SMS_VERIFICATION_MAX_ATTEMPTS') ?? 5
      if (pending.attempts >= maxAttempts) return 'locked'
      if (!(await hash.verify(pending.code_hash, code))) {
        await trx
          .from('phone_verifications')
          .where('user_id', user.id)
          .update({ attempts: pending.attempts + 1 })
        return pending.attempts + 1 >= maxAttempts ? 'locked' : 'invalid'
      }
      const occupied = await User.query({ client: trx })
        .where('phoneNumber', pending.phone_number)
        .whereNot('id', user.id)
        .first()
      if (occupied) return 'conflict'
      const current = await User.query({ client: trx })
        .where('id', user.id)
        .forUpdate()
        .firstOrFail()
      current.phoneNumber = pending.phone_number
      current.phoneVerifiedAt = DateTime.utc()
      await current.save()
      await trx.from('phone_verifications').where('user_id', user.id).delete()
      return 'verified'
    })
  }

  async pending(userId: number) {
    return db.from('phone_verifications').where('user_id', userId).first()
  }
}
