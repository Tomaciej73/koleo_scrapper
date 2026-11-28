import type PriceWatch from '#models/price_watch'
import type AlertOutbox from '#models/alert_outbox'
import MetricsService from '#services/metrics_service'
import env from '#start/env'
import mail from '@adonisjs/mail/services/main'
import type { CzkExchangeRate } from '#services/nbp_exchange_rate_service'
import { formatPrice, formatPriceWithConversion } from '#services/price_format_service'
import SmsGatewayService from '#services/sms_gateway_service'

export interface NotificationResult {
  delivered: boolean
  reason?: string
}

export type PriceAlertReason = 'price_change' | 'target_reached' | 'exchange_rate_target_reached'

export default class NotificationService {
  async sendTwoFactorChanged(recipient: string, enabled: boolean): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false))
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    const messageText = enabled
      ? 'Włączono uwierzytelnianie dwuskładnikowe TOTP.'
      : 'Wyłączono uwierzytelnianie dwuskładnikowe TOTP.'
    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .subject('Zmiana zabezpieczeń konta - Koleo Watch')
          .text(`${messageText}\nJeśli to nie Ty, niezwłocznie zmień hasło do konta.`)
          .htmlView('emails/two_factor_changed', { messageText })
      })
    )
    return { delivered: true }
  }

  async sendLoginCode(
    recipient: string,
    code: string,
    validForMinutes: number
  ): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }
    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .subject('Kod potwierdzający logowanie - Koleo Watch')
          .text(
            `Kod potwierdzający logowanie: ${code}\nWażność: ${validForMinutes} min.\nJeśli to nie Ty, nie podawaj kodu i zmień hasło.`
          )
          .htmlView('emails/login_code', { code, validForMinutes })
      })
    )
    return { delivered: true }
  }

  async sendNewLoginAlert(
    recipient: string,
    userAgent: string,
    revokeUrl: string,
    validForMinutes: number
  ): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }
    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .subject('Nowe logowanie do konta - Koleo Watch')
          .text(
            `Wykryto logowanie z nowej przeglądarki.\nPrzeglądarka: ${userAgent}\nJeśli to nie Ty, otwórz ${revokeUrl} i unieważnij tę sesję. Link jest ważny przez ${validForMinutes} min. Następnie zmień hasło.\nJeśli to Ty, nic nie musisz robić.`
          )
          .htmlView('emails/new_login', { userAgent, revokeUrl, validForMinutes })
      })
    )
    return { delivered: true }
  }

  async sendEmailVerification(
    recipient: string,
    code: string,
    validForMinutes: number,
    purpose: 'signup' | 'email_change' = 'signup'
  ): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }

    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .subject(
            purpose === 'email_change'
              ? 'Kod potwierdzający zmianę adresu - Koleo Watch'
              : 'Kod aktywacyjny - Koleo Watch'
          )
          .text(
            [
              purpose === 'email_change'
                ? 'Potwierdź nowy adres e-mail w Koleo Watch.'
                : 'Dokończ zakładanie konta w Koleo Watch.',
              '',
              `Twój kod aktywacyjny: ${code}`,
              `Kod jest ważny przez ${validForMinutes} min.`,
              '',
              'Jeśli to nie Ty zleciłeś tę operację, zignoruj tę wiadomość.',
            ].join('\n')
          )
          .htmlView('emails/verification', { code, validForMinutes, purpose })
      })
    )

    return { delivered: true }
  }

  async sendEmailChangeRequested(recipient: string): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }

    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .subject('Żądanie zmiany adresu e-mail - Koleo Watch')
          .text(
            [
              'Otrzymaliśmy żądanie zmiany adresu e-mail Twojego konta Koleo Watch.',
              'Dotychczasowy adres pozostaje aktywny do czasu potwierdzenia nowego adresu.',
              'Jeśli to nie Ty, zaloguj się i zmień hasło albo skontaktuj się z administratorem.',
            ].join('\n')
          )
          .htmlView('emails/email_change_requested')
      })
    )

    return { delivered: true }
  }

  async sendPasswordReset(
    recipient: string,
    resetUrl: string,
    validForMinutes: number
  ): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }

    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .subject('Reset hasła - Koleo Watch')
          .text(
            [
              'Otrzymaliśmy prośbę o zmianę hasła w Koleo Watch.',
              '',
              `Ustaw nowe hasło: ${resetUrl}`,
              `Link jest jednorazowy i ważny przez ${validForMinutes} min.`,
              '',
              'Jeśli to nie Ty wysłałeś prośbę, zignoruj tę wiadomość.',
            ].join('\n')
          )
          .htmlView('emails/password_reset', { resetUrl, validForMinutes })
      })
    )

    return { delivered: true }
  }

  async sendPasswordChanged(recipient: string): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }

    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .subject('Hasło zostało zmienione - Koleo Watch')
          .text(
            [
              'Hasło do Twojego konta Koleo Watch zostało zmienione.',
              '',
              'Wszystkie wcześniejsze sesje zostały unieważnione.',
              'Jeśli to nie Ty zmieniłeś hasło, skontaktuj się z administratorem.',
            ].join('\n')
          )
          .htmlView('emails/password_changed')
      })
    )

    return { delivered: true }
  }

  buildPriceChange(
    watch: PriceWatch,
    previousPriceCents: number,
    currentPriceCents: number,
    czkRate: CzkExchangeRate | null = null,
    reason?: PriceAlertReason
  ) {
    const previous = formatPriceWithConversion(previousPriceCents, watch.provider, czkRate)
    const current = formatPriceWithConversion(currentPriceCents, watch.provider, czkRate)
    const priceDropped = currentPriceCents < previousPriceCents
    const priceIncreased = currentPriceCents > previousPriceCents
    const subjectPrefix =
      reason === 'exchange_rate_target_reached'
        ? 'Próg PLN osiągnięty po zmianie kursu NBP'
        : priceDropped
          ? 'Cena spadła'
          : priceIncreased
            ? 'Cena wzrosła'
            : 'Cena osiągnęła próg'
    const subject = `${subjectPrefix}: ${watch.origin} → ${watch.destination}`
    const content = [
      reason === 'exchange_rate_target_reached'
        ? `Cena połączenia ${watch.origin} → ${watch.destination} w CZK nie zmieniła się. Po przeliczeniu według nowego kursu wynosi ${current} i spełnia próg ${formatPrice(watch.targetPriceCents, 'koleo')}.`
        : priceDropped
          ? `Cena połączenia ${watch.origin} → ${watch.destination} spadła z ${previous} do ${current}.`
          : priceIncreased
            ? `Cena połączenia ${watch.origin} → ${watch.destination} wzrosła z ${previous} do ${current}.`
            : `Cena połączenia ${watch.origin} → ${watch.destination} wynosi ${current} i spełnia ustawiony próg.`,
      `Wyjazd: ${watch.travelDate.toISODate()} o ${watch.departureTime}.`,
      watch.trainName ? `Pociąg: ${watch.trainName}.` : null,
      watch.provider === 'cd'
        ? czkRate
          ? `Przeliczenie PLN jest orientacyjne (kurs średni NBP z ${czkRate.effectiveDate}); cena ČD jest w CZK, a próg alertu w ${watch.targetPriceCurrency}.`
          : `Cena ČD jest w CZK, a próg alertu w ${watch.targetPriceCurrency}; przeliczenie NBP jest chwilowo niedostępne.`
        : null,
    ]
      .filter(Boolean)
      .join('\n')

    return { subject, content }
  }

  async sendQueuedAlert(alert: AlertOutbox, recipient: string): Promise<NotificationResult> {
    if (alert.channel === 'sms') {
      const maxLength = Math.max(60, env.get('SMS_ALERT_MAX_LENGTH') ?? 300)
      const smsText = alert.body.split(/\r?\n/).slice(0, 2).join(' ').slice(0, maxLength)
      await new SmsGatewayService().send(recipient, smsText, alert.deliveryId)
      return { delivered: true }
    }
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }

    const messageIdDomain = env.get('MAIL_FROM_ADDRESS').split('@').at(1)
    if (!messageIdDomain) {
      throw new Error('MAIL_FROM_ADDRESS nie zawiera poprawnej domeny dla Message-ID.')
    }
    const watchesUrl = new URL('/favorites', env.get('APP_URL')).toString()

    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .messageId(`<${alert.deliveryId}@${messageIdDomain}>`)
          .subject(alert.subject)
          .text(`${alert.body}\n\nMonitorowane połączenia: ${watchesUrl}`)
          .htmlView('emails/price_alert', {
            alertTitle: alert.subject,
            lines: alert.body.split(/\r?\n/),
            watchesUrl,
          })
      })
    )

    return { delivered: true }
  }

  private async sendMail(operation: () => Promise<unknown>) {
    try {
      await operation()
    } catch (error) {
      await new MetricsService().increment('smtp_errors_total')
      throw error
    }
  }
}
