import vine from '@vinejs/vine'
import env from '#start/env'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().trim().toLowerCase().email().maxLength(254)
const password = () =>
  vine.string().minLength(env.get('PASSWORD_MIN_LENGTH')).maxLength(env.get('PASSWORD_MAX_LENGTH'))

/**
 * Validator to use when performing self-signup
 */
export const signupValidator = vine.create({
  fullName: vine.string().nullable(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})

/**
 * Validator to use before validating user credentials
 * during login
 */
export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})

export const emailVerificationValidator = vine.create({
  code: vine
    .string()
    .trim()
    .regex(/^\d{6,8}$/),
})

export const forgotPasswordValidator = vine.create({
  email: email(),
})

export const passwordResetValidator = vine.create({
  token: vine
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})
