export class JobDescriptionValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'JobDescriptionValidationError'
    this.code = code
    this.status = status
  }
}

function normalizeSkills(input) {
  if (!input) {
    return []
  }

  if (Array.isArray(input)) {
    return input.map((skill) => String(skill).trim()).filter(Boolean)
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()

    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((skill) => String(skill).trim()).filter(Boolean)
      }
    } catch {
      return trimmed.split(',').map((skill) => skill.trim()).filter(Boolean)
    }
  }

  return []
}

function toIntOrNull(value) {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function toIntOrDefault(value, fallback) {
  if (value === '' || value === null || value === undefined) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

export function normalizeJobDescriptionDraft(input = {}, { fileUrl = null } = {}) {
  const title = String(input.title || '').trim()

  if (!title) {
    throw new JobDescriptionValidationError('JOB_TITLE_REQUIRED', 'title is required')
  }

  return {
    title,
    description: input.description || null,
    requirements: input.requirements || null,
    responsibilities: input.responsibilities || null,
    skills: normalizeSkills(input.skills),
    experienceYears: toIntOrNull(input.experienceYears),
    experienceMin: toIntOrNull(input.experienceMin),
    experienceMax: toIntOrNull(input.experienceMax),
    location: input.location || null,
    salaryMin: toIntOrNull(input.salaryMin),
    salaryMax: toIntOrNull(input.salaryMax),
    salaryCurrency: String(input.salaryCurrency || 'USD').trim().toUpperCase() || 'USD',
    department: input.department === undefined ? '' : String(input.department || '').trim(),
    employmentType: input.employmentType === undefined
      ? 'unspecified'
      : String(input.employmentType || 'unspecified').trim(),
    additionalInfo: input.additionalInfo || null,
    priority: toIntOrDefault(input.priority, 0),
    archivedReason: input.archivedReason || null,
    sourceType: input.sourceType === undefined
      ? 'manual'
      : String(input.sourceType || 'manual').trim(),
    version: toIntOrDefault(input.version, 1),
    fileUrl: fileUrl || null,
    status: ['draft', 'active', 'archived'].includes(input.status) ? input.status : 'active',
  }
}

export async function createJobDescription({ db, userId, input, fileUrl = null }) {
  if (!db?.query) {
    throw new TypeError('A database query interface is required')
  }

  const draft = normalizeJobDescriptionDraft(input, { fileUrl })
  const result = await db.query(
    `INSERT INTO job_descriptions (
       user_id,
       title,
       description,
       requirements,
       responsibilities,
       skills,
       experience_years,
       experience_min,
       experience_max,
       location,
       salary_min,
       salary_max,
       salary_currency,
       department,
       employment_type,
       additional_info,
       priority,
       archived_reason,
       source_type,
       version,
       file_url,
       status,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
     RETURNING *`,
    [
      userId,
      draft.title,
      draft.description,
      draft.requirements,
      draft.responsibilities,
      JSON.stringify(draft.skills),
      draft.experienceYears,
      draft.experienceMin,
      draft.experienceMax,
      draft.location,
      draft.salaryMin,
      draft.salaryMax,
      draft.salaryCurrency,
      draft.department,
      draft.employmentType,
      draft.additionalInfo,
      draft.priority,
      draft.archivedReason,
      draft.sourceType,
      draft.version,
      draft.fileUrl,
      draft.status,
    ],
  )

  return result.rows[0]
}
