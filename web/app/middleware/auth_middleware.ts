import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { AUTH_VERSION_SESSION_KEY } from '#services/auth_session_service'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  /**
   * The URL to redirect to, when authentication fails
   */
  redirectTo = '/login'

  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })
    const user = ctx.auth.user!
    const sessionAuthVersion = Number(ctx.session.get(AUTH_VERSION_SESSION_KEY))
    if (!Number.isSafeInteger(sessionAuthVersion) || sessionAuthVersion !== user.authVersion) {
      await ctx.auth.use('web').logout()
      ctx.session.forget(AUTH_VERSION_SESSION_KEY)
      ctx.session.flash('error', 'Sesja wygasła. Zaloguj się ponownie.')
      return ctx.response.redirect(this.redirectTo)
    }
    return next()
  }
}
