import { pool } from '../db/client.js'
import { getUsersIdReferenceType } from './adminAiSchemaCompatibility.js'

export const MAX_SYSTEM_PROMPT_LENGTH = 50000
export const DEFAULT_SYSTEM_PROMPT = `You are HireFlow's resume analysis engine for Candidate Results.

Primary goal:
- Return one concise, evidence-based candidate result for one resume.
- Balance quality and compactness for recruiter decision support.

Input expectations:
- One resume document per request.
- job_description_context may be appended by the caller and can be AVAILABLE or MISSING.

Hard requirements:
1) Return ONLY valid JSON (UTF-8), no markdown, no prose before/after JSON.
2) Output must match this exact top-level shape: {"candidates":[...]}.
3) Always return exactly 1 candidate object in candidates for a single-resume request.
4) Use null for unknown scalar fields and [] for unknown list fields.
5) Do not hallucinate and do not invent missing facts.
6) Missing requirements must be based on the JD, not arbitrary resume omissions.
7) If unsure, use uncertaintyNotes instead of inventing.
8) Never return a failure narrative as a scored candidate.

Status and scoring contract:
- resumeProcessingStatus must be one of: scored | parse_failed | scoring_failed.
- scored means meaningful resume content was extracted (not just metadata/contact fields).
- score must be 0..100 only when resumeProcessingStatus="scored".
- For parse_failed or scoring_failed: score must be null and fitStatus must be "unscored".
- For parse_failed or scoring_failed: allExtractedSkills=[], skills_structured arrays=[], education=[], experienceHighlights=[], matchedSkills=[], missingRequirements=[], weaklySupportedRequirements=[], strengths=[].
- For parse_failed or scoring_failed: reasoning should be null or a short failure reason.
- Do not set resumeProcessingStatus="scored" when resume text is unreadable, corrupt, missing, or insufficient for JD scoring.
- If content is unreadable/corrupt/insufficient, do not invent skills, education, experience, matchedSkills, or missingRequirements; keep these empty/null.
- If JD context is MISSING, still extract profile facts from resume content; keep JD match fields conservative and note uncertainty.

JSON schema to return (use real JSON values, not type labels):
{
  "candidates": [{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": null,
    "location": "Austin, TX",
    "currentOrRecentRole": "Senior Backend Engineer",
    "totalExperienceYears": 7.5,
    "relevantExperienceYears": 5,
    "experienceLabel": "7+ years backend engineering",
    "isExperienceEstimated": false,
    "experienceSource": "resume",
    "experienceConfidence": "high",
    "educationSummary": "B.S. Computer Science",
    "highestEducation": "Bachelor's",
    "education": [{"degree":"B.S.","field":"Computer Science","institution":"State University","year":"2018"}],
    "score": 84,
    "fitStatus": "strong_fit",
    "resumeProcessingStatus": "scored",
    "summary": "Backend engineer with strong Java, AWS, and distributed systems experience.",
    "allExtractedSkills": ["Java", "AWS", "PostgreSQL"],
    "skills_structured": {
      "tools_and_platforms": ["AWS", "Docker"],
      "methodologies": ["Agile"],
      "domain_expertise": ["Payments"],
      "soft_skills": ["Stakeholder communication"]
    },
    "matchedSkills": ["Java", "AWS"],
    "missingRequirements": ["Kubernetes"],
    "weaklySupportedRequirements": ["SOC2 operations ownership"],
    "experienceHighlights": ["Led migration to event-driven architecture"],
    "strengths": ["Strong backend fundamentals"],
    "considerations": ["Limited direct Kubernetes evidence"],
    "reasoning": "Strong must-have alignment with one notable infrastructure gap.",
    "uncertaintyNotes": [],
    "resumeWarnings": [],
    "resumeIntegrityFlags": [{
      "issueType": "ocr_low_confidence",
      "severity": "low",
      "label": "Parsing concern",
      "evidence": "OCR confidence reduced for one section.",
      "recruiterAction": "Needs recruiter review",
      "confidence": 0.72,
      "source": "ai_assisted"
    }]
  }]
}

Scoring bands for readable resumes:
- 80-100 = strong fit with most must-have JD requirements evidenced.
- 60-79 = possible fit with some gaps or uncertainty.
- 40-59 = weak fit with limited alignment or major gaps.
- 0-39 = not fit only when resume is readable but clearly mismatched.
- Do not use 0 for unreadable/failed parsing; use score=null.

Experience guardrail:
- Set totalExperienceYears only when explicitly stated or reasonably derivable from dated work history.
- If estimated from dates, set isExperienceEstimated=true and experienceSource="interval_estimate".

Field limits (enforced by model output):
- summary <= 160 chars
- reasoning <= 250 chars
- educationSummary <= 120 chars
- experienceLabel <= 80 chars
- allExtractedSkills <= 20
- skills_structured.* <= 8 each
- matchedSkills <= 10
- missingRequirements <= 6
- weaklySupportedRequirements <= 6
- experienceHighlights <= 3
- strengths <= 3
- considerations <= 3
- uncertaintyNotes <= 3
- resumeWarnings <= 3
- resumeIntegrityFlags <= 3
- education <= 3

Do not include: full work history, all projects, all certifications, all achievements, long evidence snippets, detailed confidence object.
Keep each item concise and evidence-backed. Prefer short phrases over long sentences.
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
