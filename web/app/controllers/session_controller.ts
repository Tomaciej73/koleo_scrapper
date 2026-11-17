import User from '#models/user'
import { EMAIL_VERIFICATION_SESSION_KEY } from '#services/email_verification_service'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import RateLimitKeyService from '#services/rate_limit_key_service'
import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'

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
    return view.render('pages/auth/login')
  }

  /**
   * Authenticate user credentials and create a new session
   */
  async store({ request, auth, response, session }: HttpContext) {
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
    const [limitError, user] = await loginLimiter.penalize(() =>
      User.verifyCredentials(email, password)
    )
    if (limitError) {
      throw limitError.setMessage('Zbyt wiele nieudanych prób logowania. Spróbuj ponownie później.')
    }

    if (!user.emailVerifiedAt) {
      session.put(EMAIL_VERIFICATION_SESSION_KEY, user.id)
      session.flash('error', 'Najpierw potwierdź adres e-mail kodem aktywacyjnym.')
      return response.redirect().toRoute('email_verification.create')
    }

    await auth.use('web').login(user)
    return response.redirect().toRoute('dashboard')
  }

  /**
   * Log out the current user and destroy their session
   */
  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect().toRoute('session.create')
  }
}
