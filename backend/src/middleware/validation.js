import Joi from 'joi'
import isEmail from 'isemail'
import { hasSuspiciousPattern, sanitizeCompany, sanitizeEmail, sanitizePhone, sanitizeText } from '../utils/sanitize.js'

const E164_REGEX = /^\+[1-9]\d{1,14}$/
const MAX_FILE_SIZE = 50 * 1024 * 1024
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const baseOptions = {
  abortEarly: false,
  allowUnknown: false,
  stripUnknown: true,
}

const emailField = Joi.string()
  .trim()
  .required()
  .custom((value, helpers) => {
    const normalized = sanitizeEmail(value)

    if (!isEmail.validate(normalized)) {
      return helpers.error('string.email')
    }

    if (hasSuspiciousPattern(value)) {
      return helpers.error('any.invalid')
    }

    return normalized
  })

const passwordField = Joi.string().min(8).max(128).required()

const companyField = Joi.string()
  .trim()
  .max(100)
  .pattern(/^[a-zA-Z0-9\-\s]*$/)
  .allow('')
  .custom((value) => sanitizeCompany(value))

const phoneField = Joi.string()
  .trim()
  .allow('')
  .custom((value, helpers) => {
    if (!value) return ''

    const normalized = sanitizePhone(value)
    if (!E164_REGEX.test(normalized)) {
      return helpers.error('string.pattern.base')
    }

    return normalized
  })

export const signupSchema = Joi.object({
  email: emailField,
  password: passwordField,
  company: companyField.optional(),
  phone: phoneField.optional(),
})

export const loginSchema = Joi.object({
  email: emailField,
  password: Joi.string().required(),
})

export const resetPasswordSchema = Joi.object({
  token: Joi.string().min(20).required(),
  newPassword: passwordField,
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required(),
})

export const emailSchema = Joi.object({
  email: emailField,
})

export const fileUploadSchema = Joi.object({
  fileSize: Joi.number().max(MAX_FILE_SIZE).required(),
  mimeType: Joi.string().valid(...ALLOWED_MIME_TYPES).required(),
})

export const schemas = {
  signup: signupSchema,
  login: loginSchema,
  resetPassword: resetPasswordSchema,
  email: emailSchema,
  paddleCheckout: Joi.object({
    plan: Joi.string().valid('monthly', 'annual').required(),
  }),
}

function formatJoiErrors(error) {
  return error.details.map((detail) => ({
    field: detail.path.join('.'),
    message: sanitizeText(detail.message),
  }))
}

export const validateRequest = (schema, target = 'body') => {
  return (req, res, next) => {
    const payload = req[target] ?? {}
    const { error, value } = schema.validate(payload, baseOptions)

    if (error) {
      const validationErrors = formatJoiErrors(error)
      console.warn('[Validation] Request rejected', {
        path: req.path,
        ip: req.ip,
        errors: validationErrors,
      })

      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors,
      })
    }

    if (Object.values(value).some(hasSuspiciousPattern)) {
      console.warn('[Validation] Suspicious payload detected', {
        path: req.path,
        ip: req.ip,
      })
      return res.status(400).json({ error: 'Invalid input detected' })
    }

    req[target] = value
    return next()
  }
}

export const validateBody = (schema) => validateRequest(schema, 'body')
