import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected usersTable = 'users'
  protected deliveriesTable = 'password_reset_deliveries'
  protected observationsTable = 'price_observations'

  async up() {
    this.schema.createTable(this.deliveriesTable, (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table
        .integer('reset_token_id')
        .unsigned()
        .notNullable()
        .unique()
        .references('password_reset_tokens.id')
        .onDelete('CASCADE')
      table.text('encrypted_token').notNullable()
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
    })

    this.schema.alterTable(this.observationsTable, (table) => {
      table.index(['observed_at'])
    })

    this.defer(async (db) => {
      await db.rawQuery(
        'CREATE UNIQUE INDEX users_email_normalized_unique ON users (LOWER(TRIM(email)))'
      )
      await db.rawQuery('UPDATE users SET email = LOWER(TRIM(email))')
    })
  }

  async down() {
    this.schema.dropTable(this.deliveriesTable)
    this.schema.alterTable(this.observationsTable, (table) => {
      table.dropIndex(['observed_at'])
    })
    this.defer(async (db) => {
      await db.rawQuery('DROP INDEX IF EXISTS users_email_normalized_unique')
    })
  }
}
