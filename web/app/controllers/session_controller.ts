import User from '#models/user'
import { EMAIL_VERIFICATION_SESSION_KEY } from '#services/email_verification_service'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import RateLimitKeyService from '#services/rate_limit_key_service'
import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'
import { AUTH_VERSION_SESSION_KEY } from '#services/auth_session_service'
import { errors as authErrors } from '@adonisjs/auth'
import SecurityEventService from '#services/security_event_service'
import SessionManagementService from '#services/session_management_service'
import LoginSecurityService from '#services/login_security_service'

/**
 * SessionController handles user authentication and session management.
 * It provides methods for displaying the login page, authenticating users,
 * and logging out.
 */
export default class SessionController {
  /**
   * Display the login page
   */
  async create({ view }: HttpContext) {
    return view.render('pages/auth/login', {
      emailMaxLength: env.get('EMAIL_MAX_LENGTH'),
      passwordMaxLength: env.get('PASSWORD_MAX_LENGTH'),
    })
  }

  /**
   * Authenticate user credentials and create a new session
   */
  async store(ctx: HttpContext) {
    const { request, response, session, logger } = ctx
    const { email, password } = await request.validateUsing(loginValidator)
    const loginLimiter = limiter.multi([
      {
        key: `login:ip:${request.ip()}`,
        requests: env.get('RATE_LIMIT_LOGIN_FAILURES'),
        duration: env.get('RATE_LIMIT_AUTH_WINDOW_SECONDS'),
        blockDuration: env.get('RATE_LIMIT_BLOCK_SECONDS'),
      },
      {
        key: RateLimitKeyService.email('login', email),
        requests: env.get('RATE_LIMIT_LOGIN_FAILURES'),
        duration: env.get('RATE_LIMIT_AUTH_WINDOW_SECONDS'),
        blockDuration: env.get('RATE_LIMIT_BLOCK_SECONDS'),
      },
    ])
    let user: User
    try {
      const [limitError, verifiedUser] = await loginLimiter.penalize(() =>
        User.verifyCredentials(email, password)
      )
      if (limitError) {
        logger.warn(
          {
            event: 'auth_login_rate_limited',
            emailHash: SecurityEventService.emailHash(email),
            ...SecurityEventService.requestContext(request),
          },
          'Zablokowano logowanie po przekroczeniu limitu prób'
        )
        throw limitError.setMessage(
          'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie później.'
        )
      }
      if (!verifiedUser) {
        throw new authErrors.E_INVALID_CREDENTIALS('Nieprawidłowe dane logowania')
      }
      user = verifiedUser
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        logger.warn(
          {
            event: 'auth_login_failed',
            emailHash: SecurityEventService.emailHash(email),
            ...SecurityEventService.requestContext(request),
          },
          'Nieudana próba logowania'
        )
        session.flash('error', 'Nieprawidłowy adres e-mail lub hasło.')
        return response.redirect().back()
      }
      throw error
    }

    if (env.get('NEW_DEVICE_CHALLENGE_ENABLED') && !session.supportsTagging()) {
      logger.error(
        { event: 'auth_login_session_store_unsupported' },
        'Potwierdzanie nowych przeglądarek wymaga bazodanowego magazynu sesji'
      )
      session.flash(
        'error',
        'Logowanie jest chwilowo niedostępne. Skontaktuj się z administratorem.'
      )
      return response.redirect().toRoute('session.create')
    }

    if (!user.emailVerifiedAt) {
      logger.warn(
        {
          event: 'auth_login_unverified_email',
          userId: user.id,
          ...SecurityEventService.requestContext(request),
        },
        'Odrzucono logowanie do niepotwierdzonego konta'
      )
      session.put(EMAIL_VERIFICATION_SESSION_KEY, user.id)
      session.flash('error', 'Najpierw potwierdź adres e-mail kodem aktywacyjnym.')
      return response.redirect().toRoute('email_verification.create')
    }

