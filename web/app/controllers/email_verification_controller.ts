import User from '#models/user'
import EmailVerificationService, {
  EMAIL_VERIFICATION_SESSION_KEY,
  EmailVerificationDeliveryError,
} from '#services/email_verification_service'
import { emailVerificationValidator } from '#validators/user'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { AUTH_VERSION_SESSION_KEY } from '#services/auth_session_service'
import SecurityEventService from '#services/security_event_service'
import SessionManagementService from '#services/session_management_service'

export default class EmailVerificationController {
  async create({ session, response, view }: HttpContext) {
    const user = await this.getPendingUser(session.get(EMAIL_VERIFICATION_SESSION_KEY))
    if (!user) {
      session.forget(EMAIL_VERIFICATION_SESSION_KEY)
      return response.redirect().toRoute('new_account.create')
    }

    if (user.emailVerifiedAt) {
      session.forget(EMAIL_VERIFICATION_SESSION_KEY)
      return response.redirect().toRoute('session.create')
    }

    const codeLength = Math.trunc(
      Math.min(8, Math.max(6, env.get('EMAIL_VERIFICATION_CODE_LENGTH') ?? 6))
    )
    const cooldownSeconds = Math.max(1, env.get('EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS') ?? 60)
    const elapsedSeconds = user.emailVerificationSentAt
      ? DateTime.now().diff(user.emailVerificationSentAt, 'seconds').seconds
      : cooldownSeconds

    return view.render('pages/auth/verify_email', {
      email: this.maskEmail(user.email),
      codeIndexes: Array.from({ length: codeLength }, (_, index) => index),
      resendAfterSeconds: Math.max(0, Math.ceil(cooldownSeconds - elapsedSeconds)),
    })
  }

  async store({ request, session, response, auth, logger }: HttpContext) {
    const { code } = await request.validateUsing(emailVerificationValidator)
    const user = await this.getPendingUser(session.get(EMAIL_VERIFICATION_SESSION_KEY))
    if (!user) {
      session.forget(EMAIL_VERIFICATION_SESSION_KEY)
      return response.redirect().toRoute('new_account.create')
    }

    const result = await new EmailVerificationService().verifyCode(user, code)
    if (result === 'verified') {
      session.forget(EMAIL_VERIFICATION_SESSION_KEY)
      await auth.use('web').login(user)
      session.put(AUTH_VERSION_SESSION_KEY, user.authVersion)
      await new SessionManagementService().track(session, request, user.id)
      logger.info(
        {
          event: 'email_verification_succeeded',
          userId: user.id,
          ...SecurityEventService.requestContext(request),
        },
        'Potwierdzono adres e-mail użytkownika'
      )
      session.flash('success', 'Adres e-mail został potwierdzony. Konto jest aktywne.')
      return response.redirect().toRoute('dashboard')
    }

    const message =
      result === 'invalid'
        ? 'Kod jest nieprawidłowy.'
        : result === 'locked'
          ? 'Przekroczono limit prób. Wyślij nowy kod.'
          : 'Kod wygasł. Wyślij nowy kod.'

    logger.warn(
      {
        event: 'email_verification_failed',
        userId: user.id,
        result,
        ...SecurityEventService.requestContext(request),
      },
      'Nieudana próba potwierdzenia adresu e-mail'
    )

    session.flash('error', message)
    return response.redirect().toRoute('email_verification.create')
  }

  async resend({ request, session, response, logger }: HttpContext) {
    const user = await this.getPendingUser(session.get(EMAIL_VERIFICATION_SESSION_KEY))
    if (!user) {
      session.forget(EMAIL_VERIFICATION_SESSION_KEY)
      return response.redirect().toRoute('new_account.create')
    }

    try {
      const result = await new EmailVerificationService().issueCode(user, true)
      if (!result.sent) {
        session.flash(
          'error',
          `Poczekaj ${result.retryAfterSeconds} s przed wysłaniem kolejnego kodu.`
        )
      } else {
        logger.info(
          {
            event: 'email_verification_resent',
            userId: user.id,
            ...SecurityEventService.requestContext(request),
          },
          'Ponownie wysłano kod potwierdzający adres e-mail'
        )
        session.flash('success', 'Nowy kod aktywacyjny został wysłany.')
      }
    } catch (error) {
      logger.error({ err: error }, 'Ponowna wysyłka kodu weryfikacyjnego nie powiodła się')
      const message =
        error instanceof EmailVerificationDeliveryError
          ? error.message
          : 'Nie udało się wysłać nowego kodu.'
      session.flash('error', message)
    }

    return response.redirect().toRoute('email_verification.create')
  }

  private async getPendingUser(value: unknown) {
    const userId = Number(value)
    return Number.isSafeInteger(userId) && userId > 0 ? User.find(userId) : null
  }

  private maskEmail(email: string) {
    const [localPart, domain] = email.split('@')
    if (!localPart || !domain) {
      return email
    }

    const visible = localPart.slice(0, Math.min(2, localPart.length))
    return `${visible}${'*'.repeat(Math.max(2, localPart.length - visible.length))}@${domain}`
  }
}
