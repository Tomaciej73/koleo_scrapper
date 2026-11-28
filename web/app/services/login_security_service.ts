import User from '#models/user'
import SecurityEventService from '#services/security_event_service'
import NotificationService from '#services/notification_service'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import encryption from '@adonisjs/core/services/encryption'
import type { HttpContext } from '@adonisjs/core/http'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { DateTime } from 'luxon'

export const PENDING_LOGIN_CHALLENGE_KEY = 'pendingLoginChallengeId'
const ALERT_ENCRYPTION_PURPOSE = 'new-login-alert-session'

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export default class LoginSecurityService {
  async consumeAccountLimit(userId: number, purpose: 'delivery' | 'verification') {
    const accountLimiter = limiter.use({
      requests: env.get('RATE_LIMIT_OTP_REQUESTS'),
      duration: env.get('RATE_LIMIT_AUTH_WINDOW_SECONDS'),
      blockDuration: env.get('RATE_LIMIT_BLOCK_SECONDS'),
    })
    await accountLimiter.consume(`login-${purpose}:user:${userId}`)
  }

  async trustedDevice(request: HttpContext['request'], userId: number) {
    const token = request.encryptedCookie(env.get('LOGIN_TRUSTED_COOKIE_NAME'))
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
    const device = await db
      .from('trusted_devices')
      .where('user_id', userId)
      .where('token_hash', digest(token))
      .where(
        'last_used_at',
        '>',
        DateTime.utc()
          .minus({ days: env.get('LOGIN_TRUSTED_DAYS') })
          .toSQL()!
      )
      .first()
    if (device) {
      await db
        .from('trusted_devices')
        .where('id', device.id)
        .update({ last_used_at: DateTime.utc().toSQL() })
    }
    return device ?? null
  }

  async rememberDevice(ctx: Pick<HttpContext, 'request' | 'response' | 'session'>, userId: number) {
    const token = randomBytes(32).toString('hex')
    const userAgent = SecurityEventService.safeText(
      ctx.request.header('user-agent') ?? 'Nieznana przeglądarka',
      200
    )
    const [id] = await db
      .table('trusted_devices')
      .insert({
        user_id: userId,
        token_hash: digest(token),
        user_agent: userAgent,
        created_at: DateTime.utc().toSQL(),
        last_used_at: DateTime.utc().toSQL(),
      })
      .returning('id')
    ctx.response.encryptedCookie(env.get('LOGIN_TRUSTED_COOKIE_NAME'), token, {
      httpOnly: true,
      secure: app.inProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: `${env.get('LOGIN_TRUSTED_DAYS')}d`,
    })
    const deviceId = typeof id === 'number' ? id : id.id
    ctx.session.put('trustedDeviceId', deviceId)
    return deviceId as number
  }

  async begin(ctx: Pick<HttpContext, 'session'>, user: User, method: 'email' | 'totp') {
    const sessionHash = digest(ctx.session.sessionId)
    await db.from('login_challenges').where('session_hash', sessionHash).delete()
    const codeLength = env.get('LOGIN_EMAIL_CODE_LENGTH')
    const code =
      method === 'email' ? String(randomInt(10 ** codeLength)).padStart(codeLength, '0') : null
    const expiresAt = DateTime.utc().plus({ minutes: env.get('LOGIN_CHALLENGE_TTL_MINUTES') })
    const [row] = await db
      .table('login_challenges')
      .insert({
        user_id: user.id,
        session_hash: sessionHash,
        auth_version: user.authVersion,
        method,
        code_hash: code ? await hash.make(code) : null,
        attempts: 0,
        expires_at: expiresAt.toSQL(),
        sent_at: null,
        created_at: DateTime.utc().toSQL(),
      })
      .returning('id')
    const id = typeof row === 'number' ? row : row.id
    ctx.session.put(PENDING_LOGIN_CHALLENGE_KEY, id)
    if (code) {
      try {
        const sent = await new NotificationService().sendLoginCode(
          user.email,
          code,
          env.get('LOGIN_CHALLENGE_TTL_MINUTES')
        )
        if (!sent.delivered) throw new Error('Wysyłka kodu logowania jest niedostępna')
        await db
          .from('login_challenges')
          .where('id', id)
          .update({ sent_at: DateTime.utc().toSQL() })
      } catch (error) {
        await db.from('login_challenges').where('id', id).delete()
        ctx.session.forget(PENDING_LOGIN_CHALLENGE_KEY)
        throw error
      }
    }
    return id as number
  }

  async pending(ctx: Pick<HttpContext, 'session'>) {
    const id = Number(ctx.session.get(PENDING_LOGIN_CHALLENGE_KEY))
    if (!Number.isSafeInteger(id) || id <= 0) return null
    const challenge = await db
      .from('login_challenges')
      .where('id', id)
      .where('session_hash', digest(ctx.session.sessionId))
      .where('expires_at', '>', DateTime.utc().toSQL()!)
      .first()
    if (!challenge || challenge.attempts >= env.get('LOGIN_CHALLENGE_MAX_ATTEMPTS')) return null
    return challenge as {
      id: number
      user_id: number
      auth_version: number
      method: 'email' | 'totp'
      code_hash: string | null
      attempts: number
      sent_at: string | null
    }
  }

  async verify(ctx: Pick<HttpContext, 'session'>, code: string) {
    const challenge = await this.pending(ctx)
    if (!challenge) return null
    const user = await User.find(challenge.user_id)
    if (!user || !user.emailVerifiedAt) return null
    if (
      user.authVersion !== challenge.auth_version ||
      Boolean(user.totpSecret) !== (challenge.method === 'totp')
    ) {
      await db.from('login_challenges').where('id', challenge.id).delete()
      ctx.session.forget(PENDING_LOGIN_CHALLENGE_KEY)
      return null
    }
    let valid = false
    if (challenge.method === 'email' && challenge.code_hash) {
      valid = await hash.verify(challenge.code_hash, code)
    } else if (challenge.method === 'totp') {
      const { default: TotpService } = await import('#services/totp_service')
      const totp = new TotpService()
      valid = (await totp.consume(user, code)) || (await totp.consumeRecovery(user, code))
    }
    if (!valid) {
      await db.from('login_challenges').where('id', challenge.id).increment('attempts', 1)
      return null
    }
    const deleted = await db
      .from('login_challenges')
      .where('id', challenge.id)
      .where('attempts', '<', env.get('LOGIN_CHALLENGE_MAX_ATTEMPTS'))
      .delete()
    if (!deleted) return null
    ctx.session.forget(PENDING_LOGIN_CHALLENGE_KEY)
    return user
  }

  async resend(ctx: Pick<HttpContext, 'session'>) {
    const challenge = await this.pending(ctx)
    if (!challenge || challenge.method !== 'email') return 'missing' as const
    const cooldownSeconds = env.get('EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS') ?? 60
    if (
      challenge.sent_at &&
      DateTime.utc().diff(DateTime.fromSQL(challenge.sent_at, { zone: 'utc' }), 'seconds').seconds <
        cooldownSeconds
    ) {
      return 'cooldown' as const
    }
    const user = await User.find(challenge.user_id)
    if (!user) return 'missing' as const
    const length = env.get('LOGIN_EMAIL_CODE_LENGTH')
    const code = String(randomInt(10 ** length)).padStart(length, '0')
    await db
      .from('login_challenges')
      .where('id', challenge.id)
      .update({
        code_hash: await hash.make(code),
        attempts: 0,
        expires_at: DateTime.utc()
          .plus({ minutes: env.get('LOGIN_CHALLENGE_TTL_MINUTES') })
          .toSQL(),
        sent_at: DateTime.utc().toSQL(),
      })
    try {
      await new NotificationService().sendLoginCode(
        user.email,
        code,
        env.get('LOGIN_CHALLENGE_TTL_MINUTES')
      )
    } catch (error) {
      await db.from('login_challenges').where('id', challenge.id).delete()
      ctx.session.forget(PENDING_LOGIN_CHALLENGE_KEY)
      throw error
    }
    return 'sent' as const
  }

  async sendNewLoginAlert(
    user: User,
    sessionId: string,
    deviceId: number,
    request: HttpContext['request']
  ) {
    if (!(env.get('MAIL_ENABLED') ?? false)) return
    const token = randomBytes(32).toString('hex')
    await db.table('login_alert_tokens').insert({
      user_id: user.id,
      token_hash: digest(token),
      encrypted_session_id: encryption.encrypt(sessionId, undefined, ALERT_ENCRYPTION_PURPOSE),
      trusted_device_id: deviceId,
      expires_at: DateTime.utc()
        .plus({ minutes: env.get('LOGIN_ALERT_ACTION_TTL_MINUTES') })
        .toSQL(),
      created_at: DateTime.utc().toSQL(),
    })
    const url = new URL('/login-alert/revoke', env.get('APP_URL'))
    url.searchParams.set('token', token)
    await new NotificationService().sendNewLoginAlert(
      user.email,
      SecurityEventService.safeText(request.header('user-agent') ?? 'Nieznana przeglądarka', 160),
      url.toString(),
      env.get('LOGIN_ALERT_ACTION_TTL_MINUTES')
    )
  }

  async validAlert(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return false
    return Boolean(
      await db
        .from('login_alert_tokens')
        .where('token_hash', digest(token))
        .where('expires_at', '>', DateTime.utc().toSQL()!)
        .first()
    )
  }

  async revokeAlert(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null
    const row = await db
      .from('login_alert_tokens')
      .where('token_hash', digest(token))
      .where('expires_at', '>', DateTime.utc().toSQL()!)
      .first()
    if (!row) return null
    const sessionId = encryption.decrypt<string>(row.encrypted_session_id, ALERT_ENCRYPTION_PURPOSE)
    if (!sessionId) return null
    const { default: SessionManagementService } =
      await import('#services/session_management_service')
    await new SessionManagementService().destroyOwned(row.user_id, sessionId)
    const consumed = await db.transaction(async (trx) => {
      const deleted = await trx
        .from('login_alert_tokens')
        .where('id', row.id)
        .where('token_hash', digest(token))
        .delete()
      if (!deleted) return false
      if (row.trusted_device_id) {
        await trx
          .from('trusted_devices')
          .where('id', row.trusted_device_id)
          .where('user_id', row.user_id)
          .delete()
      }
      return true
    })
    return consumed ? sessionId : null
  }

  async forgetAllDevices(userId: number) {
    await db.from('trusted_devices').where('user_id', userId).delete()
  }

  async forgetDevice(userId: number, deviceId: number) {
    await db.from('trusted_devices').where('user_id', userId).where('id', deviceId).delete()
  }
}
