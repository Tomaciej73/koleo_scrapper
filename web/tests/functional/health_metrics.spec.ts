import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import AlertOutbox from '#models/alert_outbox'
import PasswordResetDelivery from '#models/password_reset_delivery'
import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import { randomUUID } from 'node:crypto'

test.group('Health and metrics endpoints', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('separates liveness from database readiness', async ({ client }) => {
    const live = await client.get('/health/live')
    live.assertStatus(200)
    live.assertBodyContains({ status: 'ok' })

    const ready = await client.get('/health/ready')
    ready.assertStatus(200)
    ready.assertBodyContains({ status: 'ok', checks: { database: { status: 'ok' } } })

    const workerWithoutHeartbeat = await client.get('/health/worker')
    workerWithoutHeartbeat.assertStatus(503)
    workerWithoutHeartbeat.assertBodyContains({
      status: 'error',
      checks: { worker: { status: 'error' } },
    })

    await db.table('system_metrics').insert({
      key: 'worker_last_heartbeat_epoch_seconds',
      value: Date.now() / 1_000,
      updated_at: DateTime.utc().toSQL()!,
    })
    const healthyWorker = await client.get('/health/worker')
    healthyWorker.assertStatus(200)
    healthyWorker.assertBodyContains({
      status: 'ok',
      checks: { worker: { status: 'ok' }, queues: { status: 'ok' } },
    })
  })

  test('uses SQLite write-ahead logging', async ({ assert }) => {
    const result = await db.rawQuery('PRAGMA journal_mode')
    assert.equal(String(result[0]?.journal_mode).toLowerCase(), 'wal')
  })

  test('counts both delivery queues and finds the oldest pending job without loading their rows', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      email: 'health-queues@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const now = DateTime.utc()
    for (const [status, minutes] of [
      ['pending', 20],
      ['failed', 40],
    ] as const) {
      await AlertOutbox.create({
        deliveryId: randomUUID(),
        idempotencyKey: randomUUID(),
        userId: user.id,
        priceWatchId: null,
        priceCents: 100,
        previousPriceCents: 200,
        subject: 'Test',
        body: 'Test',
        status,
        attemptCount: 0,
        availableAt: now.minus({ minutes }),
      })
    }
    for (const [status, minutes] of [
      ['retry', 5],
      ['failed', 50],
    ] as const) {
      const token = await PasswordResetToken.create({
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: now.plus({ days: 1 }),
      })
      await PasswordResetDelivery.create({
        userId: user.id,
        resetTokenId: token.id,
        encryptedToken: 'test',
        status,
        attemptCount: 0,
        availableAt: now.minus({ minutes }),
      })
    }
    await db.table('system_metrics').insert({
      key: 'worker_last_heartbeat_epoch_seconds',
      value: Date.now() / 1_000,
      updated_at: now.toSQL()!,
    })

    const response = await client.get('/health/worker')
    response.assertStatus(503)
    const queues = response.body().checks.queues
    assert.equal(queues.status, 'error')
    assert.equal(queues.pending, 2)
    assert.equal(queues.failed, 2)
    assert.isAtLeast(queues.oldestPendingAgeSeconds, 1_190)
    assert.isBelow(queues.oldestPendingAgeSeconds, 1_220)
  })

  test('protects Prometheus metrics with a bearer token', async ({ client, assert }) => {
    await db.table('system_metrics').insert({
      key: 'smtp_errors_total',
      value: 2,
      updated_at: DateTime.utc().toSQL()!,
    })

    const anonymous = await client.get('/metrics')
    anonymous.assertStatus(404)

    const metrics = await client
      .get('/metrics')
      .header('authorization', 'Bearer test-metrics-token')
    metrics.assertStatus(200)
    assert.include(metrics.text(), 'smtp_errors_total 2')
    assert.include(metrics.text(), 'oldest_price_watch_job_age_seconds')
    assert.include(metrics.text(), 'alert_outbox_pending 0')
    assert.include(metrics.text(), 'koleo_circuit_breaker_open 0')
    assert.include(metrics.text(), 'worker_heartbeat_stale_threshold_seconds')
  })
})
