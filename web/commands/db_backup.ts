import DatabaseBackupService from '#services/database_backup_service'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class DbBackup extends BaseCommand {
  static commandName = 'db:backup'
  static description = 'Tworzy i weryfikuje kopię bazy SQLite'
  static options: CommandOptions = { startApp: true }

  async run() {
    const file = await new DatabaseBackupService().createConfiguredBackup()
    this.logger.success(`Utworzono zweryfikowaną kopię: ${file}`)
  }
}
