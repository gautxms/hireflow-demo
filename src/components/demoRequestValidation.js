export function validateDemoRequestForm(form) {
  const errors = {}

  if (!form?.name?.trim()) {
    errors.name = 'Full name is required'
  }

  if (!form?.email?.trim()) {
    errors.email = 'Work email is required'
  } else if (!form.email.includes('@')) {
    errors.email = 'Please enter a valid email'
  }

  if (!form?.company?.trim()) {
    errors.company = 'Company is required'
  }

  if (!form?.message?.trim()) {
    errors.message = 'Please share what you need help with'
  }

  return errors
}

export async function parseDemoRequestError(response) {
  let message = 'Failed to submit demo request'
  try {
    const payload = await response.json()
    message = payload?.error || message
  } catch {
    // ignore non-json responses
  }
  return message
}
