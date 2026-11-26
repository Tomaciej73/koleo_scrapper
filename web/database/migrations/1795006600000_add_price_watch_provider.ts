import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'price_watches'
  private readonly previousUnique = [
    'user_id',
    'origin',
    'destination',
    'travel_date',
    'departure_time',
  ]

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('provider', 12).notNullable().defaultTo('koleo')
    })

    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .where('connection_uuid', 'like', 'demo-%')
        .update({ provider: 'demo' })
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(this.previousUnique)
      table.unique([
        'user_id',
        'provider',
        'origin',
        'destination',
        'travel_date',
        'departure_time',
      ])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique([
        'user_id',
        'provider',
        'origin',
        'destination',
        'travel_date',
        'departure_time',
      ])
      table.unique(this.previousUnique)
      table.dropColumn('provider')
    })
  }
}
