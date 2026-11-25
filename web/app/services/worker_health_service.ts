import env from '#start/env'
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
    const metrics = new MetricsService()
    const [counts, oldestPendingAgeSeconds] = await Promise.all([
      metrics.queueCounts(),
      metrics.oldestPendingDeliveryAgeSeconds(),
    ])

    return {
      pending: counts.alertPending + counts.resetPending,
      failed: counts.alertFailed + counts.resetFailed,
      oldestPendingAgeSeconds,
    }
  }
}
