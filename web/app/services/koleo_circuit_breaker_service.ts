import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

const FAILURE_KEY = 'koleo_circuit_consecutive_failures'
const OPEN_UNTIL_KEY = 'koleo_circuit_open_until_epoch_seconds'
const LAST_SUCCESS_KEY = 'koleo_last_success_epoch_seconds'
const OPEN_TOTAL_KEY = 'koleo_circuit_open_total'

export class KoleoCircuitOpenError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    options?: ErrorOptions
  ) {
    super(
      `Połączenia z KOLEO są tymczasowo wstrzymane. Ponowna próba za około ${retryAfterSeconds} s.`,
      options
    )
    this.name = 'KoleoCircuitOpenError'
  }
}

export default class KoleoCircuitBreakerService {
  async assertAvailable() {
    const row = await db.from('system_metrics').where('key', OPEN_UNTIL_KEY).first()
    const openUntil = Number(row?.value ?? 0)
    const remaining = Math.ceil(openUntil - Date.now() / 1_000)
    if (remaining > 0) {
      throw new KoleoCircuitOpenError(remaining)
    }
  }

  async recordSuccess() {
    const now = DateTime.utc().toSQL()!
    await db.transaction(async (trx) => {
      await this.setMetric(trx, FAILURE_KEY, 0, now)
      await this.setMetric(trx, OPEN_UNTIL_KEY, 0, now)
      await this.setMetric(trx, LAST_SUCCESS_KEY, Date.now() / 1_000, now)
    })
  }

  async recordFailure(error: unknown) {
    const threshold = Math.max(1, env.get('KOLEO_CIRCUIT_BREAKER_FAILURE_THRESHOLD'))
    const now = DateTime.utc().toSQL()!
    const openedUntil = await db.transaction(async (trx) => {
      const row = await trx.from('system_metrics').where('key', FAILURE_KEY).forUpdate().first()
      const failures = Number(row?.value ?? 0) + 1
      await this.setMetric(trx, FAILURE_KEY, failures, now)
      if (failures < threshold) {
        return 0
      }

      const openUntil = Date.now() / 1_000 + env.get('KOLEO_CIRCUIT_BREAKER_OPEN_SECONDS')
      await this.setMetric(trx, OPEN_UNTIL_KEY, openUntil, now)
      await trx
        .table('system_metrics')
        .insert({ key: OPEN_TOTAL_KEY, value: 1, updated_at: now })
        .onConflict('key')
        .merge({
          value: trx.raw('system_metrics.value + 1'),
          updated_at: now,
        })
      return openUntil
    })

    if (openedUntil > 0) {
      throw new KoleoCircuitOpenError(Math.max(1, Math.ceil(openedUntil - Date.now() / 1_000)), {
        cause: error,
      })
    }
  }

  private async setMetric(
    client: TransactionClientContract,
    key: string,
    value: number,
    updatedAt: string
  ) {
    await client
      .table('system_metrics')
      .insert({ key, value, updated_at: updatedAt })
      .onConflict('key')
      .merge({ value, updated_at: updatedAt })
  }
}
