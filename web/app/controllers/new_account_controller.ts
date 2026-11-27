import User from '#models/user'
import EmailVerificationService, {
  EMAIL_VERIFICATION_SESSION_KEY,
} from '#services/email_verification_service'
import { signupValidator } from '#validators/user'
import RateLimitKeyService from '#services/rate_limit_key_service'
import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'
import SecurityEventService from '#services/security_event_service'

/**
 * NewAccountController handles user registration.
 * It provides methods for displaying the signup page and creating
 * new user accounts.
 */
export default class NewAccountController {
  /**
   * Display the signup page
   */
  async create({ view }: HttpContext) {
    return view.render('pages/auth/signup', {
      passwordMinLength: env.get('PASSWORD_MIN_LENGTH'),
      passwordMaxLength: env.get('PASSWORD_MAX_LENGTH'),
      emailMaxLength: env.get('EMAIL_MAX_LENGTH'),
      fullNameMaxLength: env.get('FULL_NAME_MAX_LENGTH'),
    })
  }

  /**
   * Create a new user account and send its activation code
   */
  async store({ request, response, session, logger }: HttpContext) {
    const { fullName, email, password } = await request.validateUsing(signupValidator)
    const registrationLimiter = limiter.use({
      requests: env.get('RATE_LIMIT_OTP_REQUESTS'),
      duration: env.get('RATE_LIMIT_AUTH_WINDOW_SECONDS'),
      blockDuration: env.get('RATE_LIMIT_BLOCK_SECONDS'),
    })
    await registrationLimiter.consume(RateLimitKeyService.email('signup', email))

    if (await User.query().whereRaw('LOWER(TRIM(pending_email)) = ?', [email]).first()) {
      session.flashInputErrors({ email: 'Nie można użyć tego adresu e-mail.' })
      return response.redirect().back()
    }

    const user = await User.create({ fullName, email, password })
    session.put(EMAIL_VERIFICATION_SESSION_KEY, user.id)

    try {
      await new EmailVerificationService().issueCode(user)
      logger.info(
        {
          event: 'account_registered',
          userId: user.id,
          emailHash: SecurityEventService.emailHash(user.email),
          ...SecurityEventService.requestContext(request),
        },
        'Utworzono nowe konto oczekujące na potwierdzenie'
      )
      session.flash('success', 'Wysłaliśmy kod aktywacyjny na podany adres e-mail.')
      return response.redirect().toRoute('email_verification.create')
    } catch (error) {
      logger.error({ err: error }, 'Nie udało się wysłać wiadomości weryfikującej adres e-mail')
      session.forget(EMAIL_VERIFICATION_SESSION_KEY)
      await user.delete()
      session.flash(
        'error',
        'Nie udało się wysłać kodu aktywacyjnego. Sprawdź konfigurację SMTP i spróbuj ponownie.'
      )
      return response.redirect().back()
    }
  }
}
