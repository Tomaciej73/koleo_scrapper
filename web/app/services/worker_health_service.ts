import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import MetricsService from '#services/metrics_service'

type CheckStatus = 'ok' | 'error' | 'disabled'

interface HealthCheck {
  status: CheckStatus
  message?: string
  [key: string]: string | number | CheckStatus | undefined
}

export default class WorkerHealthService {
  async inspect() {
    const workerEnabled = (env.get('ALERTS_ENABLED') ?? false) || (env.get('MAIL_ENABLED') ?? false)
    const checks: Record<string, HealthCheck> = {}
    const metrics = await new MetricsService().all()
    const heartbeat = metrics.get('worker_last_heartbeat_epoch_seconds') ?? 0
    const heartbeatAge = heartbeat > 0 ? Math.max(0, Date.now() / 1_000 - heartbeat) : null

    if (!workerEnabled) {
      checks.worker = { status: 'disabled', message: 'Worker jest wyłączony w konfiguracji' }
    } else if (heartbeatAge !== null && heartbeatAge <= env.get('HEALTH_WORKER_STALE_SECONDS')) {
      checks.worker = {
        status: 'ok',
        heartbeatAgeSeconds: Math.floor(heartbeatAge),
      }
    } else {
      checks.worker = {
        status: 'error',
        heartbeatAgeSeconds: heartbeatAge === null ? -1 : Math.floor(heartbeatAge),
        message: 'Sygnał życia workera jest nieaktualny lub go brakuje',
      }
    }

    const queue = await this.queueState()
    const queueStale = queue.oldestPendingAgeSeconds > env.get('HEALTH_QUEUE_STALE_SECONDS')
    checks.queues = {
      status: queueStale ? 'error' : 'ok',
      pending: queue.pending,
      failed: queue.failed,
      oldestPendingAgeSeconds: queue.oldestPendingAgeSeconds,
      ...(queueStale
        ? { message: 'Najstarsza wiadomość z kolejki zbyt długo oczekuje na obsługę' }
        : {}),
    }

    const ready = Object.values(checks).every((check) => check.status !== 'error')
    return { ready, report: { status: ready ? 'ok' : 'error', checks } }
  }

  private async queueState() {
    const activeStatuses = ['pending', 'retry', 'processing']
    const [alertRows, resetRows] = await Promise.all([
      db
        .from('alert_outbox')
        .select('status', 'available_at')
        .whereIn('status', [...activeStatuses, 'failed']),
      db
        .from('password_reset_deliveries')
        .select('status', 'available_at')
        .whereIn('status', [...activeStatuses, 'failed']),
    ])
    const rows = [...alertRows, ...resetRows]
    const pendingRows = rows.filter((row) => activeStatuses.includes(String(row.status)))
    const oldestPendingAgeSeconds = pendingRows.reduce((oldest, row) => {
      const parsed = this.parseDate(row.available_at)
      if (!parsed) {
        return oldest
      }
      return Math.max(oldest, Math.floor(DateTime.utc().diff(parsed, 'seconds').seconds))
    }, 0)

    return {
      pending: pendingRows.length,
      failed: rows.filter((row) => row.status === 'failed').length,
      oldestPendingAgeSeconds: Math.max(0, oldestPendingAgeSeconds),
    }
  }

  private parseDate(value: unknown) {
    if (!value) {
      return null
    }
    const raw = String(value)
    const sql = DateTime.fromSQL(raw, { zone: 'utc' })
    if (sql.isValid) {
      return sql
    }
    const iso = DateTime.fromISO(raw, { zone: 'utc' })
    return iso.isValid ? iso : null
  }
}
