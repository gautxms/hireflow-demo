import { useMemo, useState } from 'react'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const SESSION_UPLOAD_KEY = 'hireflow-resume-uploaded'

const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/

let pdfjsPromise

const getPdfJs = async () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/+esm').then((module) => {
      module.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs'
      return module
    })
  }

  return pdfjsPromise
}

const normalizeWhitespace = (text) => text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

const parseDeterministicFields = (rawText) => {
  const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean)

  const nameCandidate = lines.find((line) => {
    if (line.length > 60 || /\d|@/.test(line)) {
      return false
    }

    return /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,4}$/.test(line) || /^[A-Z\s'.-]+$/.test(line)
  }) || lines[0]

  const sectionsFound = ['Experience', 'Skills', 'Education'].filter((section) => {
    const sectionRegex = new RegExp(`(^|\\n)\\s*${section}\\s*(:|$)`, 'im')
    return sectionRegex.test(rawText)
  })

  return {
    name: nameCandidate || 'Not detected',
    email: rawText.match(emailRegex)?.[0] || 'Not detected',
    phone: rawText.match(phoneRegex)?.[0] || 'Not detected',
    sectionsFound
  }
}

const extractPdfData = async (file) => {
  const pdfjs = await getPdfJs()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument({ data: bytes })
  const document = await loadingTask.promise

  const pageTexts = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    pageTexts.push(pageText)
  }

  const rawText = normalizeWhitespace(pageTexts.join('\n\n'))

  if (!rawText) {
    throw new Error('NO_EXTRACTABLE_TEXT')
  }

  return {
    rawText,
    pageCount: document.numPages,
    parsedFields: parseDeterministicFields(rawText)
  }
}

export default function ResumeUploader({ onFileUploaded, onBack }) {
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const alreadyUploaded = useMemo(() => sessionStorage.getItem(SESSION_UPLOAD_KEY) === 'true', [])

  const validateFile = (file) => {
    if (!file) {
      return 'Please select a PDF file.'
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      return 'Only PDF files are supported right now.'
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return 'File is too large. Maximum size is 5MB.'
    }

    return null
  }

  const handleUpload = async (file) => {
    const validationError = validateFile(file)
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    if (alreadyUploaded) {
      setErrorMessage('Only one upload is allowed per session.')
      return
    }

    setErrorMessage('')
    setIsParsing(true)

    try {
      const extracted = await extractPdfData(file)
      const payload = {
        fileMetadata: {
          filename: file.name,
          uploadTimestamp: new Date().toISOString(),
          pageCount: extracted.pageCount,
          size: file.size
        },
        parsedFields: extracted.parsedFields,
        rawText: extracted.rawText
      }

      sessionStorage.setItem(SESSION_UPLOAD_KEY, 'true')
      onFileUploaded(payload)
    } catch (error) {
      if (error?.message === 'NO_EXTRACTABLE_TEXT') {
        setErrorMessage('This resume appears to be image-based. OCR not supported yet.')
      } else {
        setErrorMessage('Unable to process this PDF. Please try another file.')
      }
    } finally {
      setIsParsing(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    handleUpload(e.dataTransfer.files?.[0])
  }

  const handleFileInput = (e) => {
    handleUpload(e.target.files?.[0])
    e.target.value = ''
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>
            ← Back
          </button>
        )}

        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.75rem', fontFamily: 'var(--font-display)' }}>Resume Upload</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.25rem' }}>This is a real-time preview of how Hireflow currently reads resumes.</p>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          style={{ border: isDragging ? '2px solid var(--accent)' : '2px dashed var(--border)', borderRadius: '12px', padding: '2.5rem', textAlign: 'center', background: isDragging ? 'rgba(232,255,90,0.05)' : 'var(--card)' }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📄</div>
          <p style={{ marginBottom: '0.5rem' }}>Upload a single PDF resume (max 5MB).</p>
          <p style={{ color: 'var(--muted)', marginBottom: '1.25rem' }}>One upload per session. No login required.</p>
          <input type="file" accept="application/pdf,.pdf" onChange={handleFileInput} style={{ display: 'none' }} id="fileInput" disabled={isParsing || alreadyUploaded} />
          <label htmlFor="fileInput" style={{ cursor: isParsing || alreadyUploaded ? 'not-allowed' : 'pointer' }}>
            <button type="button" disabled={isParsing || alreadyUploaded} style={{ background: 'var(--accent)', color: 'var(--ink)', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: isParsing || alreadyUploaded ? 'not-allowed' : 'pointer', opacity: isParsing || alreadyUploaded ? 0.5 : 1 }}>
              {isParsing ? 'Extracting text...' : 'Select PDF'}
            </button>
          </label>
        </div>

        {alreadyUploaded && (
          <p style={{ marginTop: '1rem', color: 'var(--muted)' }}>A resume has already been uploaded in this session.</p>
        )}

        {errorMessage && (
          <div style={{ marginTop: '1rem', background: 'rgba(239,68,68,0.15)', color: '#fecaca', border: '1px solid rgba(239,68,68,0.5)', borderRadius: '8px', padding: '0.875rem 1rem' }}>
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}
