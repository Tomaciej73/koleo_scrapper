import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'price_watches'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('target_price_currency', 3).notNullable().defaultTo('PLN')
    })

    // Existing ČD thresholds were entered in CZK. Preserve their meaning until
    // the owner saves a new PLN threshold; never silently reinterpret the value.
    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .where('provider', 'cd')
        .whereNotNull('target_price_cents')
        .update({ target_price_currency: 'CZK' })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('target_price_currency')
    })
  }
}
