import LoginSecurityService, { PENDING_LOGIN_CHALLENGE_KEY } from '#services/login_security_service'
import SessionController from '#controllers/session_controller'
import SecurityEventService from '#services/security_event_service'
import User from '#models/user'
import { loginChallengeCodeValidator } from '#validators/user'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'

export default class LoginChallengeController {
  async create({ session, response, view, auth }: HttpContext) {
    if (await auth.check()) {
      session.forget(PENDING_LOGIN_CHALLENGE_KEY)
      return response.redirect().toRoute('dashboard')
    }
    const challenge = await new LoginSecurityService().pending({ session })
    if (!challenge) {
      session.forget(PENDING_LOGIN_CHALLENGE_KEY)
      return response.redirect().toRoute('session.create')
    }
    const user = await User.find(challenge.user_id)
    if (!user) return response.redirect().toRoute('session.create')
    return view.render('pages/auth/login_challenge', {
      method: challenge.method,
      maskedEmail: SecurityEventService.emailForLog(user.email, false),
      codeLength:
        challenge.method === 'email'
          ? env.get('LOGIN_EMAIL_CODE_LENGTH')
          : env.get('LOGIN_TOTP_DIGITS'),
    })
  }

  async store(ctx: HttpContext) {
    const { request, session, response, logger, auth } = ctx
    if (await auth.check()) return response.redirect().toRoute('dashboard')
    const { code } = await request.validateUsing(loginChallengeCodeValidator)
    const service = new LoginSecurityService()
    const challenge = await service.pending(ctx)
    if (!challenge) {
      session.forget(PENDING_LOGIN_CHALLENGE_KEY)
      session.flash('error', 'Potwierdzenie logowania wygasło. Zaloguj się ponownie.')
      return response.redirect().toRoute('session.create')
    }
    await service.consumeAccountLimit(challenge.user_id, 'verification')
    const user = await service.verify(ctx, code)
    if (!user) {
      logger.warn(
        {
          event: 'auth_login_challenge_failed',
          userId: challenge.user_id,
          method: challenge.method,
          ...SecurityEventService.requestContext(request),
        },
        'Nieprawidłowy kod logowania'
      )
      session.flash('error', 'Nieprawidłowy lub wykorzystany kod. Sprawdź go i spróbuj ponownie.')
      return response.redirect().toRoute('login_challenge.create')
    }
    const trusted = await service.trustedDevice(request, user.id)
    logger.info(
      {
        event: 'auth_login_challenge_succeeded',
        userId: user.id,
        method: challenge.method,
        ...SecurityEventService.requestContext(request),
      },
      'Potwierdzono logowanie'
    )
    return new SessionController().completeLogin(ctx, user, trusted?.id ?? null, !trusted)
  }

  async resend({ session, response, logger }: HttpContext) {
    const service = new LoginSecurityService()
    const challenge = await service.pending({ session })
    if (challenge) await service.consumeAccountLimit(challenge.user_id, 'delivery')
    try {
      const result = await service.resend({ session })
      session.flash(
        result === 'sent' ? 'success' : 'error',
        result === 'sent'
          ? 'Wysłaliśmy nowy kod logowania.'
          : result === 'cooldown'
            ? 'Poczekaj przed wysłaniem kolejnego kodu.'
            : 'Zaloguj się ponownie.'
      )
    } catch (error) {
      logger.error(
        { err: error, event: 'auth_login_code_resend_failed' },
        'Nie udało się ponownie wysłać kodu logowania'
      )
      session.flash('error', 'Nie udało się wysłać nowego kodu.')
    }
    return response.redirect().toRoute('login_challenge.create')
  }

  async cancel({ session, response }: HttpContext) {
    session.forget(PENDING_LOGIN_CHALLENGE_KEY)
    return response.redirect().toRoute('session.create')
  }

  async revokePage({ request, response, view }: HttpContext) {
    response.header('Cache-Control', 'no-store')
    response.header('Referrer-Policy', 'no-referrer')
    const token = String(request.input('token', ''))
    if (!(await new LoginSecurityService().validAlert(token))) {
      return response.status(404).send('Link jest nieprawidłowy lub wygasł.')
    }
    return view.render('pages/auth/revoke_login', { token })
  }

  async revoke({ request, response, session, auth, logger }: HttpContext) {
    const token = String(request.input('token', ''))
    const revokedSessionId = await new LoginSecurityService().revokeAlert(token)
    if (!revokedSessionId) {
      session.flash('error', 'Link jest nieprawidłowy lub wygasł.')
    } else {
      logger.warn(
        {
          event: 'auth_new_device_session_revoked',
          ...SecurityEventService.requestContext(request),
        },
        'Unieważniono sesję po alercie e-mail'
      )
      if (session.sessionId === revokedSessionId && (await auth.check())) {
        await auth.use('web').logout()
        session.clear()
      }
      session.flash(
        'success',
        'Sesja została unieważniona. Jeśli nie rozpoznajesz logowania, zmień hasło.'
      )
    }
    return response.redirect().toRoute('session.create')
  }
}
