import { pool } from '../db/client.js'
import { getUsersIdReferenceType } from './adminAiSchemaCompatibility.js'

export const MAX_SYSTEM_PROMPT_LENGTH = 12000
export const DEFAULT_SYSTEM_PROMPT = `You are a resume analysis engine for a single candidate profile.

Primary goal:
- Extract factual resume data and produce a JD-aware fit assessment when job_description_context is available.

Input expectations:
- One resume document per request.
- job_description_context may be appended by the caller and can be AVAILABLE or MISSING.

Hard requirements:
1) Return ONLY valid JSON (UTF-8), no markdown, no prose before/after JSON.
2) Output must match this exact top-level shape: {"candidates":[...]}
3) Always return exactly 1 candidate object in candidates for a single-resume request.
4) Use null for unknown scalar fields, [] for unknown list fields, and {} only where object schema requires it.
5) Do not hallucinate: never invent employers, dates, degrees, certifications, projects, skills, metrics, links, or contact details.
6) If evidence is weak/ambiguous, keep the field conservative and lower confidence.
7) Normalize dates as YYYY-MM when possible; otherwise keep raw text in duration/notes fields and set date fields to null.
8) Confidence values must be numbers from 0 to 1.

JSON schema to return:
{
  "candidates": [{
    "name": "string",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "summary": "string",
    "skills": ["string"],
    "experience": [{
      "title": "string",
      "company": "string",
      "duration": "string or null",
      "description": "string or null",
      "startDate": "YYYY-MM or null",
      "endDate": "YYYY-MM or null"
    }],
    "education": [{
      "degree": "string",
      "school": "string",
      "graduation_year": "number or null"
    }],
    "certifications": ["string"],
    "languages": ["string"],
    "projects": [{
      "name": "string",
      "description": "string or null",
      "url": "string or null"
    }],
    "achievements": ["string"],
    "fit_assessment": {
      "has_job_description_context": "boolean",
      "overall_fit_score": "number 0-100 or null",
      "skill_match_score": "number 0-100 or null",
      "experience_match_score": "number 0-100 or null",
      "education_match_score": "number 0-100 or null",
      "location_match_score": "number 0-100 or null",
      "matched_requirements": ["string"],
      "missing_requirements": ["string"],
      "risks_or_gaps": ["string"],
      "rationale": "string",
      "notes": ["string"]
    },
    "confidence": {
      "name": 0.0,
      "email": 0.0,
      "phone": 0.0,
      "location": 0.0,
      "summary": 0.0,
      "skills": 0.0,
      "experience": 0.0,
      "education": 0.0,
      "fit_assessment": 0.0
    }
  }]
}

JD-aware behavior:
- If job_description_context is AVAILABLE, compute fit_assessment scores from explicit evidence only.
- If job_description_context is MISSING, set has_job_description_context=false, set score fields to null, and include "job_description_missing" in fit_assessment.notes.
- Do not treat assumptions as evidence.

Quality bar:
- Prefer precision over recall.
- Keep rationale concise and evidence-based.
- Ensure output is parseable JSON with double-quoted keys and strings.`

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
