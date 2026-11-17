import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected usersTable = 'users'
  protected resetTokensTable = 'password_reset_tokens'

  async up() {
    this.schema.alterTable(this.usersTable, (table) => {
      table.integer('auth_version').unsigned().notNullable().defaultTo(1)
    })

    this.schema.createTable(this.resetTokensTable, (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('expires_at').notNullable()
      table.timestamp('used_at').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['user_id', 'used_at'])
      table.index(['expires_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.resetTokensTable)
    this.schema.alterTable(this.usersTable, (table) => {
      table.dropColumn('auth_version')
    })
  }
}
