export const noisyExtractedTextCandidateFixture = {
  id: 'cand-noisy-1',
  name: 'Alex Rivera',
  score: 68,
  summary: 'Resume OCR contained noise, but role history shows backend API ownership and cloud deployments.',
  reasoning: 'Despite OCR artifacts, candidate evidence includes Node.js services, PostgreSQL tuning, and CI/CD delivery.',
  skills_flat: ['Node.js', 'PostgreSQL', 'AWS', 'Docker'],
  education: [{ degree: 'B.S. Computer Science' }],
  experienceEvidence: [
    '2019-2024: Backend Engineer, built production APIs used by payment workflows.',
  ],
  resumeWarnings: ['OCR introduced line breaks and duplicate headers in one section.'],
  extractedTextSample: 'EXPERIENCE ### BACKEND ENGINERR 2019--2024 || node.js apis ... duplicated heading heading',
}

export const placeholderTemplateCandidateFixture = {
  id: 'cand-placeholder-1',
  name: 'Parsing Failed',
  score: 0,
  summary: 'No candidate details extracted. Resume parsing failed.',
  reasoning: 'Unable to extract enough text for reliable resume analysis.',
  skills_flat: [],
  education: [],
  experienceEvidence: [],
  resumeWarnings: ['No reliable resume content available.'],
  extractedTextSample: '...garbled blocks... [content omitted due to OCR failure] ...',
}
