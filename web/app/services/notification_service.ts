import type PriceWatch from '#models/price_watch'
import type AlertOutbox from '#models/alert_outbox'
import MetricsService from '#services/metrics_service'
import env from '#start/env'
import mail from '@adonisjs/mail/services/main'
import type { CzkExchangeRate } from '#services/nbp_exchange_rate_service'
import { formatPrice, formatPriceWithConversion } from '#services/price_format_service'

export interface NotificationResult {
  delivered: boolean
  reason?: string
}

export type PriceAlertReason = 'price_change' | 'target_reached' | 'exchange_rate_target_reached'

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

  private async sendMail(operation: () => Promise<unknown>) {
    try {
      await operation()
    } catch (error) {
      await new MetricsService().increment('smtp_errors_total')
      throw error
    }
  }
}
