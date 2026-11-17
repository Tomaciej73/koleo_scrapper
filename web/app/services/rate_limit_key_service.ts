import { createHash } from 'node:crypto'

export default class RateLimitKeyService {
  static email(scope: string, email: string) {
    const normalized = email.trim().toLocaleLowerCase('en-US')
    const digest = createHash('sha256').update(normalized).digest('hex')
    return `${scope}:email:${digest}`
  }
}
