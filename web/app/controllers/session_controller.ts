import User from '#models/user'
import { EMAIL_VERIFICATION_SESSION_KEY } from '#services/email_verification_service'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * SessionController handles user authentication and session management.
 * It provides methods for displaying the login page, authenticating users,
 * and logging out.
 */
export default class SessionController {
  /**
   * Display the login page
   */
  async create({ view }: HttpContext) {
    return view.render('pages/auth/login')
  }

  /**
   * Authenticate user credentials and create a new session
   */
  async store({ request, auth, response, session }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.verifyCredentials(email, password)

    if (!user.emailVerifiedAt) {
      session.put(EMAIL_VERIFICATION_SESSION_KEY, user.id)
      session.flash('error', 'Najpierw potwierdź adres e-mail kodem aktywacyjnym.')
      return response.redirect().toRoute('email_verification.create')
    }

    await auth.use('web').login(user)
    return response.redirect().toRoute('dashboard')
  }

  /**
   * Log out the current user and destroy their session
   */
  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect().toRoute('session.create')
  }
}
