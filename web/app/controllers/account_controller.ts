import PriceObservation from '#models/price_observation'
import PriceWatch from '#models/price_watch'
import User from '#models/user'
import EmailVerificationService, {
  EMAIL_VERIFICATION_SESSION_KEY,
} from '#services/email_verification_service'
import SecurityEventService from '#services/security_event_service'
import SessionManagementService from '#services/session_management_service'
import {
  accountDeleteValidator,
  accountEmailValidator,
  sessionRevocationValidator,
} from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { DateTime } from 'luxon'

export default class AccountController {
  async index({ auth, session, view }: HttpContext) {
    const user = auth.getUserOrFail()
    const sessionService = new SessionManagementService()
    const sessions = await sessionService.list(user.id, session.sessionId)
    if (!sessions.some((item) => item.current)) {
      sessions.unshift(sessionService.describeCurrent(session))
    }
    return view.render('pages/settings/account', {
      user,
      sessions: sessions.map((item) => ({
        ...item,
        createdAtLabel: this.dateLabel(item.createdAt),
        lastSeenAtLabel: this.dateLabel(item.lastSeenAt),
      })),
      sessionTrackingAvailable: session.supportsTagging(),
    })
  }

  async export({ auth, request, response, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    const watches = await PriceWatch.query().where('userId', user.id).orderBy('id', 'asc')
    const observations = watches.length
      ? await PriceObservation.query()
          .whereIn(
            'priceWatchId',
            watches.map((watch) => watch.id)
          )
          .orderBy('observedAt', 'asc')
      : []
    logger.info(
      {
        event: 'account_data_exported',
        userId: user.id,
        ...SecurityEventService.requestContext(request),
      },
      'Użytkownik wyeksportował swoje dane'
    )

    response.header(
      'content-disposition',
      `attachment; filename="koleo-watch-export-${DateTime.utc().toISODate()}.json"`
    )
    response.type('application/json')
    return response.send({
      exportedAt: DateTime.utc().toISO(),
      account: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
        createdAt: user.createdAt.toISO(),
        updatedAt: user.updatedAt?.toISO() ?? null,
      },
      priceWatches: watches.map((watch) => watch.serialize()),
      priceObservations: observations.map((observation) => observation.serialize()),
    })
  }

  async updateEmail({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    const { email, currentPassword } = await request.validateUsing(accountEmailValidator)
    const normalizedEmail = email.trim().toLocaleLowerCase('en-US')
    if (!(await this.credentialsValid(user, currentPassword))) {
      session.flash('error', 'Aktualne hasło jest nieprawidłowe.')
      return response.redirect().back()
    }
    if (normalizedEmail === user.email) {
      session.flash('info', 'To jest już aktualny adres e-mail konta.')
      return response.redirect().back()
    }
    if (await User.query().whereRaw('LOWER(TRIM(email)) = ?', [normalizedEmail]).first()) {
      session.flash('error', 'Nie można użyć tego adresu e-mail.')
      return response.redirect().back()
    }

    const previousEmailHash = SecurityEventService.emailHash(user.email)
    user.email = normalizedEmail
    user.emailVerifiedAt = null
    user.emailVerificationCodeHash = null
    user.emailVerificationExpiresAt = null
    user.emailVerificationSentAt = null
    user.emailVerificationAttempts = 0
    user.authVersion += 1
    await user.save()

    const sessions = new SessionManagementService()
    await sessions.destroyOthers(user.id, session.sessionId)
    if (session.supportsTagging()) {
      await session.untag(String(user.id))
    }
    await auth.use('web').logout()
    session.put(EMAIL_VERIFICATION_SESSION_KEY, user.id)

    try {
      await new EmailVerificationService().issueCode(user)
      session.flash('success', 'Wysłaliśmy kod potwierdzający na nowy adres e-mail.')
    } catch (error) {
      logger.error(
        { err: error, event: 'account_email_verification_delivery_failed', userId: user.id },
        'Zmiana adresu e-mail została zapisana, ale wysyłka kodu nie powiodła się'
      )
      session.flash(
        'error',
        'Adres został zmieniony, ale nie udało się wysłać kodu. Wyślij go ponownie.'
      )
    }
    logger.info(
      {
        event: 'account_email_changed',
        userId: user.id,
        previousEmailHash,
        emailHash: SecurityEventService.emailHash(user.email),
        ...SecurityEventService.requestContext(request),
      },
      'Użytkownik zmienił adres e-mail'
    )
    return response.redirect().toRoute('email_verification.create')
  }

  async destroy({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    const { password, confirmation } = await request.validateUsing(accountDeleteValidator)
    if (confirmation !== 'USUŃ' || !(await this.credentialsValid(user, password))) {
      session.flash('error', 'Nieprawidłowe hasło lub potwierdzenie usunięcia konta.')
      return response.redirect().back()
    }

    logger.warn(
      {
        event: 'account_deleted',
        userId: user.id,
        emailHash: SecurityEventService.emailHash(user.email),
        ...SecurityEventService.requestContext(request),
      },
      'Użytkownik usunął konto'
    )
    await new SessionManagementService().destroyAll(user.id)
    await auth.use('web').logout()
    await user.delete()
    session.clear()
    return response.redirect().toRoute('home')
  }

  async revokeSession({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    const { sessionId } = await request.validateUsing(sessionRevocationValidator)
    const removed = await new SessionManagementService().destroyOwned(user.id, sessionId)
    if (!removed) {
      session.flash('error', 'Nie znaleziono wskazanej sesji.')
      return response.redirect().back()
    }

    logger.info(
      {
        event: 'account_session_revoked',
        userId: user.id,
        sessionIdHash: SecurityEventService.hash(sessionId),
        ...SecurityEventService.requestContext(request),
      },
      'Użytkownik unieważnił sesję'
    )
    if (sessionId === session.sessionId) {
      await auth.use('web').logout()
      session.clear()
      return response.redirect().toRoute('session.create')
    }
    session.flash('success', 'Wybrana sesja została wylogowana.')
    return response.redirect().back()
  }

  async revokeAllSessions({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    user.authVersion += 1
    await user.save()
    await new SessionManagementService().destroyAll(user.id)
    logger.warn(
      {
        event: 'account_all_sessions_revoked',
        userId: user.id,
        ...SecurityEventService.requestContext(request),
      },
      'Użytkownik wylogował wszystkie sesje'
    )
    await auth.use('web').logout()
    session.clear()
    return response.redirect().toRoute('session.create')
  }

  private async credentialsValid(user: User, password: string) {
    try {
      const verified = await User.verifyCredentials(user.email, password)
      return verified.id === user.id
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        return false
      }
      throw error
    }
  }

  private dateLabel(value: string) {
    const date = DateTime.fromISO(value, { zone: 'utc' }).setZone('local')
    return date.isValid ? date.toFormat('dd.LL.yyyy HH:mm') : 'brak danych'
  }
}
