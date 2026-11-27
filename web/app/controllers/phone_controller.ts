import User from '#models/user'
import PhoneVerificationService from '#services/phone_verification_service'
import SmsGatewayService from '#services/sms_gateway_service'
import { phoneRemoveValidator, phoneRequestValidator, phoneVerifyValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import db from '@adonisjs/lucid/services/db'

export default class PhoneController {
  async request({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(phoneRequestValidator)
    const phoneNumber = SmsGatewayService.normalizePolishNumber(payload.phoneNumber)
    if (!phoneNumber) {
      session.flash('error', 'Podaj poprawny polski numer telefonu, np. +48 500 600 700.')
      return response.redirect().toRoute('account.index')
    }
    if (!SmsGatewayService.configured()) {
      session.flash('error', 'Wysyłka SMS nie jest jeszcze skonfigurowana.')
      return response.redirect().toRoute('account.index')
    }
    if (!(await this.credentialsValid(user, payload.currentPassword))) {
      session.flash('error', 'Aktualne hasło jest nieprawidłowe.')
      return response.redirect().toRoute('account.index')
    }
    if (user.phoneNumber === phoneNumber && user.phoneVerifiedAt) {
      session.flash('success', 'Ten numer jest już potwierdzony.')
      return response.redirect().toRoute('account.index')
    }
    const occupied = await User.query()
      .where('phoneNumber', phoneNumber)
      .whereNot('id', user.id)
      .first()
    if (occupied) {
      session.flash('error', 'Nie można użyć tego numeru telefonu.')
      return response.redirect().toRoute('account.index')
    }
    try {
      const result = await new PhoneVerificationService().request(user, phoneNumber)
      session.flash(
        result.sent ? 'success' : 'error',
        result.sent
          ? 'Wysłaliśmy kod potwierdzający na podany numer.'
          : `Poczekaj ${result.retryAfterSeconds} s przed ponowną wysyłką kodu.`
      )
    } catch (error) {
      logger.error(
        { err: error, event: 'phone_verification_delivery_failed', userId: user.id },
        'Nie udało się wysłać kodu potwierdzającego numer'
      )
      session.flash('error', 'Nie udało się wysłać kodu SMS. Spróbuj później.')
    }
    return response.redirect().toRoute('account.index')
  }

  async verify({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    const { code } = await request.validateUsing(phoneVerifyValidator)
    let result
    try {
      result = await new PhoneVerificationService().verify(user, code)
    } catch (error) {
      if (['SQLITE_CONSTRAINT_UNIQUE', '23505'].includes((error as { code?: string }).code ?? '')) {
        result = 'conflict'
      } else {
        throw error
      }
    }
    if (result === 'verified') {
      logger.info(
        { event: 'phone_verified', userId: user.id },
        'Potwierdzono numer telefonu użytkownika'
      )
      session.flash('success', 'Numer telefonu został potwierdzony. Możesz wybrać alerty SMS.')
    } else {
      const message =
        {
          invalid: 'Kod SMS jest nieprawidłowy.',
          expired: 'Kod SMS wygasł. Wyślij nowy kod.',
          locked: 'Limit prób został wyczerpany. Wyślij nowy kod później.',
          conflict: 'Nie można użyć tego numeru telefonu.',
        }[result] ?? 'Nie udało się potwierdzić numeru.'
      session.flash('error', message)
    }
    return response.redirect().toRoute('account.index')
  }

  async remove({ auth, request, response, session, logger }: HttpContext) {
    const user = auth.getUserOrFail()
    const { currentPassword } = await request.validateUsing(phoneRemoveValidator)
    if (!(await this.credentialsValid(user, currentPassword))) {
      session.flash('error', 'Aktualne hasło jest nieprawidłowe.')
      return response.redirect().toRoute('account.index')
    }
    await db.transaction(async (trx) => {
      const current = await User.query({ client: trx })
        .where('id', user.id)
        .forUpdate()
        .firstOrFail()
      current.phoneNumber = null
      current.phoneVerifiedAt = null
      await current.save()
      await trx.from('phone_verifications').where('user_id', user.id).delete()
      await trx
        .from('price_watches')
        .where('user_id', user.id)
        .whereIn('notification_channel', ['sms', 'both'])
        .update({
          notification_channel: 'email',
          notification_destination: current.email,
        })
      await trx
        .from('alert_outbox')
        .where('user_id', user.id)
        .where('channel', 'sms')
        .whereIn('status', ['pending', 'retry'])
        .update({ status: 'failed', last_error: 'Numer telefonu został usunięty.' })
    })
    logger.info({ event: 'phone_removed', userId: user.id }, 'Usunięto potwierdzony numer telefonu')
    session.flash('success', 'Numer telefonu usunięto. Obserwacje przestawiono na e-mail.')
    return response.redirect().toRoute('account.index')
  }

  private async credentialsValid(user: User, password: string) {
    try {
      const verified = await User.verifyCredentials(user.email, password)
      return verified.id === user.id
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) return false
      throw error
    }
  }
}
