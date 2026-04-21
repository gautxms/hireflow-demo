import { pool } from '../db/client.js'

export const MAX_SYSTEM_PROMPT_LENGTH = 12000
export const DEFAULT_SYSTEM_PROMPT = `Extract and analyze this resume. Return ONLY valid JSON (no markdown, no explanation):
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

let systemPromptTableEnsured = false

async function ensureSystemPromptTable() {
  if (systemPromptTableEnsured) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_system_prompts (
      id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
      system_prompt TEXT NOT NULL,
      prompt_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_version >= 1),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(
    `INSERT INTO admin_system_prompts (id, system_prompt, prompt_version)
     VALUES (true, $1, 1)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_SYSTEM_PROMPT],
  )

  systemPromptTableEnsured = true
}

function normalizePrompt(value) {
  return String(value || '').trim()
}

function normalizePromptRow(row) {
  const storedPrompt = normalizePrompt(row?.system_prompt)
  const hasStoredPrompt = Boolean(storedPrompt)

  return {
    systemPrompt: hasStoredPrompt ? storedPrompt : DEFAULT_SYSTEM_PROMPT,
    promptVersion: Number(row?.prompt_version) > 0 ? Number(row.prompt_version) : 1,
    updatedBy: row?.updated_by || null,
    updatedAt: row?.updated_at || row?.created_at || null,
    isDefaultFallback: !hasStoredPrompt,
  }
}

export function validateSystemPromptInput(prompt) {
  const normalizedPrompt = normalizePrompt(prompt)

  if (!normalizedPrompt) {
    throw new Error('systemPrompt is required and cannot be empty.')
  }

  if (normalizedPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    throw new Error(`systemPrompt exceeds max length (${MAX_SYSTEM_PROMPT_LENGTH} characters).`)
  }

  return normalizedPrompt
}

export async function getAdminSystemPrompt() {
  await ensureSystemPromptTable()

  const result = await pool.query(
    `SELECT system_prompt, prompt_version, updated_by, created_at, updated_at
     FROM admin_system_prompts
     WHERE id = true
     LIMIT 1`,
  )

  return normalizePromptRow(result.rows[0] || null)
}

export async function upsertAdminSystemPrompt({ systemPrompt, adminId }) {
  await ensureSystemPromptTable()
  const normalizedPrompt = validateSystemPromptInput(systemPrompt)

  const updateResult = await pool.query(
    `UPDATE admin_system_prompts
     SET system_prompt = $2,
         prompt_version = prompt_version + 1,
         updated_by = $3,
         updated_at = NOW()
     WHERE id = true
     RETURNING system_prompt, prompt_version, updated_by, created_at, updated_at`,
    [true, normalizedPrompt, adminId || null],
  )

  if (updateResult.rows.length > 0) {
    return normalizePromptRow(updateResult.rows[0])
  }

  const insertResult = await pool.query(
    `INSERT INTO admin_system_prompts (id, system_prompt, prompt_version, updated_by)
     VALUES (true, $1, 1, $2)
     RETURNING system_prompt, prompt_version, updated_by, created_at, updated_at`,
    [normalizedPrompt, adminId || null],
  )

  return normalizePromptRow(insertResult.rows[0])
}

export async function getRuntimeSystemPromptConfig() {
  try {
    return await getAdminSystemPrompt()
  } catch {
    return {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      promptVersion: 1,
      updatedBy: null,
      updatedAt: null,
      isDefaultFallback: true,
    }
  }
}
