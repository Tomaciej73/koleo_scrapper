import type User from '#models/user'
import env from '#start/env'
import encryption from '@adonisjs/core/services/encryption'
import db from '@adonisjs/lucid/services/db'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const ENCRYPTION_PURPOSE = 'account-totp-secret'

function encodeBase32(bytes: Buffer) {
  let bits = 0
  let value = 0
  let result = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      result += ALPHABET[(value >>> (bits -= 5)) & 31]
    }
  }
  if (bits > 0) result += ALPHABET[(value << (5 - bits)) & 31]
  return result
}

function decodeBase32(secret: string) {
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const character of secret.toUpperCase().replace(/=+$/, '')) {
    const digit = ALPHABET.indexOf(character)
    if (digit < 0) throw new Error('Nieprawidłowy sekret TOTP')
    value = (value << 5) | digit
    bits += 5
    if (bits >= 8) bytes.push((value >>> (bits -= 8)) & 255)
  }
  return Buffer.from(bytes)
}

export function totpAt(secret: string, counter: number, digits: number) {
  const time = Buffer.alloc(8)
  time.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decodeBase32(secret)).update(time).digest()
  const offset = digest[digest.length - 1] & 15
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  return String(value).padStart(digits, '0')
}

export default class TotpService {
  generateSecret() {
    return encodeBase32(randomBytes(20))
  }

  provisioningUrl(user: User, secret: string) {
    const issuer = env.get('MAIL_FROM_NAME')
    const url = new URL(
      `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}`
    )
    url.searchParams.set('secret', secret)
    url.searchParams.set('issuer', issuer)
    url.searchParams.set('algorithm', 'SHA1')
    url.searchParams.set('digits', String(env.get('LOGIN_TOTP_DIGITS')))
    url.searchParams.set('period', String(env.get('LOGIN_TOTP_PERIOD_SECONDS')))
    return url.toString()
  }

  matchCounter(secret: string, code: string, lastCounter = -1) {
    const digits = env.get('LOGIN_TOTP_DIGITS')
    if (!new RegExp(`^\\d{${digits}}$`).test(code)) return null
    const now = Math.floor(Date.now() / (env.get('LOGIN_TOTP_PERIOD_SECONDS') * 1000))
    const window = env.get('LOGIN_TOTP_WINDOW_STEPS')
    for (let counter = now - window; counter <= now + window; counter++) {
      if (counter <= lastCounter || counter < 0) continue
      const expected = Buffer.from(totpAt(secret, counter, digits))
      if (timingSafeEqual(expected, Buffer.from(code))) return counter
    }
    return null
  }

  async consume(user: User, code: string) {
    if (!user.totpSecret) return false
    const secret = encryption.decrypt<string>(user.totpSecret, ENCRYPTION_PURPOSE)
    if (!secret) return false
    const counter = this.matchCounter(secret, code, user.totpLastCounter ?? -1)
    if (counter === null) return false
    const updated = await db
      .from('users')
      .where('id', user.id)
      .where((query) =>
        query.whereNull('totp_last_counter').orWhere('totp_last_counter', '<', counter)
      )
      .update({ totp_last_counter: counter })
    if (!updated) return false
    user.totpLastCounter = counter
    return true
  }

  async enable(user: User, secret: string, code: string) {
    const counter = this.matchCounter(secret, code)
    if (counter === null) return null
    const codes = Array.from({ length: env.get('LOGIN_RECOVERY_CODE_COUNT') }, () =>
      randomBytes(12).toString('hex')
    )
    const encryptedSecret = encryption.encrypt(secret, undefined, ENCRYPTION_PURPOSE)
    await db.transaction(async (trx) => {
      await trx.from('users').where('id', user.id).update({
        totp_secret: encryptedSecret,
        totp_last_counter: counter,
      })
      await trx.from('totp_recovery_codes').where('user_id', user.id).delete()
      await trx.table('totp_recovery_codes').insert(
        codes.map((value) => ({
          user_id: user.id,
          code_hash: createHash('sha256').update(value).digest('hex'),
          created_at: DateTime.utc().toSQL(),
        }))
      )
    })
    user.totpSecret = encryptedSecret
    user.totpLastCounter = counter
    return codes
  }

  async consumeRecovery(user: User, code: string) {
    if (!/^[a-f0-9]{24}$/i.test(code)) return false
    const codeHash = createHash('sha256').update(code.toLowerCase()).digest('hex')
    return Boolean(
      await db
        .from('totp_recovery_codes')
        .where('user_id', user.id)
        .where('code_hash', codeHash)
        .delete()
    )
  }

  async disable(user: User) {
    await db.transaction(async (trx) => {
      await trx
        .from('users')
        .where('id', user.id)
        .update({ totp_secret: null, totp_last_counter: null })
      await trx.from('totp_recovery_codes').where('user_id', user.id).delete()
    })
    user.totpSecret = null
    user.totpLastCounter = null
  }
}
