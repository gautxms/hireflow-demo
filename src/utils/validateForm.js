import isEmail from 'isemail'

export function validateEmail(email) {
  if (!isEmail.validate((email || '').trim().toLowerCase())) {
    return 'Invalid email address'
  }
  return null
}

export function validatePassword(password) {
  if (!password) return 'Password required'
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Z]/.test(password)) return 'Password must contain uppercase letter'
  if (!/[0-9]/.test(password)) return 'Password must contain number'
  return null
}

export function validatePasswordMatch(password, confirm) {
  if (password !== confirm) return 'Passwords do not match'
  return null
}
