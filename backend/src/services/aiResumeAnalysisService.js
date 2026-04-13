import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.ANTHROPIC_RESUME_MODEL || 'claude-3-5-sonnet-20241022'

const MIME_TYPE_MAP = {
  'application/pdf': 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function extractJson(text = '') {
  const trimmed = String(text || '').trim()
  if (!trimmed) {
    throw new Error('Claude returned an empty response')
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const payload = fencedMatch ? fencedMatch[1].trim() : trimmed

  return JSON.parse(payload)
}

export async function analyzeResumeWithAI(fileBufferBase64, mimeType, filename) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: fileBufferBase64,
              },
            },
            {
              type: 'text',
              text: `Analyze the attached resume (${filename || 'resume file'}) and return only valid JSON in this exact shape:\n{
  "candidates": [{
    "name": "string",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "summary": "2-3 sentence professional summary",
    "skills": ["skill1", "skill2"],
    "experience": [
      {
        "title": "Job Title",
        "company": "Company Name",
        "duration": "date range or tenure",
        "description": "key accomplishments"
      }
    ],
    "education": [
      {
        "degree": "Degree",
        "school": "Institution",
        "graduation_year": 2020
      }
    ],
    "certifications": ["cert1", "cert2"],
    "languages": ["English"],
    "projects": [
      {
        "name": "Project Name",
        "description": "what was built",
        "url": "https://..."
      }
    ],
    "achievements": ["achievement1"],
    "confidence": {
      "name": 0.0,
      "email": 0.0,
      "skills": 0.0,
      "experience": 0.0
    }
  }]
}
Do not include markdown, commentary, or extra keys.`,
            },
          ],
        },
      ],
    })

    const textContent = (response.content || []).find((item) => item.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Unexpected response format from Claude')
    }

    const result = extractJson(textContent.text)
    if (!Array.isArray(result?.candidates)) {
      throw new Error('Claude response is missing candidates array')
    }

    return result
  } catch (error) {
    console.error('[AI Resume Analysis] Error:', error.message)
    throw error
  }
}
