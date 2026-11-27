import env from '#start/env'
import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import mail from '@adonisjs/mail/services/main'

export default class MailTest extends BaseCommand {
  static commandName = 'mail:test'
  static description = 'Wysyła testową wiadomość przez SMTP skonfigurowane w .env'
  static options: CommandOptions = { startApp: true }

  @args.string({ description: 'Adres odbiorcy wiadomości testowej' })
  declare recipient: string

  async run() {
    if (!(env.get('MAIL_ENABLED') ?? false)) {
      this.logger.warning('Wysyłka jest wyłączona przez MAIL_ENABLED=false.')
      this.exitCode = 1
      return
    }

    if (!/^\S+@\S+\.\S+$/.test(this.recipient)) {
      this.logger.error('Podaj poprawny adres e-mail odbiorcy.')
      this.exitCode = 1
      return
    }

    await mail.send((message) => {
      message
        .to(this.recipient)
        .subject('Test SMTP - Koleo Watch')
        .text('Konfiguracja SMTP Koleo Watch działa poprawnie.')
        .htmlView('emails/smtp_test')
    })

    this.logger.success('Wiadomość testowa została przekazana do serwera SMTP.')
  }
}
