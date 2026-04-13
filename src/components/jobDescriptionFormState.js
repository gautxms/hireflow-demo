export const SUPPORTED_SALARY_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR']

export function normalizeSalaryCurrency(value, fallback = 'USD') {
  const normalized = String(value || '').trim().toUpperCase()
  return SUPPORTED_SALARY_CURRENCIES.includes(normalized) ? normalized : fallback
}

export function validateJobDescriptionForm(formValues) {
  const errors = {}
  const requestedCurrency = String(formValues.salaryCurrency || '').trim().toUpperCase()

  if (requestedCurrency && !SUPPORTED_SALARY_CURRENCIES.includes(requestedCurrency)) {
    errors.salaryCurrency = 'Please choose a supported salary currency'
  }

  const min = formValues.salaryMin === '' ? null : Number(formValues.salaryMin)
  const max = formValues.salaryMax === '' ? null : Number(formValues.salaryMax)

  if (min !== null && Number.isFinite(min) && max !== null && Number.isFinite(max) && min > max) {
    errors.salaryMin = 'Salary min cannot be greater than salary max'
  }

  return errors
}

export function serializeJobDescriptionForm(formValues) {
  return {
    ...formValues,
    salaryCurrency: normalizeSalaryCurrency(formValues.salaryCurrency),
  }
}
