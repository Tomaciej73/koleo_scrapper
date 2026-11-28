import User from '#models/user'
import TotpService from '#services/totp_service'
import SecurityEventService from '#services/security_event_service'
import LoginSecurityService from '#services/login_security_service'
import SessionManagementService from '#services/session_management_service'
import { AUTH_VERSION_SESSION_KEY } from '#services/auth_session_service'
import NotificationService from '#services/notification_service'
import { totpBeginValidator, totpSetupValidator, totpDisableValidator } from '#validators/user'
import { errors as authErrors } from '@adonisjs/auth'
import type { HttpContext } from '@adonisjs/core/http'

export const PENDING_TOTP_SECRET_KEY = 'pendingTotpSecret'

export default class TotpController {
  async begin({ auth, request, response, session }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.totpSecret) return response.redirect().toRoute('account.index')
    const { currentPassword } = await request.validateUsing(totpBeginValidator)
    if (!(await this.passwordValid(user, currentPassword))) {
      session.flash('error', 'Aktualne hasło jest nieprawidłowe.')
      return response.redirect().toRoute('account.index')
    }
    session.put(PENDING_TOTP_SECRET_KEY, new TotpService().generateSecret())
    return response.redirect().toRoute('account.index')
  }

  async confirm({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.totpSecret) return response.redirect().toRoute('account.index')
    const secret = session.get(PENDING_TOTP_SECRET_KEY)
    if (typeof secret !== 'string' || !/^[A-Z2-7]{32}$/.test(secret)) {
      session.flash('error', 'Rozpocznij konfigurację ponownie.')
      return response.redirect().toRoute('account.index')
    }
    const { code } = await request.validateUsing(totpSetupValidator)
    const codes = await new TotpService().enable(user, secret, code)
    if (!codes) {
      session.flash('error', 'Kod z aplikacji jest nieprawidłowy.')
      return response.redirect().toRoute('account.index')
    }
    session.forget(PENDING_TOTP_SECRET_KEY)
    user.authVersion += 1
    await user.save()
    session.put(AUTH_VERSION_SESSION_KEY, user.authVersion)
    await new SessionManagementService().destroyOthers(user.id, session.sessionId)
    session.flash('totpRecoveryCodes', codes)
    session.flash(
      'success',
      'Uwierzytelnianie dwuskładnikowe jest aktywne. Zapisz kody odzyskiwania.'
    )
    logger.info(
      {
        event: 'auth_totp_enabled',
        userId: user.id,
        ...SecurityEventService.requestContext(request),
      },
      'Włączono TOTP'
    )
    try {
      await new NotificationService().sendTwoFactorChanged(user.email, true)
    } catch (error) {
      logger.error(
        { err: error, event: 'auth_totp_notice_failed', userId: user.id },
        'Nie udało się wysłać potwierdzenia włączenia TOTP'
      )
    }
    return response.redirect().toRoute('account.index')
  }

  async disable({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!user.totpSecret) return response.redirect().toRoute('account.index')
    const { currentPassword, code } = await request.validateUsing(totpDisableValidator)
    if (!(await this.passwordValid(user, currentPassword))) {
      session.flash('error', 'Aktualne hasło jest nieprawidłowe.')
      return response.redirect().toRoute('account.index')
    }
    const service = new TotpService()
    const valid = (await service.consume(user, code)) || (await service.consumeRecovery(user, code))
    if (!valid) {
      session.flash('error', 'Kod z aplikacji lub kod odzyskiwania jest nieprawidłowy.')
      return response.redirect().toRoute('account.index')
    }
    await service.disable(user)
    await new LoginSecurityService().forgetAllDevices(user.id)
    user.authVersion += 1
    await user.save()
    session.put(AUTH_VERSION_SESSION_KEY, user.authVersion)
    await new SessionManagementService().destroyOthers(user.id, session.sessionId)
    logger.warn(
      {
        event: 'auth_totp_disabled',
        userId: user.id,
        ...SecurityEventService.requestContext(request),
      },
      'Wyłączono TOTP'
    )
    try {
      await new NotificationService().sendTwoFactorChanged(user.email, false)
    } catch (error) {
      logger.error(
        { err: error, event: 'auth_totp_notice_failed', userId: user.id },
        'Nie udało się wysłać potwierdzenia wyłączenia TOTP'
      )
    }
    session.flash('success', 'Uwierzytelnianie dwuskładnikowe zostało wyłączone.')
    return response.redirect().toRoute('account.index')
  }

  private async passwordValid(user: User, password: string) {
    try {
      const verified = await User.verifyCredentials(user.email, password)
      return verified.id === user.id
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) return false
      throw error
    }
  }
}
