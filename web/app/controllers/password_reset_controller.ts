import PasswordResetService from '#services/password_reset_service'
import RateLimitKeyService from '#services/rate_limit_key_service'
import { forgotPasswordValidator, passwordResetValidator } from '#validators/user'
import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'

export default class PasswordResetController {
  async create({ view }: HttpContext) {
    return view.render('pages/auth/forgot_password')
  }

  async store({ request, response, session, logger }: HttpContext) {
    const { email } = await request.validateUsing(forgotPasswordValidator)
    const accountLimiter = limiter.use({
      requests: env.get('RATE_LIMIT_PASSWORD_RESET_REQUESTS'),
      duration: env.get('RATE_LIMIT_AUTH_WINDOW_SECONDS'),
      blockDuration: env.get('RATE_LIMIT_BLOCK_SECONDS'),
    })
    await accountLimiter.consume(RateLimitKeyService.email('password-reset', email))

    try {
      await new PasswordResetService().request(email)
    } catch (error) {
      logger.error({ err: error }, 'Nie udało się zlecić wysyłki wiadomości resetującej hasło')
    }

    session.flash(
      'success',
      'Jeżeli konto z tym adresem istnieje, wysłaliśmy instrukcję resetu hasła.'
    )
    return response.redirect().toRoute('password_reset.create')
  }

  async edit({ view }: HttpContext) {
    return view.render('pages/auth/reset_password', {
      passwordMinLength: env.get('PASSWORD_MIN_LENGTH'),
      passwordMaxLength: env.get('PASSWORD_MAX_LENGTH'),
    })
  }

  async update({ request, response, session }: HttpContext) {
    const { token, password } = await request.validateUsing(passwordResetValidator)
    const result = await new PasswordResetService().reset(token, password)
    if (result === 'invalid') {
      session.flash('error', 'Link resetujący jest nieprawidłowy lub wygasł.')
      return response.redirect().toRoute('password_reset.create')
    }

    session.flash('success', 'Hasło zostało zmienione. Zaloguj się ponownie.')
    return response.redirect().toRoute('session.create')
  }
}
