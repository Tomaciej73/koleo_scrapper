/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),
  APP_TIMEZONE: Env.schema.string.optional(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  DB_DATABASE: Env.schema.string.optional(),
  DB_DEBUG: Env.schema.boolean.optional(),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring the mail package
  |----------------------------------------------------------
  */
  MAIL_MAILER: Env.schema.enum(['smtp'] as const),
  MAIL_FROM_NAME: Env.schema.string(),
  MAIL_FROM_ADDRESS: Env.schema.string(),
  SMTP_HOST: Env.schema.string(),
  SMTP_PORT: Env.schema.number(),
  SMTP_SECURE: Env.schema.boolean.optional(),
  SMTP_REQUIRE_TLS: Env.schema.boolean.optional(),
  SMTP_REJECT_UNAUTHORIZED: Env.schema.boolean.optional(),
  SMTP_CA_FILE: Env.schema.string.optional(),
  SMTP_TLS_SERVERNAME: Env.schema.string.optional(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),

  // Price search and alerts
  PRICE_PROVIDER: Env.schema.enum.optional(['demo', 'koleo'] as const),
  SEARCH_RESULT_LIMIT: Env.schema.number.optional(),
  STATION_SEARCH_MIN_LENGTH: Env.schema.number.optional(),
  STATION_SEARCH_RESULT_LIMIT: Env.schema.number.optional(),
  STATION_SEARCH_CACHE_SECONDS: Env.schema.number.optional(),
  DEMO_PRICE_OFFSET_CENTS: Env.schema.number.optional(),
  ALERTS_ENABLED: Env.schema.boolean.optional(),
  ALERT_CHECK_INTERVAL_MINUTES: Env.schema.number.optional(),
  ALERT_MIN_CHECK_INTERVAL_MINUTES: Env.schema.number.optional(),
  ALERT_MAX_CHECK_INTERVAL_MINUTES: Env.schema.number.optional(),
  ALERT_WORKER_TICK_SECONDS: Env.schema.number.optional(),
  PRICE_HISTORY_DISPLAY_LIMIT: Env.schema.number.optional(),
  MAIL_ENABLED: Env.schema.boolean.optional(),
  EMAIL_VERIFICATION_CODE_LENGTH: Env.schema.number.optional(),
  EMAIL_VERIFICATION_CODE_TTL_MINUTES: Env.schema.number.optional(),
  EMAIL_VERIFICATION_MAX_ATTEMPTS: Env.schema.number.optional(),
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: Env.schema.number.optional(),
})
