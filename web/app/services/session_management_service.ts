import SecurityEventService from '#services/security_event_service'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import type { Session } from '@adonisjs/session'
import { SessionCollection } from '@adonisjs/session'
import { DateTime } from 'luxon'

const SESSION_METADATA_KEY = 'sessionMetadata'

interface SessionMetadata {
  createdAt: string
  lastSeenAt: string
  ipHash: string
  userAgent: string
}

export interface ActiveUserSession extends SessionMetadata {
  id: string
  current: boolean
  displayId: string
}

export default class SessionManagementService {
  async track(session: Session, request: HttpContext['request'], userId: number) {
    if (!session.supportsTagging()) {
      return
    }

    const now = DateTime.utc().toISO()!
    const existing = session.get(SESSION_METADATA_KEY) as Partial<SessionMetadata> | undefined
    const metadata: SessionMetadata = {
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      ipHash: SecurityEventService.hash(request.ip()),
      userAgent: SecurityEventService.safeText(
        request.header('user-agent') ?? 'Nieznane urządzenie',
        200
      ),
    }
    session.put(SESSION_METADATA_KEY, metadata)
    await session.tag(String(userId))
  }

  async list(userId: number, currentSessionId: string): Promise<ActiveUserSession[]> {
    const collection = await this.collection()
    if (!collection.supportsTagging()) {
      return []
    }

    const sessions = await collection.tagged(String(userId))
    return sessions
      .map((tagged) => {
        const metadata = tagged.data[SESSION_METADATA_KEY] as Partial<SessionMetadata> | undefined
        const fallback = DateTime.utc().toISO()!
        return {
          id: tagged.id,
          current: tagged.id === currentSessionId,
          displayId: SecurityEventService.hash(tagged.id).slice(0, 8),
          createdAt: metadata?.createdAt ?? fallback,
          lastSeenAt: metadata?.lastSeenAt ?? fallback,
          ipHash: metadata?.ipHash ?? 'brak',
          userAgent: metadata?.userAgent ?? 'Nieznane urządzenie',
        }
      })
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
  }

  describeCurrent(session: Session): ActiveUserSession {
    const fallback = DateTime.utc().toISO()!
    const metadata = session.get(SESSION_METADATA_KEY) as Partial<SessionMetadata> | undefined
    return {
      id: session.sessionId,
      current: true,
      displayId: SecurityEventService.hash(session.sessionId).slice(0, 8),
      createdAt: metadata?.createdAt ?? fallback,
      lastSeenAt: metadata?.lastSeenAt ?? fallback,
      ipHash: metadata?.ipHash ?? 'brak',
      userAgent: metadata?.userAgent ?? 'Nieznane urządzenie',
    }
  }

  async destroyOwned(userId: number, sessionId: string) {
    const sessions = await this.list(userId, '')
    if (!sessions.some((session) => session.id === sessionId)) {
      return false
    }
    const collection = await this.collection()
    await collection.destroy(sessionId)
    return true
  }

  async destroyOthers(userId: number, currentSessionId: string) {
    const collection = await this.collection()
    if (!collection.supportsTagging()) {
      return
    }
    const sessions = await collection.tagged(String(userId))
    await Promise.all(
      sessions
        .filter((session) => session.id !== currentSessionId)
        .map((session) => collection.destroy(session.id))
    )
  }

  async destroyAll(userId: number) {
    const collection = await this.collection()
    if (!collection.supportsTagging()) {
      return
    }
    const sessions = await collection.tagged(String(userId))
    await Promise.all(sessions.map((session) => collection.destroy(session.id)))
  }

  private collection() {
    return app.container.make(SessionCollection)
  }
}
