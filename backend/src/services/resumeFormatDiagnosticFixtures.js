import { Buffer } from 'node:buffer'
import JSZip from 'jszip'

export const SYNTHETIC_CANONICAL_RESUME_TEXT = [
  'Synthetic Candidate Alpha',
  'Professional Summary: backend platform engineer for recruiting workflow systems.',
  'Skills: Node.js, TypeScript, PostgreSQL, Redis, AWS, accessibility.',
  'Experience: Senior Software Engineer, Example Hiring Labs, 2021-2026.',
  'Experience: Software Engineer, Sample Talent Systems, 2018-2021.',
  'Education: B.S. Computer Science, Example State University.',
  'Certification: AWS Certified Developer Associate.',
].join('\n')

export const SYNTHETIC_MARKERS = [
  'Synthetic Candidate Alpha',
  'Node.js',
  'PostgreSQL',
  '2021-2026',
  'Example State University',
]

const OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function buildSyntheticDocxResumeFixture({ text = SYNTHETIC_CANONICAL_RESUME_TEXT, filename = 'synthetic-equivalent-resume.docx' } = {}) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  const paragraphXml = String(text || '').split('\n').map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`).join('')
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphXml}<w:sectPr/></w:body>
</w:document>`)
  return {
    id: 'synthetic-docx',
    filename,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  }
}

export function buildSyntheticLegacyDocResumeFixture({ text = SYNTHETIC_CANONICAL_RESUME_TEXT, filename = 'synthetic-equivalent-resume.doc' } = {}) {
  return {
    id: 'synthetic-doc',
    filename,
    mimeType: 'application/msword',
    buffer: Buffer.concat([OLE_HEADER, Buffer.alloc(32), Buffer.from(String(text || ''), 'utf16le')]),
  }
}

export function buildSyntheticPdfResumeFixture({ text = SYNTHETIC_CANONICAL_RESUME_TEXT, filename = 'synthetic-equivalent-resume.pdf' } = {}) {
  return {
    id: 'synthetic-pdf',
    filename,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7\n% synthetic selectable text marker only\n${String(text || '')}\n%%EOF`, 'utf8'),
  }
}

export function buildMissingTextPdfFixture() {
  return {
    id: 'synthetic-missing-text-pdf',
    filename: 'synthetic-missing-text-resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /XObject /Subtype /Image >>\nendobj\n%%EOF', 'utf8'),
  }
}

export function buildLowQualityLegacyDocFixture() {
  return buildSyntheticLegacyDocResumeFixture({
    text: `Synthetic Candidate Alpha\n${'Page 1'.repeat(8)}\n\u0000\u0000\u0001\u0002`,
    filename: 'synthetic-low-quality-resume.doc',
  })
}

export async function buildEquivalentFormatFixtures() {
  return [
    buildSyntheticPdfResumeFixture(),
    await buildSyntheticDocxResumeFixture(),
    buildSyntheticLegacyDocResumeFixture(),
  ]
}
