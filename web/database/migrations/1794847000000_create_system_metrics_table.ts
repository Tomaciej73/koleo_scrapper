import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'system_metrics'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('key', 120).primary()
      table.double('value').notNullable().defaultTo(0)
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
