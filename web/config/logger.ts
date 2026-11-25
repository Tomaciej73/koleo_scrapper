import env from '#start/env'
import { defineConfig, targets } from '@adonisjs/core/logger'

const usePrettyLogs = env.get('LOG_FORMAT') === 'pretty'

/**
 * Logger configuration.
 * Defines how application logs are collected, formatted, and output.
 */
const loggerConfig = defineConfig({
  /**
   * The default logger to use for logging messages.
   */
  default: 'app',

  loggers: {
    /**
     * Application logger configuration.
     */
    app: {
      /**
       * Enable or disable this logger.
       */
      enabled: true,

      /**
       * Logger name that appears in log entries.
       * Useful for identifying the source of logs.
       */
      name: env.get('APP_NAME'),

      /**
       * Minimum log level to record.
       * Levels: trace, debug, info, warn, error, fatal
       */
      level: env.get('LOG_LEVEL'),

      /**
       * Transport configuration defines where and how logs are sent.
       */
      transport: {
        /**
         * Targets define the output destinations for logs.
         * destination: 1 means stdout (console output).
         */
        targets: usePrettyLogs
          ? [
              {
                target: 'pino-pretty',
                options: {
                  destination: 1,
                  colorize: env.get('LOG_COLORIZE'),
                  colorizeObjects: env.get('LOG_COLORIZE'),
                  translateTime: env.get('LOG_TIME_FORMAT'),
                  levelFirst: true,
                  singleLine: env.get('LOG_SINGLE_LINE'),
                  hideObject: !env.get('LOG_SHOW_CONTEXT'),
                  ignore: 'pid,hostname,name',
                },
              },
            ]
          : [targets.file({ destination: 1 })],
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
