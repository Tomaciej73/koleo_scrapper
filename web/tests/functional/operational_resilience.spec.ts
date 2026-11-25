import KoleoCircuitBreakerService, {
  KoleoCircuitOpenError,
} from '#services/koleo_circuit_breaker_service'
import ConnectionSearchService, {
  type ConnectionSearchInput,
} from '#services/connection_search_service'
import OperationalRetentionService from '#services/operational_retention_service'
import AlertOutbox from '#models/alert_outbox'
import PasswordResetDelivery from '#models/password_reset_delivery'
import PasswordResetToken from '#models/password_reset_token'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

const watchedInput = (): ConnectionSearchInput => ({
  origin: 'Stacja początkowa',
  originStationId: 1,
  destination: 'Stacja końcowa',
  destinationStationId: 2,
  travelDate: DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate()!,
  departureTime: '14:54',
  onlyDirect: false,
})

const koleoService = () => {
  const service = new ConnectionSearchService()
  Object.defineProperty(service, 'provider', { value: 'koleo' })
  return service
}

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

  test('fetches only the watched price and shares it within one check cycle', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    const input = watchedInput()
    const uuids = [
      '70e90852-f928-4f43-a0b1-5a44359af001',
      '70e90852-f928-4f43-a0b1-5a44359af002',
      '70e90852-f928-4f43-a0b1-5a44359af003',
    ]
    let searches = 0
    const priced: string[] = []
    globalThis.fetch = async (request) => {
      const path = new URL(String(request)).pathname
      if (path.endsWith('/search')) {
        searches += 1
        return Response.json(
          uuids.map((uuid, index) => ({
            uuid,
            departure: `${input.travelDate}T14:54:00`,
            arrival: `${input.travelDate}T20:0${index}:00`,
            changes: index,
            legs: [{ leg_type: 'train_leg', train_full_name: `Pociąg ${index}` }],
          }))
        )
      }
      const uuid = path.split('/').at(-2)!
      priced.push(uuid)
      return Response.json({ price: '79.00', purchasable: true })
    }

    try {
      const service = koleoService()
      const first = await service.searchForWatch(input, (candidates) => candidates[1]?.uuid)
      const second = await service.searchForWatch(input, (candidates) => candidates[1]?.uuid)
      const missing = await service.searchForWatch(input, () => undefined)

      assert.equal(first.connection?.uuid, uuids[1])
      assert.equal(first.connection?.priceCents, 7_900)
      assert.equal(second.connection?.uuid, uuids[1])
      assert.isNull(missing.connection)
      assert.equal(missing.resultCount, 3)
      assert.equal(searches, 1)
      assert.deepEqual(priced, [uuids[1]])

      await koleoService().searchForWatch(input, (candidates) => candidates[0]?.uuid)
      assert.equal(searches, 2)
      assert.deepEqual(priced, [uuids[1], uuids[0]])

      const fullSearch = await koleoService().search(input)
      assert.lengthOf(fullSearch, 3)
      assert.equal(searches, 3)
      assert.sameMembers(priced.slice(2), uuids)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('ignores client errors but counts KOLEO rate limits, server errors and network failures', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    const input = watchedInput()
    let status = 400
    globalThis.fetch = async () => Response.json({ message: 'offline test' }, { status })

    try {
      const service = koleoService()
      await assert.rejects(() => service.search(input))
      const before = await db
        .from('system_metrics')
        .where('key', 'koleo_circuit_consecutive_failures')
        .first()
      assert.isNull(before)

      status = 429
      await assert.rejects(() => service.search(input))
      const rateLimited = await db
        .from('system_metrics')
        .where('key', 'koleo_circuit_consecutive_failures')
        .first()
      assert.equal(Number(rateLimited.value), 1)

      status = 503
      await assert.rejects(() => service.search(input))
      const serverFailure = await db
        .from('system_metrics')
        .where('key', 'koleo_circuit_consecutive_failures')
        .first()
      assert.equal(Number(serverFailure.value), 2)

      globalThis.fetch = async () => {
        throw new TypeError('fetch failed')
      }
      await assert.rejects(() => service.search(input), KoleoCircuitOpenError)
      await assert.rejects(
        () => new KoleoCircuitBreakerService().assertAvailable(),
        KoleoCircuitOpenError
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('counts a temporary price-endpoint failure but not an unavailable price', async ({
    assert,
  }) => {
    const originalFetch = globalThis.fetch
    const input = watchedInput()
    const uuid = '70e90852-f928-4f43-a0b1-5a44359af004'
    let priceStatus = 404
    let priceCalls = 0
    globalThis.fetch = async (request) => {
      const path = new URL(String(request)).pathname
      if (path.endsWith('/search')) {
        return Response.json([
          {
            uuid,
            departure: `${input.travelDate}T14:54:00`,
            arrival: `${input.travelDate}T20:01:00`,
          },
        ])
      }
      priceCalls += 1
      return priceStatus === 200
        ? Response.json({ price: '79.00', purchasable: true })
        : Response.json({ message: 'offline test' }, { status: priceStatus })
    }

    try {
      const service = koleoService()
      const unavailable = await service.searchForWatch(input, (candidates) => candidates[0]?.uuid)
      assert.isNull(unavailable.connection?.priceCents)
      assert.equal(unavailable.connection?.ticketAvailability, 'unavailable')

      priceStatus = 503
      const retryService = koleoService()
      await assert.rejects(() =>
        retryService.searchForWatch(input, (candidates) => candidates[0]?.uuid)
      )
      const row = await db
        .from('system_metrics')
        .where('key', 'koleo_circuit_consecutive_failures')
        .first()
      assert.equal(Number(row.value), 1)

      priceStatus = 200
      const recovered = await retryService.searchForWatch(
        input,
        (candidates) => candidates[0]?.uuid
      )
      assert.equal(recovered.connection?.priceCents, 7_900)
      assert.equal(priceCalls, 4)
    } finally {
      globalThis.fetch = originalFetch
    }
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
