import PriceAlertService from '#services/price_alert_service'
import env from '#start/env'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class AlertsCheck extends BaseCommand {
  static commandName = 'alerts:check'
  static description = 'Sprawdza aktywne obserwacje cen jeden raz'
  static options: CommandOptions = { startApp: true }

  async run() {
    if (!(env.get('ALERTS_ENABLED') ?? false)) {
      this.logger.warning('Alerty są wyłączone przez ALERTS_ENABLED=false.')
      return
    }

    const summary = await new PriceAlertService().checkAllActive()
    this.logger.info(
      `Sprawdzono: ${summary.checked}, spadki: ${summary.priceDrops}, wysłano: ${summary.delivered}, błędy: ${summary.errors}`
    )
  }
}
