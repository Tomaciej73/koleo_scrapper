import MetricsService from '#services/metrics_service'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'
import { timingSafeEqual } from 'node:crypto'

export default class MetricsController {
  async index({ request, response }: HttpContext) {
    const expected = env.get('METRICS_TOKEN')?.release()
    const provided = request.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!expected || !provided || !this.matches(expected, provided)) {
      return response.notFound()
    }

    const service = new MetricsService()
    const metrics = await service.all()
    const oldestJobAge = await service.oldestActiveJobAgeSeconds()
    const queues = await service.queueCounts()
    const oldestDeliveryAge = await service.oldestPendingDeliveryAgeSeconds()
    const value = (key: string) => metrics.get(key) ?? 0
    const circuitOpenUntil = value('koleo_circuit_open_until_epoch_seconds')
    const body = [
      '# TYPE koleo_requests_total counter',
      `koleo_requests_total ${value('koleo_requests_total')}`,
      '# TYPE koleo_request_errors_total counter',
      `koleo_request_errors_total ${value('koleo_request_errors_total')}`,
      '# TYPE koleo_request_duration_seconds summary',
      `koleo_request_duration_seconds_sum ${value('koleo_request_duration_ms_sum') / 1_000}`,
      `koleo_request_duration_seconds_count ${value('koleo_requests_total')}`,
      '# TYPE smtp_errors_total counter',
      `smtp_errors_total ${value('smtp_errors_total')}`,
      '# TYPE worker_runs_total counter',
      `worker_runs_total ${value('worker_runs_total')}`,
      '# TYPE worker_errors_total counter',
      `worker_errors_total ${value('worker_errors_total')}`,
      '# TYPE worker_watch_errors_total counter',
      `worker_watch_errors_total ${value('worker_watch_errors_total')}`,
      '# TYPE worker_last_heartbeat_epoch_seconds gauge',
      `worker_last_heartbeat_epoch_seconds ${value('worker_last_heartbeat_epoch_seconds')}`,
      '# TYPE worker_heartbeat_stale_threshold_seconds gauge',
      `worker_heartbeat_stale_threshold_seconds ${env.get('HEALTH_WORKER_STALE_SECONDS')}`,
      '# TYPE oldest_price_watch_job_age_seconds gauge',
      `oldest_price_watch_job_age_seconds ${oldestJobAge}`,
      '# TYPE alert_outbox_pending gauge',
      `alert_outbox_pending ${queues.alertPending}`,
      '# TYPE alert_outbox_failed gauge',
      `alert_outbox_failed ${queues.alertFailed}`,
      '# TYPE password_reset_delivery_pending gauge',
      `password_reset_delivery_pending ${queues.resetPending}`,
      '# TYPE password_reset_delivery_failed gauge',
      `password_reset_delivery_failed ${queues.resetFailed}`,
      '# TYPE oldest_delivery_job_age_seconds gauge',
      `oldest_delivery_job_age_seconds ${oldestDeliveryAge}`,
      '# TYPE delivery_job_stale_threshold_seconds gauge',
      `delivery_job_stale_threshold_seconds ${env.get('HEALTH_QUEUE_STALE_SECONDS')}`,
      '# TYPE koleo_circuit_breaker_open gauge',
      `koleo_circuit_breaker_open ${circuitOpenUntil > Date.now() / 1_000 ? 1 : 0}`,
      '# TYPE koleo_circuit_breaker_open_total counter',
      `koleo_circuit_breaker_open_total ${value('koleo_circuit_open_total')}`,
      '# TYPE koleo_circuit_breaker_consecutive_failures gauge',
      `koleo_circuit_breaker_consecutive_failures ${value('koleo_circuit_consecutive_failures')}`,
      '# TYPE koleo_last_success_epoch_seconds gauge',
      `koleo_last_success_epoch_seconds ${value('koleo_last_success_epoch_seconds')}`,
      '',
    ].join('\n')

    response.header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
    return response.send(body)
  }

  private matches(expected: string, provided: string) {
    const expectedBuffer = Buffer.from(expected)
    const providedBuffer = Buffer.from(provided)
    return (
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer)
    )
  }
}
