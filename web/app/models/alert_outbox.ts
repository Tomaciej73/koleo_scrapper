import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class AlertOutbox extends BaseModel {
  static table = 'alert_outbox'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare deliveryId: string

  @column()
  declare idempotencyKey: string

  @column()
  declare userId: number

  @column()
  declare priceWatchId: number | null

  @column()
  declare priceCents: number

  @column()
  declare previousPriceCents: number

  @column()
  declare subject: string

  @column()
  declare body: string

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
