import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'
import type { InferMailers } from '@adonisjs/mail/types'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const smtpUsername = env.get('SMTP_USERNAME')
const smtpPassword = env.get('SMTP_PASSWORD')
const smtpCaFile = env.get('SMTP_CA_FILE')
const smtpTlsServername = env.get('SMTP_TLS_SERVERNAME')
const applicationRoot = fileURLToPath(new URL('../', import.meta.url))
const smtpCa = smtpCaFile
  ? readFileSync(isAbsolute(smtpCaFile) ? smtpCaFile : resolve(applicationRoot, smtpCaFile), 'utf8')
  : undefined

const mailConfig = defineConfig({
  default: env.get('MAIL_MAILER'),

  /**
   * The mailers object can be used to configure multiple mailers
   * each using a different transport or same transport with different
   * options.
   */
  from: {
    address: env.get('MAIL_FROM_ADDRESS'),
    name: env.get('MAIL_FROM_NAME'),
  },

  /**
   * The globals are shared with all the templates rendered using the
   * configured template engine.
   *
   * This could be a nice place to define the logo URL, links base URL
   * the brand name to be used within the emails
   */
  globals: {
    brandName: 'Koleo Watch',
  },

  /**
   * The mailers object can be used to configure multiple mailers
   * each using a different transport or same transport with different
   * options.
   */
  mailers: {
    smtp: transports.smtp({
      host: env.get('SMTP_HOST'),
      port: env.get('SMTP_PORT'),
      secure: env.get('SMTP_SECURE') ?? false,
      requireTLS: env.get('SMTP_REQUIRE_TLS') ?? false,
      tls: {
        rejectUnauthorized: env.get('SMTP_REJECT_UNAUTHORIZED') ?? true,
        ca: smtpCa,
        servername: smtpTlsServername,
      },
      auth:
        smtpUsername && smtpPassword
          ? {
              type: 'login',
              user: smtpUsername,
              pass: smtpPassword,
            }
          : undefined,
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
