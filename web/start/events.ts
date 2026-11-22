import SecurityEventService from '#services/security_event_service'
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

emitter.on('limit:exceeded', ({ key, response, dryRun }) => {
  logger.warn(
    {
      event: 'rate_limit_exceeded',
      limiterKeyHash: SecurityEventService.hash(String(key)),
      consumed: response.consumed,
      limit: response.limit,
      dryRun,
    },
    'Przekroczono limit żądań'
  )
})
