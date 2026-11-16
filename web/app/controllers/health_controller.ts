import MetricsService from '#services/metrics_service'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class HealthController {
  async live({ response }: HttpContext) {
    return response.ok({ status: 'ok' })
  }

  async ready({ response }: HttpContext) {
    const checks: Record<string, { status: 'ok' | 'error'; message?: string }> = {}
    try {
      await db.rawQuery('SELECT 1')
      checks.database = { status: 'ok' }
    } catch {
      checks.database = { status: 'error', message: 'Database is unavailable' }
    }

    if (env.get('ALERTS_ENABLED') ?? false) {
      const metrics = await new MetricsService().all().catch(() => new Map<string, number>())
      const heartbeat = metrics.get('worker_last_heartbeat_epoch_seconds')
      const age = heartbeat ? Date.now() / 1_000 - heartbeat : Number.POSITIVE_INFINITY
      checks.worker =
        age <= env.get('HEALTH_WORKER_STALE_SECONDS')
          ? { status: 'ok' }
          : { status: 'error', message: 'Worker heartbeat is stale or missing' }
    }

    const ready = Object.values(checks).every((check) => check.status === 'ok')
    const report = { status: ready ? 'ok' : 'error', checks }
    return ready ? response.ok(report) : response.serviceUnavailable(report)
  }
}
