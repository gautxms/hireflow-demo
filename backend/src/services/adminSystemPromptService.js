import { pool } from '../db/client.js'
import { getUsersIdReferenceType } from './adminAiSchemaCompatibility.js'

export const MAX_SYSTEM_PROMPT_LENGTH = 50000
export const DEFAULT_SYSTEM_PROMPT = `You are a quick resume analysis engine for initial Candidate Results.

Primary goal:
- Return compact, JD-focused candidate fit signals for one resume.

Input expectations:
- One resume document per request.
- job_description_context may be appended by the caller and can be AVAILABLE or MISSING.

Hard requirements:
1) Return ONLY valid JSON (UTF-8), no markdown, no prose before/after JSON.
2) Output must match this exact top-level shape: {"candidates":[...]}
3) Always return exactly 1 candidate object in candidates for a single-resume request.
4) Use null for unknown scalar fields and [] for unknown list fields.
5) Do not hallucinate and do not invent missing facts.
6) Missing requirements must be based on the JD, not arbitrary resume omissions.
7) If unsure, use uncertaintyNotes instead of inventing.

JSON schema to return:
{
  "candidates": [{
    "name": "string",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "currentOrRecentRole": "string|null",
    "totalExperienceYears": "number|null",
    "experienceLabel": "string|null",
    "isExperienceEstimated": "boolean",
    "educationSummary": "string|null",
    "score": "number|null",
    "fitStatus": "strong_fit|possible_fit|weak_fit|not_fit|unscored",
    "summary": "string",
    "matchedSkills": ["string"],
    "missingRequirements": ["string"],
    "weaklySupportedRequirements": ["string"],
    "strengths": ["string"],
    "considerations": ["string"],
    "reasoning": "string|null",
    "uncertaintyNotes": ["string"],
    "resumeWarnings": ["string"],
    "resumeIntegrityFlags": ["string"]
  }]
}
Field limits (enforced by model output):
- summary <= 160 chars
- reasoning <= 250 chars
- educationSummary <= 120 chars
- experienceLabel <= 80 chars
- matchedSkills <= 10
- missingRequirements <= 6
- weaklySupportedRequirements <= 6
- strengths <= 3
- considerations <= 3
- uncertaintyNotes <= 3
- resumeWarnings <= 3
- resumeIntegrityFlags <= 3

Do not include: allExtractedSkills, skills_flat, skills_structured, full work history, all projects, all certifications, all achievements, long evidence snippets, detailed confidence object.
Do not repeat resume text or JD text. If more data exists than limits allow, return only the most JD-relevant items.`

function isLegacyDefaultPrompt(prompt) {
  const normalized = normalizePrompt(prompt).toLowerCase()
  return normalized.includes('"allextractedskills"')
    && normalized.includes('"skills_flat"')
    && normalized.includes('"skills_structured"')
    && normalized.includes('"confidence"')
}

let systemPromptTableEnsured = false

async function ensureSystemPromptTable() {
  if (systemPromptTableEnsured) return
  const usersIdType = await getUsersIdReferenceType(pool)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_system_prompts (
      id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
      system_prompt TEXT NOT NULL,
      prompt_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_version >= 1),
      updated_by TEXT,
      updated_by ${usersIdType} REFERENCES users(id) ON DELETE SET NULL,
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
     SET system_prompt = $1,
         prompt_version = prompt_version + 1,
         updated_by = $2,
         updated_at = NOW()
     WHERE id = true
     RETURNING system_prompt, prompt_version, updated_by, created_at, updated_at`,
    [normalizedPrompt, adminId || null],
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

export async function resetAdminSystemPromptToDefault({ adminId } = {}) {
  return upsertAdminSystemPrompt({
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    adminId: adminId || null,
  })
}

export async function resetAdminSystemPromptToDefaultIfLegacy({ adminId } = {}) {
  const current = await getAdminSystemPrompt()
  if (!isLegacyDefaultPrompt(current.systemPrompt)) {
    return { ...current, resetPerformed: false }
  }
  const reset = await resetAdminSystemPromptToDefault({ adminId })
  return { ...reset, resetPerformed: true }
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
