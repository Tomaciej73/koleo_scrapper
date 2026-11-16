import DatabaseBackupService from '#services/database_backup_service'
import { test } from '@japa/runner'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test.group('SQLite backup and restore', (group) => {
  let directory: string

  group.each.setup(async () => {
    directory = await mkdtemp(join(tmpdir(), 'koleo-backup-test-'))
    return () => rm(directory, { recursive: true, force: true })
  })

  test('restores the exact verified snapshot', async ({ assert }) => {
    const sourcePath = join(directory, 'source.sqlite3')
    const restoredPath = join(directory, 'restored.sqlite3')
    const backupDirectory = join(directory, 'backups')
    const source = new Database(sourcePath)
    source.exec('CREATE TABLE prices (value INTEGER NOT NULL)')
    source.prepare('INSERT INTO prices (value) VALUES (?)').run(7900)
    source.close()

    const service = new DatabaseBackupService()
    const backupPath = await service.backupDatabase(sourcePath, backupDirectory, 2)

    const changed = new Database(sourcePath)
    changed.prepare('UPDATE prices SET value = ?').run(5500)
    changed.close()

    await service.restoreDatabase(backupPath, restoredPath)
    const restored = new Database(restoredPath, { readonly: true })
    const row = restored.prepare('SELECT value FROM prices').get() as { value: number }
    restored.close()

    assert.equal(row.value, 7900)
  })
})
