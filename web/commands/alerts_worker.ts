import PriceAlertService from '#services/price_alert_service'
import MetricsService from '#services/metrics_service'
import env from '#start/env'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import logger from '@adonisjs/core/services/logger'

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
    const metrics = new MetricsService()
    try {
      await Promise.all([
        metrics.increment('worker_runs_total'),
        metrics.set('worker_last_heartbeat_epoch_seconds', Date.now() / 1_000),
      ])
      const summary = await new PriceAlertService().checkAllActive()
      this.logger.info(
        `Sprawdzono: ${summary.checked}, spadki: ${summary.priceDrops}, wysłano: ${summary.delivered}, błędy: ${summary.errors}`
      )
    } catch (error) {
      await metrics.increment('worker_errors_total')
      logger.error({ err: error }, 'Alert worker cycle failed')
    } finally {
      await metrics.set('worker_last_heartbeat_epoch_seconds', Date.now() / 1_000)
      this.running = false
    }
  }
}
