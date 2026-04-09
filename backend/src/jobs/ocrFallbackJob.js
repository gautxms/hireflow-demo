import { estimateExtractableText, isLikelyScannedPdf, runOcrWithCache } from '../services/ocrService.js'

const SECTION_PATTERNS = {
  experience: /^(professional\s+)?experience|work\s+history|employment|internships?$/i,
  education: /^education|academic\s+background$/i,
  skills: /^skills?|technical\s+skills?|core\s+competencies$/i,
  certifications: /^certifications?|licenses?$/i,
  projects: /^projects?|portfolio$/i,
  languages: /^languages?$/i,
  achievements: /^achievements?|awards?|honors?$/i,
}

const COMMON_SKILLS = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C#',
  'Go',
  'Ruby',
  'React',
  'Node.js',
  'Express',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'AWS',
  'Azure',
  'GCP',
  'Docker',
  'Kubernetes',
  'Terraform',
  'GraphQL',
  'REST',
]

function cleanLine(line = '') {
  return String(line).replace(/[\u2022•▪◦·]/g, ' ').replace(/\s+/g, ' ').trim()
}

function splitLines(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
}

function prepareTextForSectionParsing(text = '') {
  let prepared = String(text || '')

  const sectionHeadings = [
    'Experience',
    'Work History',
    'Employment',
    'Education',
    'Skills',
    'Certifications',
    'Projects',
    'Portfolio',
    'Languages',
    'Achievements',
    'Awards',
  ]

  for (const heading of sectionHeadings) {
    prepared = prepared.replace(new RegExp(`\\b${heading}\\b:?`, 'gi'), `\n${heading}\n`)
  }

  prepared = prepared.replace(/\\s{2,}/g, ' ')
  return prepared
}

function parseSections(text = '') {
  const lines = splitLines(prepareTextForSectionParsing(text))
  const sections = {
    header: [],
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    languages: [],
    achievements: [],
    other: [],
  }

  let active = 'header'

  for (const line of lines) {
    const normalized = line.replace(/[:|]$/, '').trim()
    const sectionMatch = Object.entries(SECTION_PATTERNS).find(([, pattern]) => pattern.test(normalized))

    if (sectionMatch) {
      active = sectionMatch[0]
      continue
    }

    sections[active]?.push(line)
  }

  return sections
}

function collectUrls(text = '') {
  return Array.from(new Set(String(text).match(/https?:\/\/[^\s)]+/gi) || []))
}

function extractEmail(text = '') {
  return String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || ''
}

function extractPhone(text = '') {
  return String(text).match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}/)?.[0] || ''
}

