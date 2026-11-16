import env from '#start/env'
import app from '@adonisjs/core/services/app'
import Database from 'better-sqlite3'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export default class DatabaseBackupService {
  async createConfiguredBackup() {
    this.ensureSqlite()
    return this.backupDatabase(
      app.makePath(env.get('DB_DATABASE')),
      app.makePath(env.get('DB_BACKUP_DIR')),
      env.get('DB_BACKUP_RETENTION_COUNT')
    )
  }

  async restoreConfiguredBackup(fileName: string) {
    this.ensureSqlite()
    if (basename(fileName) !== fileName || !/^koleo-.*\.sqlite3$/.test(fileName)) {
      throw new Error('Podaj nazwę kopii utworzonej przez polecenie db:backup.')
    }
    const backupDirectory = resolve(app.makePath(env.get('DB_BACKUP_DIR')))
    const backupPath = resolve(backupDirectory, fileName)
    const pathWithinDirectory = relative(backupDirectory, backupPath)
    if (pathWithinDirectory.startsWith('..') || isAbsolute(pathWithinDirectory)) {
      throw new Error('Plik kopii musi znajdować się w skonfigurowanym katalogu backupów.')
    }
    await this.restoreDatabase(backupPath, app.makePath(env.get('DB_DATABASE')))
  }

  async backupDatabase(sourcePath: string, backupDirectory: string, retentionCount: number) {
    await mkdir(backupDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const finalPath = join(backupDirectory, `koleo-${timestamp}.sqlite3`)
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true })

    try {
      await source.backup(temporaryPath)
      this.assertIntegrity(temporaryPath)
      await rename(temporaryPath, finalPath)
      await this.prune(backupDirectory, Math.max(1, retentionCount))
      return finalPath
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    } finally {
      source.close()
    }
  }

  async restoreDatabase(backupPath: string, destinationPath: string) {
    this.assertIntegrity(backupPath)
    await mkdir(dirname(destinationPath), { recursive: true })
    const temporaryPath = `${destinationPath}.${randomUUID()}.restore`
    const rollbackPath = `${destinationPath}.${randomUUID()}.rollback`
    const source = new Database(backupPath, { readonly: true, fileMustExist: true })

    try {
      await source.backup(temporaryPath)
      this.assertIntegrity(temporaryPath)
      let destinationExisted = false
      try {
        await rename(destinationPath, rollbackPath)
        destinationExisted = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      try {
        await rename(temporaryPath, destinationPath)
        this.assertIntegrity(destinationPath)
        if (destinationExisted) {
          await rm(rollbackPath, { force: true })
        }
      } catch (error) {
        await rm(destinationPath, { force: true })
        if (destinationExisted) {
          await rename(rollbackPath, destinationPath)
        }
        throw error
      }
    } finally {
      source.close()
      await rm(temporaryPath, { force: true })
    }
  }

  private assertIntegrity(databasePath: string) {
    const database = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      if (database.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error(`Kontrola integralności kopii ${basename(databasePath)} nie powiodła się.`)
      }
    } finally {
      database.close()
    }
  }

  private async prune(backupDirectory: string, retentionCount: number) {
    const fileNames = await readdir(backupDirectory)
    const candidates = await Promise.all(
      fileNames
        .filter((name) => /^koleo-.*\.sqlite3$/.test(name))
        .map(async (name) => {
          const path = join(backupDirectory, name)
          const file = await stat(path)
          return { path, modifiedAt: file.mtimeMs }
        })
    )
    const expired = candidates
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(retentionCount)
    await Promise.all(expired.map((file) => rm(file.path, { force: true })))
  }

  private ensureSqlite() {
    if (env.get('DB_CONNECTION') !== 'sqlite') {
      throw new Error('Polecenia backup/restore pliku są dostępne tylko dla SQLite.')
    }
  }
}
