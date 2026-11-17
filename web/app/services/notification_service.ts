import type PriceWatch from '#models/price_watch'
import type AlertOutbox from '#models/alert_outbox'
import MetricsService from '#services/metrics_service'
import env from '#start/env'
import mail from '@adonisjs/mail/services/main'

export interface NotificationResult {
  delivered: boolean
  reason?: string
}

export default class NotificationService {
  async sendEmailVerification(
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
          .subject('Kod aktywacyjny — Koleo Watch')
          .text(
            [
              'Dokończ zakładanie konta w Koleo Watch.',
              '',
              `Twój kod aktywacyjny: ${code}`,
              `Kod jest ważny przez ${validForMinutes} min.`,
              '',
              'Jeśli to nie Ty zakładasz konto, zignoruj tę wiadomość.',
            ].join('\n')
          )
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
          .subject('Reset hasła — Koleo Watch')
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
          .subject('Hasło zostało zmienione — Koleo Watch')
          .text(
            [
              'Hasło do Twojego konta Koleo Watch zostało zmienione.',
              '',
              'Wszystkie wcześniejsze sesje zostały unieważnione.',
              'Jeśli to nie Ty zmieniłeś hasło, skontaktuj się z administratorem.',
            ].join('\n')
          )
      })
    )

    return { delivered: true }
  }

  buildPriceDrop(watch: PriceWatch, previousPriceCents: number, currentPriceCents: number) {
    const previous = this.formatPrice(previousPriceCents)
    const current = this.formatPrice(currentPriceCents)
    const priceDropped = currentPriceCents < previousPriceCents
    const subject = `${priceDropped ? 'Cena spadła' : 'Cena osiągnęła próg'}: ${watch.origin} → ${watch.destination}`
    const content = [
      priceDropped
        ? `Cena połączenia ${watch.origin} → ${watch.destination} spadła z ${previous} do ${current}.`
        : `Cena połączenia ${watch.origin} → ${watch.destination} wynosi ${current} i spełnia ustawiony próg.`,
      `Wyjazd: ${watch.travelDate.toISODate()} o ${watch.departureTime}.`,
      watch.trainName ? `Pociąg: ${watch.trainName}.` : null,
    ]
      .filter(Boolean)
      .join('\n')

    return { subject, content }
  }

  async sendQueuedAlert(alert: AlertOutbox, recipient: string): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }

    const messageIdDomain = env.get('MAIL_FROM_ADDRESS').split('@').at(1)
    if (!messageIdDomain) {
      throw new Error('MAIL_FROM_ADDRESS nie zawiera poprawnej domeny dla Message-ID.')
    }

    await this.sendMail(() =>
      mail.send((message) => {
        message
          .to(recipient)
          .messageId(`<${alert.deliveryId}@${messageIdDomain}>`)
          .subject(alert.subject)
          .text(alert.body)
      })
    )

    return { delivered: true }
  }

  private formatPrice(priceCents: number) {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
    }).format(priceCents / 100)
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
