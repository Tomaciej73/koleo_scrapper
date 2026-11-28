import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export interface OperationalRetentionSummary {
  alertOutbox: number
  passwordResetDeliveries: number
  loginChallenges: number
  loginAlertTokens: number
  trustedDevices: number
}

export default class OperationalRetentionService {
  async pruneExpired(): Promise<OperationalRetentionSummary> {
    const alertCutoff = DateTime.utc().minus({
      days: Math.max(1, env.get('ALERT_OUTBOX_RETENTION_DAYS')),
    })
    const passwordResetCutoff = DateTime.utc().minus({
      days: Math.max(1, env.get('PASSWORD_RESET_DELIVERY_RETENTION_DAYS')),
    })

    const [
      alertOutbox,
      passwordResetDeliveries,
      loginChallenges,
      loginAlertTokens,
      trustedDevices,
    ] = await Promise.all([
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
      db.from('login_challenges').where('expires_at', '<', DateTime.utc().toSQL()!).delete(),
      db.from('login_alert_tokens').where('expires_at', '<', DateTime.utc().toSQL()!).delete(),
      db
        .from('trusted_devices')
        .where(
          'last_used_at',
          '<',
          DateTime.utc()
            .minus({ days: env.get('LOGIN_TRUSTED_DAYS') })
            .toSQL()!
        )
        .delete(),
    ])

    return {
      alertOutbox: Number(alertOutbox),
      passwordResetDeliveries: Number(passwordResetDeliveries),
      loginChallenges: Number(loginChallenges),
      loginAlertTokens: Number(loginAlertTokens),
      trustedDevices: Number(trustedDevices),
    }
  }
}
