import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'

const tooManyRequests = (error: { setMessage(message: string): unknown }) => {
  error.setMessage('Zbyt wiele prób. Poczekaj i spróbuj ponownie.')
}

const byIp = (name: string, requests: number, windowSeconds: number, blockSeconds: number) =>
  limiter.define(name, ({ request }) =>
    limiter
      .allowRequests(requests)
      .every(windowSeconds)
      .blockFor(blockSeconds)
      .usingKey(`ip:${request.ip()}`)
      .limitExceeded(tooManyRequests)
  )

const byUser = (name: string, requests: number, windowSeconds: number, blockSeconds: number) =>
  limiter.define(name, ({ auth, request }) =>
    limiter
      .allowRequests(requests)
      .every(windowSeconds)
      .blockFor(blockSeconds)
      .usingKey(auth.user ? `user:${auth.user.id}` : `ip:${request.ip()}`)
      .limitExceeded(tooManyRequests)
  )

const byPendingAccount = (
  name: string,
  requests: number,
  windowSeconds: number,
  blockSeconds: number
) =>
  limiter.define(name, ({ request, session }) => {
    const pendingUserId = Number(session.get('pendingEmailVerificationUserId'))
    const key =
      Number.isSafeInteger(pendingUserId) && pendingUserId > 0
        ? `account:${pendingUserId}`
        : `ip:${request.ip()}`

    return limiter
      .allowRequests(requests)
      .every(windowSeconds)
      .blockFor(blockSeconds)
      .usingKey(key)
      .limitExceeded(tooManyRequests)
  })

const authWindow = env.get('RATE_LIMIT_AUTH_WINDOW_SECONDS')
const searchWindow = env.get('RATE_LIMIT_SEARCH_WINDOW_SECONDS')
const checkNowWindow = env.get('RATE_LIMIT_CHECK_NOW_WINDOW_SECONDS')
const blockSeconds = env.get('RATE_LIMIT_BLOCK_SECONDS')

export const authIpThrottle = byIp(
  'auth_ip',
  env.get('RATE_LIMIT_AUTH_REQUESTS'),
  authWindow,
  blockSeconds
)
export const otpIpThrottle = byIp(
  'otp_ip',
  env.get('RATE_LIMIT_OTP_REQUESTS'),
  authWindow,
  blockSeconds
)
export const otpAccountThrottle = byPendingAccount(
  'otp_account',
  env.get('RATE_LIMIT_OTP_REQUESTS'),
  authWindow,
  blockSeconds
)
export const searchIpThrottle = byIp(
  'search_ip',
  env.get('RATE_LIMIT_SEARCH_REQUESTS'),
  searchWindow,
  blockSeconds
)
export const searchUserThrottle = byUser(
  'search_user',
  env.get('RATE_LIMIT_SEARCH_REQUESTS'),
  searchWindow,
  blockSeconds
)
export const checkNowIpThrottle = byIp(
  'check_now_ip',
  env.get('RATE_LIMIT_CHECK_NOW_REQUESTS'),
  checkNowWindow,
  blockSeconds
)
export const checkNowUserThrottle = byUser(
  'check_now_user',
  env.get('RATE_LIMIT_CHECK_NOW_REQUESTS'),
  checkNowWindow,
  blockSeconds
)
export const passwordResetIpThrottle = byIp(
  'password_reset_ip',
  env.get('RATE_LIMIT_PASSWORD_RESET_REQUESTS'),
  authWindow,
  blockSeconds
)
export const cspReportIpThrottle = byIp(
  'csp_report_ip',
  env.get('RATE_LIMIT_CSP_REPORT_REQUESTS'),
  searchWindow,
  blockSeconds
)
