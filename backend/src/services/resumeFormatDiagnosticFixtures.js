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


function escapePdfText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ') Tj T* (')
}

function buildSimpleSelectablePdf({ pages = [SYNTHETIC_CANONICAL_RESUME_TEXT], largePaddingBytes = 0 } = {}) {
  const objects = []
  const pageRefs = []
  const addObject = (body) => {
    objects.push(body)
    return objects.length
  }

  addObject('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(null)

  for (const pageText of pages) {
    const stream = `BT /F1 11 Tf 72 740 Td (${escapePdfText(pageText)}) Tj ET${largePaddingBytes > 0 ? `\n% ${'x'.repeat(largePaddingBytes)}` : ''}`
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>`)
    pageRefs.push(`${pageId} 0 R`)
  }

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>`
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}

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

export function buildSyntheticPdfResumeFixture({ text = SYNTHETIC_CANONICAL_RESUME_TEXT, filename = 'synthetic-equivalent-resume.pdf', id = 'synthetic-pdf' } = {}) {
  return {
    id,
    filename,
    mimeType: 'application/pdf',
    buffer: buildSimpleSelectablePdf({ pages: [text] }),
  }
}

export function buildMultiColumnPdfResumeFixture() {
  return buildSyntheticPdfResumeFixture({
    id: 'synthetic-multi-column-pdf',
    filename: 'synthetic-multi-column-resume.pdf',
    text: [
      'Summary: Synthetic Candidate Alpha builds recruiting systems. Skills: Node.js, PostgreSQL, Redis.',
      'Experience: Senior Software Engineer, Example Hiring Labs, 2021-2026. Education: Example State University.',
    ].join('\n'),
  })
}

export function buildBulletsPdfResumeFixture() {
  return buildSyntheticPdfResumeFixture({
    id: 'synthetic-bullets-pdf',
    filename: 'synthetic-bullets-resume.pdf',
    text: `${SYNTHETIC_CANONICAL_RESUME_TEXT}\n• Built Node.js services\n• Improved PostgreSQL reporting`,
  })
}

export function buildTablesPdfResumeFixture() {
  return buildSyntheticPdfResumeFixture({
    id: 'synthetic-tables-pdf',
    filename: 'synthetic-tables-resume.pdf',
    text: `${SYNTHETIC_CANONICAL_RESUME_TEXT}\nSkill | Evidence\nNode.js | Production APIs\nPostgreSQL | Analytics schema`,
  })
}

export function buildHeaderFooterPdfResumeFixture() {
  return buildSyntheticPdfResumeFixture({
    id: 'synthetic-header-footer-pdf',
    filename: 'synthetic-header-footer-resume.pdf',
    text: `Resume\n${SYNTHETIC_CANONICAL_RESUME_TEXT}\nPage 1 of 1\nConfidential`,
  })
}

export function buildMalformedPdfFixture() {
  return {
    id: 'synthetic-malformed-pdf',
    filename: 'synthetic-malformed-resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not actually a pdf', 'utf8'),
  }
}

export function buildLargePdfResumeFixture() {
  return {
    id: 'synthetic-large-pdf',
    filename: 'synthetic-large-resume.pdf',
    mimeType: 'application/pdf',
    buffer: buildSimpleSelectablePdf({ pages: [SYNTHETIC_CANONICAL_RESUME_TEXT], largePaddingBytes: 256 * 1024 }),
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
