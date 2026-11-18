import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'price_watches'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('connection_miss_count').unsigned().notNullable().defaultTo(0)
      table.string('last_ticket_availability', 20).notNullable().defaultTo('unknown')
      table.string('last_availability_message', 500).nullable()
    })

    this.defer(async (db) => {
      await db.from(this.tableName).where('status', 'connection_missing').update({
        status: 'active',
        connection_miss_count: 0,
        next_check_at: null,
        last_error_message: null,
        last_error_at: null,
      })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('connection_miss_count')
      table.dropColumn('last_ticket_availability')
      table.dropColumn('last_availability_message')
    })
  }
}