    const loginSecurity = new LoginSecurityService()
    const trusted = await loginSecurity.trustedDevice(request, user.id)
    const challengeMethod = user.totpSecret
      ? 'totp'
      : !trusted && env.get('NEW_DEVICE_CHALLENGE_ENABLED')
        ? 'email'
        : null
    if (challengeMethod) {
      if (challengeMethod === 'email' && !(env.get('MAIL_ENABLED') ?? false)) {
        logger.error(
          { event: 'auth_login_mail_unavailable', userId: user.id },
          'Kod logowania jest wymagany, ale wysyłka e-mail jest wyłączona'
        )
        session.flash(
          'error',
          'Potwierdzenie logowania jest chwilowo niedostępne. Spróbuj ponownie później.'
        )
        return response.redirect().toRoute('session.create')
      }
      session.regenerate()
      if (challengeMethod === 'email') {
        await loginSecurity.consumeAccountLimit(user.id, 'delivery')
      }
      try {
        await loginSecurity.begin(ctx, user, challengeMethod)
      } catch (error) {
        logger.error(
          { err: error, event: 'auth_login_code_delivery_failed', userId: user.id },
          'Nie udało się wysłać kodu logowania'
        )
        session.flash('error', 'Nie udało się wysłać kodu logowania. Spróbuj ponownie później.')
        return response.redirect().toRoute('session.create')
      }
      logger.info(
        {
          event: 'auth_login_challenge_started',
          userId: user.id,
          method: challengeMethod,
          ...SecurityEventService.requestContext(request),
        },
        'Rozpoczęto potwierdzanie logowania'
      )
      return response.redirect().toRoute('login_challenge.create')
    }

    return this.completeLogin(ctx, user, trusted?.id ?? null, !trusted)
  }

  async completeLogin(
    ctx: HttpContext,
    user: User,
    trustedDeviceId: number | null,
    newDevice: boolean
  ) {
    const { request, auth, response, session, logger } = ctx
    session.regenerate()
    await auth.use('web').login(user)
    session.put(AUTH_VERSION_SESSION_KEY, user.authVersion)
    const loginSecurity = new LoginSecurityService()
    const deviceId = trustedDeviceId ?? (await loginSecurity.rememberDevice(ctx, user.id))
    session.put('trustedDeviceId', deviceId)
    await new SessionManagementService().track(session, request, user.id)
    const includePersonalData = env.get('AUDIT_LOG_PERSONAL_DATA') ?? false
    const emailForLog = SecurityEventService.emailForLog(user.email, includePersonalData)
    logger.info(
      {
        event: 'auth_login_succeeded',
        userId: user.id,
        emailHash: SecurityEventService.emailHash(user.email),
        ...(includePersonalData ? { email: emailForLog } : {}),
        ...SecurityEventService.requestContext(request),
      },
      `Użytkownik #${user.id} (${emailForLog}) zalogował się`
    )
    if (newDevice && session.supportsTagging()) {
      try {
        await loginSecurity.sendNewLoginAlert(user, session.sessionId, deviceId, request)
      } catch (error) {
        logger.error(
          { err: error, event: 'auth_new_device_notice_failed', userId: user.id },
          'Nie udało się wysłać alertu o nowej przeglądarce'
        )
      }
    }
    if (user.pendingEmail) {
      session.put(EMAIL_VERIFICATION_SESSION_KEY, user.id)
      return response.redirect().toRoute('email_verification.create')
    }
    return response.redirect().toRoute('dashboard')
  }

  /**
   * Log out the current user and destroy their session
   */
  async destroy({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.user
    if (user) {
      const includePersonalData = env.get('AUDIT_LOG_PERSONAL_DATA') ?? false
      const emailForLog = SecurityEventService.emailForLog(user.email, includePersonalData)
      logger.info(
        {
          event: 'auth_logout',
          userId: user.id,
          emailHash: SecurityEventService.emailHash(user.email),
          ...(includePersonalData ? { email: emailForLog } : {}),
          ...SecurityEventService.requestContext(request),
        },
        `Użytkownik #${user.id} (${emailForLog}) wylogował się`
      )
      if (session.supportsTagging()) {
        await session.untag(String(user.id))
      }
    }
    await auth.use('web').logout()
    session.clear()
    return response.redirect().toRoute('session.create')
  }
}
