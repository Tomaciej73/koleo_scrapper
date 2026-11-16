import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'price_watches'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')

      table.string('origin', 120).notNullable()
      table.string('destination', 120).notNullable()
      table.date('travel_date').notNullable()
      table.string('departure_time', 5).notNullable()
      table.string('arrival_time', 5).nullable()
      table.string('connection_uuid', 80).nullable()
      table.string('train_name', 255).nullable()

      table.integer('baseline_price_cents').nullable()
      table.integer('last_price_cents').nullable()
      table.integer('lowest_price_cents').nullable()
      table.integer('target_price_cents').nullable()

      table.string('notification_channel', 20).notNullable().defaultTo('email')
      table.string('notification_destination', 254).notNullable()
      table.string('status', 20).notNullable().defaultTo('active')
      table.timestamp('last_checked_at').nullable()
      table.timestamp('last_notified_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['user_id', 'status'])
      table.unique(['user_id', 'origin', 'destination', 'travel_date', 'departure_time'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
