import PriceAlertService from '#services/price_alert_service'
import env from '#start/env'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class AlertsWorker extends BaseCommand {
  static commandName = 'alerts:worker'
  static description = 'Uruchamia proces okresowo sprawdzający obserwowane ceny'
  static options: CommandOptions = { startApp: true, staysAlive: true }

  private timer?: NodeJS.Timeout
  private running = false

  prepare() {
    this.app.terminating(() => {
      if (this.timer) {
        clearInterval(this.timer)
      }
    })
  }

  async run() {
    if (!(env.get('ALERTS_ENABLED') ?? false)) {
      this.logger.warning('Alerty są wyłączone przez ALERTS_ENABLED=false.')
      this.terminate()
      return
    }

    const tickSeconds = Math.max(10, env.get('ALERT_WORKER_TICK_SECONDS') ?? 60)
    await this.check()
    this.timer = setInterval(() => void this.check(), tickSeconds * 1_000)
    this.logger.info(`Worker harmonogramu działa co ${tickSeconds} s.`)
  }

  private async check() {
    if (this.running) {
      return
    }

    this.running = true
    try {
      const summary = await new PriceAlertService().checkAllActive()
      this.logger.info(
        `Sprawdzono: ${summary.checked}, spadki: ${summary.priceDrops}, wysłano: ${summary.delivered}, błędy: ${summary.errors}`
      )
    } finally {
      this.running = false
    }
  }
}
