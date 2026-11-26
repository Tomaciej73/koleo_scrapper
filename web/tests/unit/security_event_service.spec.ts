import SecurityEventService from '#services/security_event_service'
import CspReportsController from '#controllers/csp_reports_controller'
import type { HttpContext } from '@adonisjs/core/http'
import { test } from '@japa/runner'

test.group('Readable security audit logs', () => {
  test('masks email and station names by default, with an explicit full-detail option', ({
    assert,
  }) => {
    const journey = {
      origin: 'Wrocław\nGłówny',
      originStationId: 60103,
      destination: 'Olsztyn Główny',
      destinationStationId: 7500,
      travelDate: '2026-11-27',
      departureTime: '14:54',
      onlyDirect: true,
    }

    assert.equal(
      SecurityEventService.emailForLog('Tomasz@example.test', false),
      't•••@example.test'
    )
    assert.equal(
      SecurityEventService.emailForLog('Tomasz@example.test', true),
      'tomasz@example.test'
    )
    const masked = SecurityEventService.journeyForLog(journey, false)
    assert.include(masked, '#60103 → #7500, 2026-11-27 14:54')
    assert.notInclude(masked, 'Wrocław')

    const detailed = SecurityEventService.journeyForLog(journey, true)
    assert.include(detailed, '"Wrocław Główny" (#60103)')
    assert.notInclude(detailed, '\n')
  })

  test('summarizes a CSP report without URL query strings or reset tokens', async ({ assert }) => {
    const token = 'a'.repeat(64)
    const entries: Array<{ context: unknown; message: string }> = []
    const context = {
      request: {
        body: () => ({
          'csp-report': {
            'document-uri': `https://example.test/reset-password/${token}?secret=hidden`,
            'blocked-uri': 'https://outside.test/script.js?secret=hidden',
            'effective-directive': 'script-src',
            'source-file': 'https://example.test/assets/app.js?secret=hidden',
            'line-number': 42,
            'disposition': 'enforce',
          },
        }),
      },
      response: { noContent: () => undefined },
      logger: {
        warn: (logContext: unknown, message: string) => {
          entries.push({ context: logContext, message })
        },
      },
    } as unknown as HttpContext

    await new CspReportsController().store(context)

    assert.lengthOf(entries, 1)
    assert.include(entries[0].message, 'script-src')
    assert.include(entries[0].message, 'https://outside.test')
    assert.include(entries[0].message, 'źródło /assets/app.js:42')
    assert.notInclude(JSON.stringify(entries[0]), token)
    assert.notInclude(JSON.stringify(entries[0]), 'secret=hidden')
  })
})
