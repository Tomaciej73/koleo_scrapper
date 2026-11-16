import type PriceWatch from '#models/price_watch'
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

  async sendPriceDrop(watch: PriceWatch, previousPriceCents: number): Promise<NotificationResult> {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      return { delivered: false, reason: 'Powiadomienia e-mail są wyłączone.' }
    }

    if (watch.notificationChannel !== 'email') {
      return {
        delivered: false,
        reason: `Kanał ${watch.notificationChannel} nie ma jeszcze skonfigurowanego dostawcy.`,
      }
    }

    if (watch.lastPriceCents === null) {
      return { delivered: false, reason: 'Brak aktualnej ceny.' }
    }

    const previous = this.formatPrice(previousPriceCents)
    const current = this.formatPrice(watch.lastPriceCents)
    const priceDropped = watch.lastPriceCents < previousPriceCents
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

    await this.sendMail(() =>
      mail.send((message) => {
        message.to(watch.notificationDestination).subject(subject).text(content)
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
