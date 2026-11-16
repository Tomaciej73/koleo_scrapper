import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('email_verified_at').nullable()
      table.string('email_verification_code_hash', 255).nullable()
      table.timestamp('email_verification_expires_at').nullable()
      table.timestamp('email_verification_sent_at').nullable()
      table.integer('email_verification_attempts').unsigned().notNullable().defaultTo(0)
    })

    this.defer(async (db) => {
      await db.from(this.tableName).whereNull('email_verified_at').update({
        email_verified_at: DateTime.utc().toSQL(),
      })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('email_verified_at')
      table.dropColumn('email_verification_code_hash')
      table.dropColumn('email_verification_expires_at')
      table.dropColumn('email_verification_sent_at')
      table.dropColumn('email_verification_attempts')
    })
  }
}
