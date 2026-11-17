import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected limiterTable = 'rate_limits'
  protected watchTable = 'price_watches'
  protected outboxTable = 'alert_outbox'

  async up() {
    this.schema.createTable(this.limiterTable, (table) => {
      table.string('key', 255).notNullable().primary()
      table.integer('points', 9).notNullable().defaultTo(0)
      table.bigint('expire').unsigned()
    })

    this.schema.alterTable(this.watchTable, (table) => {
      table.string('processing_token', 36).nullable()
      table.timestamp('processing_started_at').nullable()
      table.index(['status', 'processing_started_at'])
    })

    this.schema.createTable(this.outboxTable, (table) => {
      table.increments('id').notNullable()
      table.string('delivery_id', 36).notNullable().unique()
      table.string('idempotency_key', 191).notNullable().unique()
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table
        .integer('price_watch_id')
        .unsigned()
        .nullable()
        .references('price_watches.id')
        .onDelete('SET NULL')
      table.integer('price_cents').unsigned().notNullable()
      table.integer('previous_price_cents').unsigned().notNullable()
      table.string('subject', 255).notNullable()
      table.text('body').notNullable()
      table.string('status', 20).notNullable().defaultTo('pending')
      table.integer('attempt_count').unsigned().notNullable().defaultTo(0)
      table.timestamp('available_at').notNullable()
      table.string('lock_token', 36).nullable()
      table.timestamp('locked_at').nullable()
      table.timestamp('sent_at').nullable()
      table.string('last_error', 500).nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['status', 'available_at'])
      table.index(['user_id', 'created_at'])
      table.index(['price_watch_id', 'status'])
    })

    this.defer(async (db) => {
      await db.rawQuery(`
        UPDATE price_watches
        SET notification_channel = 'email',
            notification_destination = (
              SELECT users.email
              FROM users
              WHERE users.id = price_watches.user_id
            )
      `)
    })
  }

  async down() {
    this.schema.dropTable(this.outboxTable)
    this.schema.alterTable(this.watchTable, (table) => {
      table.dropIndex(['status', 'processing_started_at'])
      table.dropColumn('processing_token')
      table.dropColumn('processing_started_at')
    })
    this.schema.dropTable(this.limiterTable)
  }
}
