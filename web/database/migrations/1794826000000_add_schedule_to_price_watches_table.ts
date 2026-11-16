import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'price_watches'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('check_interval_minutes').unsigned().notNullable().defaultTo(15)
      table.timestamp('next_check_at').nullable()
      table.integer('last_notified_price_cents').nullable()
      table.index(['status', 'next_check_at'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['status', 'next_check_at'])
      table.dropColumn('check_interval_minutes')
      table.dropColumn('next_check_at')
      table.dropColumn('last_notified_price_cents')
    })
  }
}
