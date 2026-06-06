import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
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
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function buildTextItemsFromLines(lines = [], { columns = 1 } = {}) {
  return lines.flatMap((line, index) => {
    const column = columns > 1 ? index % columns : 0
    const row = columns > 1 ? Math.floor(index / columns) : index
    return [{
      str: line,
      transform: [11, 0, 0, 11, column === 0 ? 72 : 320, 740 - (row * 18)],
      width: Math.max(20, String(line).length * 5.5),
      height: 11,
    }]
  })
}

function buildContentStreamFromTextItems(items = [], { splitText = false } = {}) {
  const operations = ['BT', '/F1 11 Tf']
  for (const item of items) {
    const transform = Array.isArray(item.transform) ? item.transform : [11, 0, 0, 11, 72, 720]
    const x = Number(transform[4] || 72)
    const y = Number(transform[5] || 720)
    operations.push(`1 0 0 1 ${x} ${y} Tm`)
    if (splitText && String(item.str || '').length > 12) {
      const midpoint = Math.floor(String(item.str).length / 2)
      operations.push(`(${escapePdfText(String(item.str).slice(0, midpoint))}) Tj`)
      operations.push(`(${escapePdfText(String(item.str).slice(midpoint))}) Tj`)
    } else {
      operations.push(`(${escapePdfText(item.str)}) Tj`)
    }
  }
  operations.push('ET')
  return operations.join('\n')
}

function buildSimpleSelectablePdf({
  pages = [SYNTHETIC_CANONICAL_RESUME_TEXT],
  largePaddingBytes = 0,
  compressed = true,
  splitText = false,
  columns = 1,
  fixtureId = 'synthetic-pdf',
} = {}) {
  const objects = []
  const pageRefs = []
  const pageTextItems = pages.map((pageText) => buildTextItemsFromLines(String(pageText || '').split('\n'), { columns }))
  const addObject = (body) => {
    objects.push(body)
    return objects.length
  }

  addObject('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(null)
  addObject(`<< /Title (${escapePdfText(fixtureId)}) /Producer (Synthetic PDF fixture generator) >>`)

  for (const items of pageTextItems) {
    const streamText = `${buildContentStreamFromTextItems(items, { splitText })}${largePaddingBytes > 0 ? `\n% ${'x'.repeat(largePaddingBytes)}` : ''}`
    const streamBuffer = Buffer.from(streamText, 'utf8')
    const encodedStream = compressed ? deflateSync(streamBuffer) : streamBuffer
    const filter = compressed ? ' /Filter /FlateDecode' : ''
    const contentId = addObject(`<< /Length ${encodedStream.length}${filter} >>\nstream\n${encodedStream.toString('binary')}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> >> /Contents ${contentId} 0 R >>`)
    pageRefs.push(`${pageId} 0 R`)
  }

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>`
  let pdf = '%PDF-1.7\n% synthetic-fixture: no-pii\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return { buffer: Buffer.from(pdf, 'binary'), pageTextItems }
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

export function buildSyntheticPdfResumeFixture({ text = SYNTHETIC_CANONICAL_RESUME_TEXT, filename = 'synthetic-equivalent-resume.pdf', id = 'synthetic-pdf', compressed = true, splitText = false, columns = 1 } = {}) {
  const pdf = buildSimpleSelectablePdf({ pages: [text], compressed, splitText, columns, fixtureId: id })
  return {
    id,
    filename,
    mimeType: 'application/pdf',
    buffer: pdf.buffer,
    expectedPdfTextItems: pdf.pageTextItems,
  }
}

export function buildMultiColumnPdfResumeFixture() {
  return buildSyntheticPdfResumeFixture({
    id: 'synthetic-multi-column-pdf',
    filename: 'synthetic-multi-column-resume.pdf',
    text: [
      'Summary: Synthetic Candidate Alpha builds recruiting systems. Skills: Node.js, PostgreSQL, Redis.',
      'Experience: Senior Software Engineer, Example Hiring Labs, 2021-2026. Education: Example State University.',
      'Projects: Accessibility reporting dashboards.',
      'Certification: AWS Certified Developer Associate.',
    ].join('\n'),
    columns: 2,
  })
}

export function buildBulletsPdfResumeFixture() {
  return buildSyntheticPdfResumeFixture({
    id: 'synthetic-bullets-pdf',
    filename: 'synthetic-bullets-resume.pdf',
    text: `${SYNTHETIC_CANONICAL_RESUME_TEXT}\n• Built Node.js services\n• Improved PostgreSQL reporting`,
    splitText: true,
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
    expectedPdfTextItems: [[]],
  }
}

export function buildLargePdfResumeFixture() {
  const pdf = buildSimpleSelectablePdf({ pages: [SYNTHETIC_CANONICAL_RESUME_TEXT], largePaddingBytes: 256 * 1024, fixtureId: 'synthetic-large-pdf' })
  return {
    id: 'synthetic-large-pdf',
    filename: 'synthetic-large-resume.pdf',
    mimeType: 'application/pdf',
    buffer: pdf.buffer,
    expectedPdfTextItems: pdf.pageTextItems,
  }
}

export function buildMissingTextPdfFixture() {
  return {
    id: 'synthetic-missing-text-pdf',
    filename: 'synthetic-missing-text-resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /XObject /Subtype /Image >>\nendobj\n%%EOF', 'utf8'),
    expectedPdfTextItems: [[]],
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

export function buildPdfJsTextContentMockFromFixtures(fixtures = []) {
  const queue = fixtures.map((fixture) => fixture.expectedPdfTextItems || [[]])
  return {
    version: '5.4.394-test-mock',
    getDocument() {
      const pages = queue.shift() || [[]]
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          getPage: async (pageNumber) => ({
            getTextContent: async () => ({ items: pages[pageNumber - 1] || [] }),
            cleanup() {},
          }),
          destroy: async () => {},
        }),
        destroy: async () => {},
      }
    },
  }
}
