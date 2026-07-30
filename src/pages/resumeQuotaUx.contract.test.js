import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const analysesSource = await readFile(new URL('./AnalysesPage.jsx', import.meta.url), 'utf8')
const uploaderSource = await readFile(new URL('../components/ResumeUploader.jsx', import.meta.url), 'utf8')

test('both analysis entry points use the shared canonical quota hook', () => {
  assert.match(analysesSource, /useResumeAnalysisQuota\(\{ enabled: !isReadOnly \}\)/)
  assert.match(uploaderSource, /useResumeAnalysisQuota\(\{ enabled: isAuthenticated \}\)/)
})

test('canonical hook retains focus, reconnect, and visibility revalidation', async () => {
  const hookSource = await readFile(new URL('../hooks/useResumeAnalysisQuota.js', import.meta.url), 'utf8')
  assert.match(hookSource, /addEventListener\('focus', refreshIfCurrent\)/)
  assert.match(hookSource, /addEventListener\('online', refreshIfCurrent\)/)
  assert.match(hookSource, /addEventListener\('visibilitychange', handleVisibilityChange\)/)
  assert.match(hookSource, /store: createResumeAnalysisQuotaStore/)
})


test('canonical quota state is scoped to the current authentication identity', async () => {
  const hookSource = await readFile(new URL('../hooks/useResumeAnalysisQuota.js', import.meta.url), 'utf8')
  assert.match(hookSource, /async function loadResumeAnalysisQuota\(token\)/)
  assert.match(hookSource, /const quotaRecords = new Map\(\)/)
  assert.match(hookSource, /loadQuota: \(\) => loadResumeAnalysisQuota\(token\)/)
  assert.match(hookSource, /addEventListener\('storage', handleStorage\)/)
  assert.match(hookSource, /quotaRecords\.delete\(token\)/)
})

test('both entry points refresh canonical quota after accepted initialization and rejection', () => {
  assert.match(analysesSource, /remainingUploadResults[\s\S]*await resumeQuota\.refresh\(\)/)
  assert.match(analysesSource, /isResumeQuotaRejection\(submitFailure\)[\s\S]*await resumeQuota\.refresh\(\)/)
  assert.match(uploaderSource, /remainingUploadResults[\s\S]*await resumeQuota\.refresh\(\)/)
  assert.match(uploaderSource, /isResumeQuotaRejection\(err\)[\s\S]*await resumeQuota\.refresh\(\)/)
})


test('both submission paths retire completed preflight attempts without discarding ambiguous retries', () => {
  assert.match(analysesSource, /if \(released\) retireResumeQuotaBatchKey\(quotaBatchKey\)/)
  assert.match(analysesSource, /remainingUploadResults[\s\S]*retireResumeQuotaBatchKey\(quotaBatchKey\)[\s\S]*await resumeQuota\.refresh\(\)/)
  assert.match(uploaderSource, /if \(released\) retireResumeQuotaBatchKey\(quotaBatchKey\)/)
  assert.match(uploaderSource, /remainingUploadResults[\s\S]*retireResumeQuotaBatchKey\(quotaBatchKey\)[\s\S]*await resumeQuota\.refresh\(\)/)
})

test('quota blocking preserves historical navigation and selected-file controls', () => {
  assert.match(analysesSource, /href=\{`\/analyses\/\$\{analysis\.id\}`\}/)
  assert.match(analysesSource, /onRemoveSelectedFile\(getFileKey\(file\)\)/)
  assert.match(analysesSource, /disabled=\{isSubmitting \|\| quotaPending \|\| quotaBlocked \|\| Boolean\(batchGuidance\)\}/)
  assert.match(uploaderSource, /disabled=\{uploadedFiles\.length === 0 \|\| isAnalyzing \|\| quotaPending \|\| quotaBlocked \|\| Boolean\(quotaBatchGuidance\)\}/)
})

test('usage API failure does not proactively block either submission path', () => {
  assert.doesNotMatch(analysesSource, /resumeQuota\.status === 'unavailable'[\s\S]{0,120}return/)
  assert.doesNotMatch(uploaderSource, /resumeQuota\.status === 'unavailable'[\s\S]{0,120}return/)
})
