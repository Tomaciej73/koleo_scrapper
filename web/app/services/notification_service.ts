import type PriceWatch from '#models/price_watch'
import env from '#start/env'
import mail from '@adonisjs/mail/services/main'

export interface NotificationResult {
  delivered: boolean
  reason?: string
}

export default class NotificationService {
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
    const subject = `Cena spadła: ${watch.origin} → ${watch.destination}`
    const content = [
      `Cena połączenia ${watch.origin} → ${watch.destination} spadła z ${previous} do ${current}.`,
      `Wyjazd: ${watch.travelDate.toISODate()} o ${watch.departureTime}.`,
      watch.trainName ? `Pociąg: ${watch.trainName}.` : null,
    ]
      .filter(Boolean)
      .join('\n')

    await mail.send((message) => {
      message.to(watch.notificationDestination).subject(subject).text(content)
    })

    return { delivered: true }
  }

  private formatPrice(priceCents: number) {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
    }).format(priceCents / 100)
  }
}
