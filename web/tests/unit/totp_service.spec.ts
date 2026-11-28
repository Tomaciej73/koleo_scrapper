import { totpAt } from '#services/totp_service'
import { test } from '@japa/runner'

test.group('TOTP RFC 6238', () => {
  test('matches the published SHA1 vectors', ({ assert }) => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    assert.equal(totpAt(secret, Math.floor(59 / 30), 8), '94287082')
    assert.equal(totpAt(secret, Math.floor(1111111109 / 30), 8), '07081804')
    assert.equal(totpAt(secret, Math.floor(1111111111 / 30), 8), '14050471')
  })
})
