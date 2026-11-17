import { defineConfig } from '@adonisjs/shield'
import env from '#start/env'

const sources = (value: string) => value.split(/\s+/).filter(Boolean)

/**
 * Security configuration using Shield.
 * Provides protection against common web vulnerabilities like CSRF,
 * XSS, clickjacking, and other security threats.
 */
const shieldConfig = defineConfig({
  /**
   * Configure CSP policies for your app. Refer documentation
   * to learn more
   */
  csp: {
    /**
     * Enable Content Security Policy headers.
     * CSP helps prevent XSS attacks by controlling which resources can be loaded.
     */
    enabled: env.get('CSP_ENABLED'),

    /**
     * CSP directives define the allowed sources for different resource types.
     * Example: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"] }
     */
    directives: {
      defaultSrc: sources(env.get('CSP_DEFAULT_SRC')),
      scriptSrc: sources(env.get('CSP_SCRIPT_SRC')),
      scriptSrcAttr: ["'none'"],
      styleSrc: sources(env.get('CSP_STYLE_SRC')),
      styleSrcAttr: ["'none'"],
      imgSrc: sources(env.get('CSP_IMG_SRC')),
      fontSrc: sources(env.get('CSP_FONT_SRC')),
      connectSrc: sources(env.get('CSP_CONNECT_SRC')),
      objectSrc: sources(env.get('CSP_OBJECT_SRC')),
      baseUri: sources(env.get('CSP_BASE_URI')),
      formAction: sources(env.get('CSP_FORM_ACTION')),
      frameAncestors: sources(env.get('CSP_FRAME_ANCESTORS')),
      reportUri: [env.get('CSP_REPORT_URI')],
      ...(env.get('CSP_UPGRADE_INSECURE_REQUESTS') ? { upgradeInsecureRequests: [] } : {}),
    },

    /**
     * When true, CSP violations are reported but not enforced.
     * Useful for testing CSP policies before enforcing them.
     */
    reportOnly: env.get('CSP_REPORT_ONLY'),
  },

  /**
   * Configure CSRF protection options. Refer documentation
   * to learn more
   */
  csrf: {
    /**
     * Enable CSRF protection.
     * Protects against Cross-Site Request Forgery attacks.
     */
    enabled: true,

    /**
     * Routes that should be excluded from CSRF protection.
     * Useful for webhooks or API endpoints that use other auth methods.
     */
    exceptRoutes: [env.get('CSP_REPORT_URI')],

    /**
     * Enable XSRF-TOKEN cookie for JavaScript frameworks.
     * When enabled, the CSRF token is available to client-side code.
     */
    enableXsrfCookie: false,

    /**
     * HTTP methods that require CSRF token validation.
     * GET, HEAD, and OPTIONS are safe methods and don't need protection.
     */
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  /**
   * Control how your website should be embedded inside
   * iFrames
   */
  xFrame: {
    /**
     * Enable X-Frame-Options header.
     * Helps prevent clickjacking attacks.
     */
    enabled: true,

    /**
     * Frame embedding policy.
     * It can block all framing with 'DENY' or allow same-origin framing
     * with 'SAMEORIGIN'.
     */
    action: 'DENY',
  },

  /**
   * Force browser to always use HTTPS
   */
  hsts: {
    /**
     * Enable HTTP Strict Transport Security.
     * Tells browsers to always use HTTPS for this site.
     */
    enabled: true,

    /**
     * How long browsers should remember to use HTTPS.
     * After this period, browsers may try HTTP again.
     */
    maxAge: '180 days',
  },

  /**
   * Disable browsers from sniffing the content type of a
   * response and always rely on the "content-type" header.
   */
  contentTypeSniffing: {
    /**
     * Enable X-Content-Type-Options: nosniff header.
     * Prevents MIME type sniffing which can lead to security vulnerabilities.
     */
    enabled: true,
  },
})

export default shieldConfig
