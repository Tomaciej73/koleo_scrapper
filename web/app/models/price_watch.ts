import { PriceWatchSchema } from '#database/schema'
import env from '#start/env'
import { beforeCreate } from '@adonisjs/lucid/orm'

export default class PriceWatch extends PriceWatchSchema {
  @beforeCreate()
  static assignDefaultProvider(watch: PriceWatch) {
    if (!watch.provider) watch.provider = env.get('PRICE_PROVIDER') ?? 'demo'
  }
}
