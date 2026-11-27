import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.string('phone_number', 20).nullable().unique()
      table.timestamp('phone_verified_at').nullable()
    })

    this.schema.createTable('phone_verifications', (table) => {
      table.integer('user_id').unsigned().primary().references('users.id').onDelete('CASCADE')
      table.string('phone_number', 20).notNullable()
      table.string('code_hash', 255).notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('sent_at').notNullable()
      table.integer('attempts').unsigned().notNullable().defaultTo(0)
    })

    this.schema.alterTable('alert_outbox', (table) => {
      table.string('channel', 10).notNullable().defaultTo('email')
    })
  }

  async down() {
    this.schema.alterTable('alert_outbox', (table) => table.dropColumn('channel'))
    this.schema.dropTable('phone_verifications')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('phone_number')
      table.dropColumn('phone_verified_at')
    })
  }
}