function extractName(sections) {
  const candidates = [...sections.header, ...sections.other].filter((line) => !line.includes('@') && !line.match(/https?:\/\//i))

  const likelyName = candidates.find((line) => /^[A-Z][A-Za-z'`-]+(?:\s+[A-Z][A-Za-z'`-]+){1,3}$/.test(line))
  return likelyName || candidates[0] || 'Unknown Candidate'
}

function dedupeList(values = [], splitPattern = /[|,;]+/) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value).split(splitPattern))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
}

function extractProfiles(text = '') {
  const urls = collectUrls(text)
  const githubProfile = urls.find((url) => /github\.com\//i.test(url)) || ''
  const linkedinProfile = urls.find((url) => /linkedin\.com\//i.test(url)) || ''
  const portfolioLinks = urls.filter((url) => !/github\.com\//i.test(url) && !/linkedin\.com\//i.test(url))

  return {
    githubProfile,
    linkedinProfile,
    portfolioLinks,
  }
}

function extractSkills(text = '', sectionLines = []) {
  const sectionSkills = dedupeList(sectionLines)
  const skillHits = COMMON_SKILLS.filter((skill) => new RegExp(`\\b${skill.replace('.', '\\.')}\\b`, 'i').test(text))
  return dedupeList([...sectionSkills, ...skillHits]).slice(0, 20)
}

function parseDurationToYears(duration = '') {
  const yearMatch = String(duration).match(/(\d+(?:\.\d+)?)\s*(?:\+\s*)?years?/i)
  if (yearMatch) return Number(yearMatch[1])

  const monthMatch = String(duration).match(/(\d+(?:\.\d+)?)\s*months?/i)
  if (monthMatch) return Number(monthMatch[1]) / 12

  const rangeMatch = String(duration).match(/(19|20)\d{2}\s*(?:-|to|–)\s*((19|20)\d{2}|present|current)/i)
  if (rangeMatch) {
    const start = Number(rangeMatch[0].match(/(19|20)\d{2}/)?.[0] || 0)
    const endRaw = rangeMatch[2]
    const end = /present|current/i.test(endRaw) ? new Date().getUTCFullYear() : Number(endRaw)
    return Math.max(0, end - start)
  }

  return 0
}

function parseExperienceEntries(lines = []) {
  if (!lines.length) return []

  const entries = []
  for (const line of lines) {
    const parts = line.split(/\s+[|@]\s+/)
    const title = parts[0]?.trim() || ''
    const company = parts[1]?.trim() || ''
    const duration = parts[2]?.trim() || ''

    const hasRoleSignal = /engineer|developer|manager|intern|analyst|consultant|architect|lead|designer/i.test(title)
    const hasDurationSignal = /year|month|present|current|(19|20)\d{2}/i.test(line)

    if (hasRoleSignal || hasDurationSignal) {
      entries.push({
        title,
        company,
        duration,
      })
    }
  }

  return entries.slice(0, 8)
}

function parseEducationEntries(lines = []) {
  if (!lines.length) return []

  const entries = []
  for (const line of lines) {
    if (!/b\.?s|bachelor|m\.?s|master|phd|doctorate|associate|university|college|school/i.test(line)) {
      continue
    }

    const parts = line.split(/\s+[|,-]\s+/)
    entries.push({
      degree: parts[0] || line,
      school: parts[1] || '',
    })
  }

  return entries.slice(0, 5)
}

function scoreFieldConfidence(value, fallback = 0.4) {
  if (Array.isArray(value)) {
    if (value.length >= 3) return 0.9
    if (value.length > 0) return 0.75
    return fallback
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(Boolean) ? 0.8 : fallback
  }

  if (typeof value === 'string') {
    if (!value.trim()) return fallback
    if (value.includes('@')) return 0.97
    if (/^\+?[\d().\s-]{7,}$/.test(value)) return 0.88
    if (value.split(' ').length >= 2) return 0.82
    return 0.7
  }

  return fallback
}

function buildCandidateFromText(seed, text = '') {
  const sections = parseSections(text)
  const profiles = extractProfiles(text)
  const experienceEntries = parseExperienceEntries(sections.experience)
  const educationEntries = parseEducationEntries(sections.education)
  const certifications = dedupeList(sections.certifications)
  const languages = dedupeList(sections.languages)
  const achievements = dedupeList(sections.achievements)
  const sectionProjectLinks = collectUrls(sections.projects.join('\n'))
  const projects = dedupeList([...sectionProjectLinks, ...profiles.portfolioLinks], /\n+/).slice(0, 10)

  const totalYears = experienceEntries.reduce((sum, item) => sum + parseDurationToYears(item.duration), 0)
  const isRecentGrad = !experienceEntries.length && educationEntries.length > 0

  const candidate = {
    id: `${(seed || 'resume').toLowerCase()}-1`,
    name: extractName(sections),
    email: extractEmail(text),
    phone: extractPhone(text),
    position: experienceEntries[0]?.title || (isRecentGrad ? 'Entry-Level Candidate' : ''),
    experience: experienceEntries.length ? `${Math.max(0, Math.round(totalYears * 10) / 10)} years` : '0 years',
    experienceHistory: experienceEntries,
    experienceDetails: experienceEntries,
    educationHistory: educationEntries,
    educationDetails: educationEntries,
    education: educationEntries.map((entry) => `${entry.degree}${entry.school ? `, ${entry.school}` : ''}`).join(' | '),
    skills: extractSkills(text, sections.skills),
    certifications,
    languages,
    projects,
    githubProfile: profiles.githubProfile,
    linkedinProfile: profiles.linkedinProfile,
    achievements,
    score: isRecentGrad ? 68 : 80,
    tier: isRecentGrad ? 'consider' : 'strong',
    fit: isRecentGrad ? 'Potential' : 'Strong',
    pros: isRecentGrad
      ? ['Strong academic background', 'Motivated early-career profile']
      : ['Relevant professional history', 'Aligned technical skills'],
    cons: experienceEntries.length ? [] : ['Limited or no verified work experience'],
  }

  candidate.confidenceScores = {
    name: scoreFieldConfidence(candidate.name, 0.5),
    email: scoreFieldConfidence(candidate.email, 0.2),
    phone: scoreFieldConfidence(candidate.phone, 0.2),
    skills: scoreFieldConfidence(candidate.skills, 0.3),
    experience: scoreFieldConfidence(candidate.experienceDetails, 0.35),
    education: scoreFieldConfidence(candidate.educationDetails, 0.4),
    certifications: scoreFieldConfidence(candidate.certifications, 0.35),
    languages: scoreFieldConfidence(candidate.languages, 0.35),
    projects: scoreFieldConfidence(candidate.projects, 0.35),
    githubProfile: scoreFieldConfidence(candidate.githubProfile, 0.3),
    linkedinProfile: scoreFieldConfidence(candidate.linkedinProfile, 0.3),
    achievements: scoreFieldConfidence(candidate.achievements, 0.3),
  }

  return candidate
}

function scoreTextConfidence(textLength, fileSize) {
  const density = textLength / Math.max(1, fileSize * 0.02)
  return Math.max(10, Math.min(99, Math.round(density * 100)))
}

export async function runParseWithOcrFallback({ filename, mimeType, fileSize, fileBuffer }) {
  const extraction = estimateExtractableText(fileBuffer)
  const aiConfidence = scoreTextConfidence(extraction.length, fileSize)
  const scannedPdf = isLikelyScannedPdf({ mimeType, fileBuffer })

  const aiAttempt = {
    method: 'ai-extraction',
    confidence: aiConfidence,
    extractedTextLength: extraction.length,
    status: extraction.length > 0 ? 'success' : 'failed',
  }

  const shouldRunOcr = scannedPdf || extraction.length === 0 || aiConfidence < 70

  if (!shouldRunOcr) {
    return {
      methodUsed: 'ai-extraction',
      confidence: aiConfidence,
      extractedTextLength: extraction.length,
      rawText: extraction.text,
      candidates: [buildCandidateFromText(filename, extraction.text)],
      attempts: [aiAttempt],
      requiresManualCorrection: aiConfidence < 70,
      scannedPdfDetected: scannedPdf,
      feedback: {
        requested: aiConfidence < 70,
        hint: 'Manual corrections improve parsing quality for future uploads.',
      },
    }
  }

  const ocrAttempt = await runOcrWithCache({ fileBuffer, mimeType })
  const overallConfidence = Math.max(aiConfidence, ocrAttempt.confidence)

  return {
    methodUsed: 'ocr-fallback',
    confidence: overallConfidence,
    extractedTextLength: (ocrAttempt.text || '').length,
    rawText: ocrAttempt.text,
    candidates: [buildCandidateFromText(filename, ocrAttempt.text || extraction.text)],
    attempts: [
      aiAttempt,
      {
        method: ocrAttempt.method,
        provider: ocrAttempt.provider,
        confidence: ocrAttempt.confidence,
        cacheHit: Boolean(ocrAttempt.cacheHit),
        status: 'success',
      },
    ],
    requiresManualCorrection: overallConfidence < 70,
    scannedPdfDetected: scannedPdf,
    feedback: {
      requested: overallConfidence < 70,
      hint: 'Manual corrections improve parsing quality for future uploads.',
    },
  }
}
