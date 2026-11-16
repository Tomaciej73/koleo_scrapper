import DatabaseBackupService from '#services/database_backup_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class DbRestore extends BaseCommand {
  static commandName = 'db:restore'
  static description = 'Odtwarza bazę SQLite ze zweryfikowanej kopii'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'Nazwa pliku w skonfigurowanym katalogu backupów' })
  declare file?: string

  @flags.boolean({ description: 'Potwierdza kontrolowane zastąpienie pliku bazy' })
  declare confirm: boolean

  async run() {
    if (!this.file || !this.confirm) {
      this.logger.error('Wymagane są --file=<nazwa> oraz --confirm.')
      this.exitCode = 1
      return
    }

    await new DatabaseBackupService().restoreConfiguredBackup(this.file)
    this.logger.success('Baza została odtworzona i przeszła kontrolę integralności.')
  }
}
