import { pool } from '../db/client.js'

export const MAX_SYSTEM_PROMPT_LENGTH = 12000

const SYSTEM_PROMPT_SCOPE = 'resume_analysis'

export const DEFAULT_RESUME_SYSTEM_PROMPT = `Extract and analyze this resume. Return ONLY valid JSON (no markdown, no explanation):
{
  "candidates": [{
    "name": "string (required)",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "summary": "2-3 sentence professional summary",
    "skills": ["skill1", "skill2"],
    "experience": [{
      "title": "Job Title",
      "company": "Company",
      "duration": "X years or dates",
      "description": "Key accomplishments",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM"
    }],
    "education": [{
      "degree": "BS Computer Science",
      "school": "University",
      "graduation_year": 2020
    }],
    "certifications": ["cert1"],
    "languages": ["English"],
    "projects": [{
      "name": "Project",
      "description": "What built",
      "url": "link"
    }],
    "achievements": ["achievement1"],
    "confidence": {
      "name": 0.95,
      "email": 0.85,
      "skills": 0.88,
      "experience": 0.90
    }
  }]
}`

let tableEnsured = false

async function ensureSystemPromptTable() {
  if (tableEnsured) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_system_prompts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope TEXT NOT NULL UNIQUE,
      system_prompt TEXT NOT NULL,
      prompt_version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  tableEnsured = true
}

function normalizePrompt(value) {
  return String(value || '').trim()
}

export function validateSystemPromptInput(value) {
  const normalized = normalizePrompt(value)

  if (!normalized) {
    return { ok: false, error: 'System prompt cannot be empty.' }
  }

  if (normalized.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `System prompt must be ${MAX_SYSTEM_PROMPT_LENGTH} characters or fewer.`,
    }
  }

  return { ok: true, value: normalized }
}

function normalizePromptRow(row) {
  return {
    scope: SYSTEM_PROMPT_SCOPE,
    systemPrompt: row?.system_prompt || DEFAULT_RESUME_SYSTEM_PROMPT,
    promptVersion: Number(row?.prompt_version || 1),
    updatedBy: row?.updated_by || null,
    updatedAt: row?.updated_at || null,
    usingFallbackDefault: !row,
  }
}

export async function getAdminSystemPromptSettings() {
  await ensureSystemPromptTable()

  const { rows } = await pool.query(
    `SELECT system_prompt, prompt_version, updated_by, updated_at
     FROM admin_system_prompts
     WHERE scope = $1
     LIMIT 1`,
    [SYSTEM_PROMPT_SCOPE],
  )

  return normalizePromptRow(rows[0])
}

export async function upsertAdminSystemPrompt({ systemPrompt, adminId }) {
  await ensureSystemPromptTable()

  const validation = validateSystemPromptInput(systemPrompt)
  if (!validation.ok) {
    const error = new Error(validation.error)
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  const normalizedPrompt = validation.value

  const result = await pool.query(
    `INSERT INTO admin_system_prompts (scope, system_prompt, prompt_version, updated_by, updated_at)
     VALUES ($1, $2, 1, $3, NOW())
     ON CONFLICT (scope)
     DO UPDATE SET
       system_prompt = EXCLUDED.system_prompt,
       prompt_version = admin_system_prompts.prompt_version + 1,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING system_prompt, prompt_version, updated_by, updated_at`,
    [SYSTEM_PROMPT_SCOPE, normalizedPrompt, adminId || null],
  )

  return normalizePromptRow(result.rows[0])
}

export async function getRuntimeResumeSystemPrompt() {
  const settings = await getAdminSystemPromptSettings()

  const normalizedPrompt = normalizePrompt(settings.systemPrompt)
  if (!normalizedPrompt) {
    return {
      prompt: DEFAULT_RESUME_SYSTEM_PROMPT,
      promptVersion: settings.promptVersion || 1,
      source: 'default-fallback-empty',
    }
  }

  return {
    prompt: normalizedPrompt,
    promptVersion: settings.promptVersion || 1,
    source: settings.usingFallbackDefault ? 'default' : 'admin',
  }
}
