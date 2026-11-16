import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected watchTable = 'price_watches'
  protected observationTable = 'price_observations'

  async up() {
    this.schema.alterTable(this.watchTable, (table) => {
      table.integer('origin_station_id').unsigned().nullable()
      table.integer('destination_station_id').unsigned().nullable()
      table.date('arrival_date').nullable()
      table.string('last_error_message', 500).nullable()
      table.timestamp('last_error_at').nullable()
    })

    this.schema.createTable(this.observationTable, (table) => {
      table.increments('id').notNullable()
      table
        .integer('price_watch_id')
        .unsigned()
        .notNullable()
        .references('price_watches.id')
        .onDelete('CASCADE')
      table.integer('price_cents').unsigned().notNullable()
      table.timestamp('observed_at').notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['price_watch_id', 'observed_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.observationTable)
    this.schema.alterTable(this.watchTable, (table) => {
      table.dropColumn('origin_station_id')
      table.dropColumn('destination_station_id')
      table.dropColumn('arrival_date')
      table.dropColumn('last_error_message')
      table.dropColumn('last_error_at')
    })
  }
}
