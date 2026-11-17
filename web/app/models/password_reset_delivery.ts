import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PasswordResetDelivery extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare resetTokenId: number

  @column({ serializeAs: null })
  declare encryptedToken: string

  @column()
  declare status: string

  @column()
  declare attemptCount: number

  @column.dateTime()
  declare availableAt: DateTime

  @column()
  declare lockToken: string | null

  @column.dateTime()
  declare lockedAt: DateTime | null

  @column.dateTime()
  declare sentAt: DateTime | null

  @column()
  declare lastError: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
