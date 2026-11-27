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
  async store({ request, auth, response, session, logger }: HttpContext) {
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

    await auth.use('web').login(user)
    session.put(AUTH_VERSION_SESSION_KEY, user.authVersion)
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
