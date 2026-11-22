import KoleoCircuitBreakerService, {
  KoleoCircuitOpenError,
} from '#services/koleo_circuit_breaker_service'
import OperationalRetentionService from '#services/operational_retention_service'
import AlertOutbox from '#models/alert_outbox'
import PasswordResetDelivery from '#models/password_reset_delivery'
import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Operational resilience', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('opens and resets the global KOLEO circuit breaker', async ({ assert }) => {
    const circuit = new KoleoCircuitBreakerService()
    await circuit.assertAvailable()
    await circuit.recordFailure(new Error('pierwszy błąd'))
    await circuit.recordFailure(new Error('drugi błąd'))
    await assert.rejects(
      () => circuit.recordFailure(new Error('trzeci błąd')),
      KoleoCircuitOpenError
    )
    await assert.rejects(() => circuit.assertAvailable(), KoleoCircuitOpenError)
    await circuit.recordSuccess()
    await circuit.assertAvailable()
  })

  test('removes only terminal operational records older than retention', async ({ assert }) => {
    const user = await User.create({
      email: 'retention@example.test',
      password: 'Qa-Test-2026!',
      emailVerifiedAt: DateTime.utc(),
    })
    const old = DateTime.utc().minus({ days: 120 })
    const outbox = await AlertOutbox.create({
      deliveryId: 'd7dd75e2-4392-4b02-b42f-c33554591932',
      idempotencyKey: 'retention-test',
      userId: user.id,
      priceWatchId: null,
      priceCents: 100,
      previousPriceCents: 200,
      subject: 'Test',
      body: 'Test',
      status: 'sent',
      attemptCount: 1,
      availableAt: old,
      sentAt: old,
      updatedAt: old,
    })
    const token = await PasswordResetToken.create({
      userId: user.id,
      tokenHash: 'a'.repeat(64),
      expiresAt: DateTime.utc().plus({ days: 1 }),
      usedAt: old,
    })
    const delivery = await PasswordResetDelivery.create({
      userId: user.id,
      resetTokenId: token.id,
      encryptedToken: 'test',
      status: 'cancelled',
      attemptCount: 1,
      availableAt: old,
      updatedAt: old,
    })

    const result = await new OperationalRetentionService().pruneExpired()
    assert.equal(result.alertOutbox, 1)
    assert.equal(result.passwordResetDeliveries, 1)
    assert.isNull(await AlertOutbox.find(outbox.id))
    assert.isNull(await PasswordResetDelivery.find(delivery.id))
  })
})
