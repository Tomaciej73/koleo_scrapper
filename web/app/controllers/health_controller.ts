import WorkerHealthService from '#services/worker_health_service'
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
      checks.database = { status: 'error', message: 'Baza danych jest niedostępna' }
    }

    const ready = Object.values(checks).every((check) => check.status === 'ok')
    const report = { status: ready ? 'ok' : 'error', checks }
    return ready ? response.ok(report) : response.serviceUnavailable(report)
  }

  async worker({ response }: HttpContext) {
    try {
      const { ready, report } = await new WorkerHealthService().inspect()
      return ready ? response.ok(report) : response.serviceUnavailable(report)
    } catch {
      return response.serviceUnavailable({
        status: 'error',
        checks: {
          worker: { status: 'error', message: 'Nie udało się odczytać stanu workera' },
        },
      })
    }
  }
}
