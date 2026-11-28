import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { beforeSave, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * User model represents a user in the application.
 * It extends UserSchema and includes authentication capabilities
 * through the withAuthFinder mixin.
 */
export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  @beforeSave()
  static normalizeEmail(user: User) {
    if (user.$dirty.email && user.email) {
      user.email = user.email.trim().toLowerCase()
    }
    if (user.$dirty.pendingEmail && user.pendingEmail) {
      user.pendingEmail = user.pendingEmail.trim().toLowerCase()
    }
  }

  @column()
  authVersion = 1

  @column({ serializeAs: null })
  declare emailVerificationCodeHash: string | null

  @column({ serializeAs: null })
  declare pendingEmail: string | null

  @column({ serializeAs: null })
  declare phoneNumber: string | null

  @column.dateTime()
  declare phoneVerifiedAt: DateTime | null

  @column({ serializeAs: null })
  declare totpSecret: string | null

  @column({ serializeAs: null })
  declare totpLastCounter: number | null

  /**
   * Get the user's initials from their full name or email.
   * Returns the first letter of first and last name if available,
   * otherwise returns the first two characters of the email username.
   */
  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    }
    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
