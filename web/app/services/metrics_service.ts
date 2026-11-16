import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export default class MetricsService {
  async increment(key: string, amount = 1) {
    await this.safely(async () => {
      const now = DateTime.utc().toSQL()!
      await db
        .table('system_metrics')
        .insert({ key, value: amount, updated_at: now })
        .onConflict('key')
        .merge({
          value: db.raw('system_metrics.value + ?', [amount]),
          updated_at: now,
        })
    })
  }

  async set(key: string, value: number) {
    await this.safely(async () => {
      await db
        .table('system_metrics')
        .insert({ key, value, updated_at: DateTime.utc().toSQL()! })
        .onConflict('key')
        .merge()
    })
  }

  async recordKoleoRequest(durationMilliseconds: number, failed: boolean) {
    await Promise.all([
      this.increment('koleo_requests_total'),
      this.increment('koleo_request_duration_ms_sum', durationMilliseconds),
      this.set('koleo_request_duration_ms_last', durationMilliseconds),
      failed ? this.increment('koleo_request_errors_total') : Promise.resolve(),
    ])
  }

  async all() {
    const rows = await db.from('system_metrics').select('key', 'value')
    return new Map(rows.map((row) => [String(row.key), Number(row.value)]))
  }

  async oldestActiveJobAgeSeconds() {
    const row = await db
      .from('price_watches')
      .where('status', 'active')
      .whereNotNull('next_check_at')
      .min('next_check_at as oldest')
      .first()
    if (!row?.oldest) {
      return 0
    }

    const raw = String(row.oldest)
    const parsed = DateTime.fromSQL(raw, { zone: 'utc' }).isValid
      ? DateTime.fromSQL(raw, { zone: 'utc' })
      : DateTime.fromISO(raw, { zone: 'utc' })
    return parsed.isValid
      ? Math.max(0, Math.floor(DateTime.utc().diff(parsed, 'seconds').seconds))
      : 0
  }

  private async safely(operation: () => Promise<void>) {
    try {
      await operation()
    } catch (error) {
      logger.warn({ err: error }, 'Could not persist operational metric')
    }
  }
}
