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
    const value = (key: string) => metrics.get(key) ?? 0
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
      '# TYPE oldest_price_watch_job_age_seconds gauge',
      `oldest_price_watch_job_age_seconds ${oldestJobAge}`,
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
