import { Buffer } from 'node:buffer'
import JSZip from 'jszip'

export const LEGACY_DOC_MIME_TYPE = 'application/msword'
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

function legacyDocBufferFromText(text, { includeAsciiShadow = false } = {}) {
  const utf16Text = Buffer.from(String(text || ''), 'utf16le')
  const asciiShadow = includeAsciiShadow
    ? Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from(String(text || ''), 'utf8')])
    : Buffer.alloc(0)
  return Buffer.concat([OLE_HEADER, Buffer.alloc(32), utf16Text, asciiShadow])
}

export const validLegacyDocFixtures = [
  {
    name: 'legacy-doc-normal-paragraphs',
    filename: 'synthetic-normal-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: legacyDocBufferFromText(`Avery Stone\nSoftware Engineer\nSkills: JavaScript, Node.js, PostgreSQL\nEducation: B.S. Computer Science, Example State University\nExperience: Software Engineer at Northstar Labs building recruiting workflow APIs.`),
    expectedMarkers: ['Avery Stone', 'JavaScript', 'PostgreSQL', 'Example State University', 'Northstar Labs'],
  },
  {
    name: 'legacy-doc-headings-and-bullets',
    filename: 'synthetic-bulleted-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: legacyDocBufferFromText(`Jordan Lee\nSUMMARY\nRecruiting operations analyst focused on automation.\nSKILLS\n• Python\n• SQL\n• Tableau\nEDUCATION\nB.A. Economics, Example City College\nEXPERIENCE\nTalent Operations Analyst, Beacon Recruiting Studio`),
    expectedMarkers: ['Jordan Lee', 'Python', 'Tableau', 'Example City College', 'Beacon Recruiting Studio'],
  },
  {
    name: 'legacy-doc-tables',
    filename: 'synthetic-table-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: legacyDocBufferFromText(`Morgan Patel\nSection\tDetails\nSkills\tExcel, Power BI, Data Modeling\nEducation\tM.S. Information Systems, Example Tech\nExperience\tAnalytics Consultant at Cedar Metrics`),
    expectedMarkers: ['Morgan Patel', 'Power BI', 'Data Modeling', 'Example Tech', 'Cedar Metrics'],
  },
  {
    name: 'legacy-doc-contact-skills-education-multiple-experience',
    filename: 'synthetic-complete-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: legacyDocBufferFromText(`Casey Rivera\ncasey.rivera@example.invalid | 555-0100\nSkills: React, TypeScript, AWS, Accessibility\nEducation: B.S. Software Engineering, Example Western University\nExperience:\nFrontend Engineer, Atlas Demo Systems - built accessible dashboards.\nUI Developer, Meridian Sample Co - shipped component libraries.`),
    expectedMarkers: ['Casey Rivera', 'React', 'AWS', 'Example Western University', 'Atlas Demo Systems', 'Meridian Sample Co'],
  },
]

export const invalidLegacyDocFixtures = [
  {
    name: 'legacy-doc-corrupt',
    filename: 'synthetic-corrupt-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x01, 0x02]),
    expectedErrorCategory: 'legacy_doc_extraction_failed',
  },
  {
    name: 'legacy-doc-empty',
    filename: 'synthetic-empty-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: Buffer.alloc(0),
    expectedErrorCategory: 'legacy_doc_extraction_failed',
  },
  {
    name: 'legacy-doc-ole-like-not-word-resume',
    filename: 'synthetic-ole-like-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: Buffer.concat([OLE_HEADER, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x80, 0x81])]),
    expectedErrorCategory: 'legacy_doc_extraction_failed',
  },
  {
    name: 'legacy-doc-password-protected-unreadable-simulated',
    filename: 'synthetic-password-protected-resume.doc',
    mimeType: LEGACY_DOC_MIME_TYPE,
    buffer: Buffer.concat([OLE_HEADER, Buffer.from([0x13, 0x37, 0x00, 0xff, 0x10, 0x20, 0x01, 0x02])]),
    expectedErrorCategory: 'legacy_doc_extraction_failed',
  },
]

export async function buildDocxControlFixture() {
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
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Control DOCX Candidate with Mammoth extraction path.</w:t></w:r></w:p></w:body>
</w:document>`)
  return {
    name: 'docx-control',
    filename: 'resume.docx',
    mimeType: DOCX_MIME_TYPE,
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  }
}

export function buildPdfControlFixture() {
  return {
    name: 'pdf-control',
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n% synthetic PDF control\n1 0 obj\n<<>>\nendobj\n%%EOF'),
  }
}

export function buildTxtControlFixture() {
  return {
    name: 'txt-control',
    filename: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Control TXT Candidate\nSkills: Writing, Scheduling\nEducation: Example Institute', 'utf8'),
  }
}

export function buildSameBasenameMixedFormatFixtures({ docBuffer = validLegacyDocFixtures[0].buffer, docxBuffer, pdfBuffer } = {}) {
  return [
    { name: 'same-basename-pdf', filename: 'resume.pdf', mimeType: 'application/pdf', buffer: pdfBuffer || buildPdfControlFixture().buffer },
    { name: 'same-basename-doc', filename: 'resume.doc', mimeType: LEGACY_DOC_MIME_TYPE, buffer: docBuffer },
    { name: 'same-basename-docx', filename: 'resume.docx', mimeType: DOCX_MIME_TYPE, buffer: docxBuffer },
  ]
}
