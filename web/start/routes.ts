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

const SearchController = () => import('#controllers/search_controller')
const PriceWatchesController = () => import('#controllers/price_watches_controller')
const StationSearchController = () => import('#controllers/station_search_controller')
const EmailVerificationController = () => import('#controllers/email_verification_controller')

router.on('/').render('pages/home').as('home')

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])
    router
      .get('verify-email', [EmailVerificationController, 'create'])
      .as('email_verification.create')
    router
      .post('verify-email', [EmailVerificationController, 'store'])
      .as('email_verification.store')
    router
      .post('verify-email/resend', [EmailVerificationController, 'resend'])
      .as('email_verification.resend')

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
  })
  .use(middleware.guest())

router
  .group(() => {
    router.get('/dashboard', [SearchController, 'index']).as('dashboard')
    router.get('/stations/search', [StationSearchController, 'index']).as('stations.search')
    router.post('/search', [SearchController, 'search']).as('connections.search')
    router.get('/favorites', [PriceWatchesController, 'index']).as('price_watches.index')
    router.post('/favorites', [PriceWatchesController, 'store']).as('price_watches.store')
    router
      .post('/favorites/:id/interval', [PriceWatchesController, 'updateInterval'])
      .as('price_watches.interval')
    router.delete('/favorites/:id', [PriceWatchesController, 'destroy']).as('price_watches.destroy')
    router.post('/favorites/check', [PriceWatchesController, 'checkNow']).as('price_watches.check')
    router.post('logout', [controllers.Session, 'destroy'])
  })
  .use(middleware.auth())
