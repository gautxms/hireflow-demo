import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const analysesSource = await readFile(new URL('./AnalysesPage.jsx', import.meta.url), 'utf8')
const uploaderSource = await readFile(new URL('../components/ResumeUploader.jsx', import.meta.url), 'utf8')

test('both analysis entry points use the shared canonical quota hook', () => {
  assert.match(analysesSource, /useResumeAnalysisQuota\(\{ enabled: !isReadOnly \}\)/)
  assert.match(uploaderSource, /useResumeAnalysisQuota\(\{ enabled: isAuthenticated \}\)/)
})

test('both entry points refresh canonical quota after accepted initialization and rejection', () => {
  assert.match(analysesSource, /remainingUploadResults[\s\S]*await resumeQuota\.refresh\(\)/)
  assert.match(analysesSource, /isResumeQuotaRejection\(submitFailure\)[\s\S]*await resumeQuota\.refresh\(\)/)
  assert.match(uploaderSource, /remainingUploadResults[\s\S]*await resumeQuota\.refresh\(\)/)
  assert.match(uploaderSource, /isResumeQuotaRejection\(err\)[\s\S]*await resumeQuota\.refresh\(\)/)
})

test('quota blocking preserves historical navigation and selected-file controls', () => {
  assert.match(analysesSource, /href=\{`\/analyses\/\$\{analysis\.id\}`\}/)
  assert.match(analysesSource, /onRemoveSelectedFile\(getFileKey\(file\)\)/)
  assert.match(analysesSource, /disabled=\{isSubmitting \|\| quotaBlocked \|\| Boolean\(batchGuidance\)\}/)
  assert.match(uploaderSource, /disabled=\{uploadedFiles\.length === 0 \|\| isAnalyzing \|\| quotaBlocked \|\| Boolean\(quotaBatchGuidance\)\}/)
})

test('usage API failure does not proactively block either submission path', () => {
  assert.doesNotMatch(analysesSource, /resumeQuota\.status === 'unavailable'[\s\S]{0,120}return/)
  assert.doesNotMatch(uploaderSource, /resumeQuota\.status === 'unavailable'[\s\S]{0,120}return/)
})
