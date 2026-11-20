import PriceAlertService from '#services/price_alert_service'
import MetricsService from '#services/metrics_service'
import PasswordResetDeliveryService from '#services/password_reset_delivery_service'
import PriceObservationRetentionService from '#services/price_observation_retention_service'
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
    if (!(env.get('ALERTS_ENABLED') ?? false) && !(env.get('MAIL_ENABLED') ?? false)) {
      this.logger.warning('Alerty i wysyłka e-mail są wyłączone. Worker nie ma zadań.')
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
      const resetDelivery = await new PasswordResetDeliveryService().processPending()
      if (env.get('ALERTS_ENABLED') ?? false) {
        await new PriceObservationRetentionService().pruneExpired()
        const summary = await new PriceAlertService().checkAllActive('worker')
        const errors = summary.errors + resetDelivery.errors
        const message = `Sprawdzono: ${summary.checked}, zmiany: ${summary.priceChanges} (spadki: ${summary.priceDrops}, wzrosty: ${summary.priceIncreases}), bez zmian: ${summary.unchanged}, alerty w kolejce: ${summary.alertsQueued}, alerty wysłane: ${summary.delivered}, resety hasła wysłane: ${resetDelivery.delivered}, błędy: ${errors}`
        if (errors > 0) {
          this.logger.warning(message)
        } else {
          this.logger.info(message)
        }
      } else {
        const message = `Resety hasła wysłane: ${resetDelivery.delivered}, błędy: ${resetDelivery.errors}`
        if (resetDelivery.errors > 0) {
          this.logger.warning(message)
        } else {
          this.logger.info(message)
        }
      }
    } catch (error) {
      await metrics.increment('worker_errors_total')
      logger.error({ err: error }, 'Cykl workera powiadomień nie powiódł się')
    } finally {
      await metrics.set('worker_last_heartbeat_epoch_seconds', Date.now() / 1_000)
      this.running = false
    }
  }
}
