import PriceObservation from '#models/price_observation'
import env from '#start/env'
import { DateTime } from 'luxon'

export default class PriceObservationRetentionService {
  async pruneExpired() {
    const retentionDays = Math.max(1, env.get('PRICE_HISTORY_RETENTION_DAYS'))
    const cutoff = DateTime.utc().minus({ days: retentionDays })
    return PriceObservation.query().where('observedAt', '<', cutoff.toSQL()!).delete()
  }
}
