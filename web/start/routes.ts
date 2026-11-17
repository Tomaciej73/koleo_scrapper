/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'
import env from '#start/env'
import {
  authIpThrottle,
  checkNowIpThrottle,
  checkNowUserThrottle,
  otpAccountThrottle,
  otpIpThrottle,
  searchIpThrottle,
  searchUserThrottle,
  passwordResetIpThrottle,
  cspReportIpThrottle,
} from '#start/limiter'

const SearchController = () => import('#controllers/search_controller')
const PriceWatchesController = () => import('#controllers/price_watches_controller')
const StationSearchController = () => import('#controllers/station_search_controller')
const EmailVerificationController = () => import('#controllers/email_verification_controller')
const HealthController = () => import('#controllers/health_controller')
const MetricsController = () => import('#controllers/metrics_controller')
const PasswordResetController = () => import('#controllers/password_reset_controller')
const CspReportsController = () => import('#controllers/csp_reports_controller')

router.get('/health/live', [HealthController, 'live'])
router.get('/health/ready', [HealthController, 'ready'])
router.get('/metrics', [MetricsController, 'index'])
router.post(env.get('CSP_REPORT_URI'), [CspReportsController, 'store']).use(cspReportIpThrottle)

router.on('/').render('pages/home').as('home')

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store']).use(authIpThrottle)
    router
      .get('verify-email', [EmailVerificationController, 'create'])
      .as('email_verification.create')
    router
      .post('verify-email', [EmailVerificationController, 'store'])
      .as('email_verification.store')
      .use(otpIpThrottle)
      .use(otpAccountThrottle)
    router
      .post('verify-email/resend', [EmailVerificationController, 'resend'])
      .as('email_verification.resend')
      .use(otpIpThrottle)
      .use(otpAccountThrottle)

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store']).use(authIpThrottle)
    router.get('forgot-password', [PasswordResetController, 'create']).as('password_reset.create')
    router
      .post('forgot-password', [PasswordResetController, 'store'])
      .as('password_reset.store')
      .use(passwordResetIpThrottle)
    router.get('reset-password', [PasswordResetController, 'edit']).as('password_reset.edit')
    router
      .post('reset-password', [PasswordResetController, 'update'])
      .as('password_reset.update')
      .use(passwordResetIpThrottle)
  })
  .use(middleware.guest())

router
  .group(() => {
    router.get('/dashboard', [SearchController, 'index']).as('dashboard')
    router
      .get('/stations/search', [StationSearchController, 'index'])
      .as('stations.search')
      .use(searchIpThrottle)
      .use(searchUserThrottle)
    router
      .post('/search', [SearchController, 'search'])
      .as('connections.search')
      .use(searchIpThrottle)
      .use(searchUserThrottle)
    router.get('/favorites', [PriceWatchesController, 'index']).as('price_watches.index')
    router.post('/favorites', [PriceWatchesController, 'store']).as('price_watches.store')
    router
      .post('/favorites/:id/interval', [PriceWatchesController, 'updateInterval'])
      .as('price_watches.interval')
    router
      .post('/favorites/:id/settings', [PriceWatchesController, 'updateSettings'])
      .as('price_watches.settings')
    router
      .post('/favorites/:id/status', [PriceWatchesController, 'updateStatus'])
      .as('price_watches.status')
    router.delete('/favorites/:id', [PriceWatchesController, 'destroy']).as('price_watches.destroy')
    router
      .post('/favorites/check', [PriceWatchesController, 'checkNow'])
      .as('price_watches.check')
      .use(checkNowIpThrottle)
      .use(checkNowUserThrottle)
    router.post('logout', [controllers.Session, 'destroy'])
  })
  .use(middleware.auth())
