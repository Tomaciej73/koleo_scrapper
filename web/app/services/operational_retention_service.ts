import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export interface OperationalRetentionSummary {
  alertOutbox: number
  passwordResetDeliveries: number
}

export default class OperationalRetentionService {
  async pruneExpired(): Promise<OperationalRetentionSummary> {
    const alertCutoff = DateTime.utc().minus({
      days: Math.max(1, env.get('ALERT_OUTBOX_RETENTION_DAYS')),
    })
    const passwordResetCutoff = DateTime.utc().minus({
      days: Math.max(1, env.get('PASSWORD_RESET_DELIVERY_RETENTION_DAYS')),
    })

    const [alertOutbox, passwordResetDeliveries] = await Promise.all([
      db
        .from('alert_outbox')
        .whereIn('status', ['sent', 'failed'])
        .where('updated_at', '<', alertCutoff.toSQL()!)
        .delete(),
      db
        .from('password_reset_deliveries')
        .whereIn('status', ['sent', 'failed', 'cancelled'])
        .where('updated_at', '<', passwordResetCutoff.toSQL()!)
        .delete(),
    ])

    return {
      alertOutbox: Number(alertOutbox),
      passwordResetDeliveries: Number(passwordResetDeliveries),
    }
  }
}
