import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.text('totp_secret').nullable()
      table.bigInteger('totp_last_counter').nullable()
    })

    this.schema.createTable('trusted_devices', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table.string('token_hash', 64).notNullable().unique()
      table.string('user_agent', 200).notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('last_used_at').notNullable()
      table.index(['user_id', 'last_used_at'])
    })

    this.schema.createTable('login_challenges', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table.string('session_hash', 64).notNullable()
      table.integer('auth_version').notNullable()
      table.string('method', 12).notNullable()
      table.string('code_hash').nullable()
      table.integer('attempts').notNullable().defaultTo(0)
      table.timestamp('expires_at').notNullable()
      table.timestamp('sent_at').nullable()
      table.timestamp('created_at').notNullable()
      table.index(['user_id', 'expires_at'])
      table.index(['session_hash', 'expires_at'])
    })

    this.schema.createTable('login_alert_tokens', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table.string('token_hash', 64).notNullable().unique()
      table.text('encrypted_session_id').notNullable()
      table.integer('trusted_device_id').unsigned().nullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.index(['user_id', 'expires_at'])
    })

    this.schema.createTable('totp_recovery_codes', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table.string('code_hash', 64).notNullable().unique()
      table.timestamp('created_at').notNullable()
      table.index('user_id')
    })
  }

  async down() {
    this.schema.dropTable('totp_recovery_codes')
    this.schema.dropTable('login_alert_tokens')
    this.schema.dropTable('login_challenges')
    this.schema.dropTable('trusted_devices')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('totp_secret')
      table.dropColumn('totp_last_counter')
    })
  }
}
