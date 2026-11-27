import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected watchTable = 'price_watches'
  protected observationTable = 'price_observations'

  async up() {
    this.schema.alterTable(this.watchTable, (table) => {
      table.boolean('last_target_met').nullable()
      table.string('last_nbp_rate_mid', 24).nullable()
      table.string('last_nbp_table_number', 40).nullable()
    })

    this.schema.alterTable(this.observationTable, (table) => {
      table.integer('compared_price_cents').nullable()
      table.integer('target_price_cents').nullable()
      table.string('target_price_currency', 3).nullable()
      table.boolean('target_met').nullable()
      table.string('nbp_rate_mid', 24).nullable()
      table.string('nbp_effective_date', 10).nullable()
      table.string('nbp_table_number', 40).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.observationTable, (table) => {
      table.dropColumn('compared_price_cents')
      table.dropColumn('target_price_cents')
      table.dropColumn('target_price_currency')
      table.dropColumn('target_met')
      table.dropColumn('nbp_rate_mid')
      table.dropColumn('nbp_effective_date')
      table.dropColumn('nbp_table_number')
    })

    this.schema.alterTable(this.watchTable, (table) => {
      table.dropColumn('last_target_met')
      table.dropColumn('last_nbp_rate_mid')
      table.dropColumn('last_nbp_table_number')
    })
  }
}
