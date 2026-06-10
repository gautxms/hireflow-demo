# PDF canonical extraction observe-only rollout (PR 1A)

## RCA: production-only safety gap

PR #974 added non-blocking, observe-only PDF canonical extraction diagnostics with `pdfjs-dist/legacy/build/pdf.mjs`. That implementation was intentionally shadow-only, but HireFlow currently has only a production environment. A single global enablement flag is therefore too broad: setting `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=true` would run the parser for every production PDF upload.

This update keeps the master kill switch disabled by default and adds internal allowlisting plus deterministic sampling so validation can start with controlled uploads only.

## Current PDF flow and insertion point

- PDF uploads enter `prepareResumePayloadForAnalysis()` from the AI analysis path and the async parse job path.
- The async parse job already has `userId`, `analysisId`, `resumeId`, parse-job ID, file metadata, and safe file-content fingerprints available through diagnostics context.
- The smallest safe insertion point is inside the existing PDF branch of `prepareResumePayloadForAnalysis()`, immediately before the observe-only parser is called.
- The eligibility decision only controls whether diagnostics run; it does not alter the prepared scoring payload.
- PDF scoring remains `preparedMimeType: application/pdf`, `inputKind: pdf_binary`, `inputMode: binary`, `extractedText: null`, and `base64File` set to the original PDF base64 payload.

DOCX and enabled legacy DOC files continue to be locally extracted to `text/plain` before AI analysis. This rollout does not change DOCX, legacy DOC, retry/fallback, ranking, rendering, or historical data behavior.

## Observe-only flow

When a PDF is eligible, preparation runs local selectable-text diagnostics using PDF.js text-content extraction. The diagnostic result is attached to safe in-memory diagnostics and logged as structured metadata only. It does **not**:

- change `fileBufferBase64`;
- change `preparedMimeType`;
- set PDF `extractedText`;
- replace the binary provider payload;
- trigger a second AI call;
- reject or reroute PDF analysis based on quality classification.

If eligibility evaluation or parsing fails, the existing PDF binary analysis flow continues and the failure is represented only as controlled diagnostics.

## Environment variables

| Variable | Default | Behavior |
| --- | --- | --- |
| `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED` | `false` | Master kill switch. Only `1`, `true`, `yes`, `on`, or `enabled` enable any observe-only parsing. Missing or false means the parser never runs. |
| `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE` | `0` | Deterministic sampling percentage from `0` to `100`. Missing, empty, invalid, negative, and above-`100` values fail closed to `0`. |
| `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS` | empty | Comma-separated internal user IDs. Whitespace is trimmed. Empty entries are ignored. Do not use emails. |
| `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS` | empty | Comma-separated analysis IDs. Whitespace is trimmed. Empty entries are ignored. |
| `PDF_CANONICAL_EXTRACTION_MAX_BYTES` | `5242880` | Existing parser byte cap. |
| `PDF_CANONICAL_EXTRACTION_TIMEOUT_MS` | `1500` | Existing parser timeout cap. |
| `PDF_CANONICAL_EXTRACTION_MAX_PAGES` | `20` | Existing parser page cap. |

Rollback is setting `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=false`. No DB migration or scoring rollback is required.

## Eligibility order

When preparing a PDF:

1. If the master flag is missing or false, eligibility is `master_disabled` and the parser does not run.
2. If the current user ID matches `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS`, eligibility is `user_allowlist`.
3. Else, if the current analysis ID matches `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS`, eligibility is `analysis_allowlist`.
4. Else, if the sample rate is greater than `0`, deterministic sampling is evaluated.
5. Otherwise eligibility is `not_selected` and the parser does not run.

## Deterministic sampling algorithm

Sampling uses only safe stable identifiers. The preferred identifier is the existing non-reversible file-content fingerprint; if that is unavailable, the code falls back to resume ID and then analysis ID. It never uses raw filename, email address, candidate name, phone number, resume text, binary content, or `Math.random()`.

Algorithm:

1. Hash `pdf-canonical-observe-only-sampling-v1:<stable identifier>` with SHA-256.
2. Read the first 12 hex characters of the hash.
3. Convert that value to an integer and map it into bucket `0..9999` with modulo `10000`.
4. Accept only configured sample rates from `0` through `100`; missing, empty, invalid, negative, and above-`100` values become `0`.
5. Convert the configured percentage to a threshold with `Math.floor(sampleRate * 100)`.
6. Select the upload when `bucket < threshold`.

Examples:

- sample rate `0` has no threshold and never samples;
- sample rate `1` selects buckets `0..99`;
- sample rate `5` selects buckets `0..499`;
- sample rate `100` selects every non-empty stable identifier;
- sample rates such as `100.5`, `250`, or `1000` fail closed to `0` and select nothing.

The same file-content fingerprint produces the same bucket and decision across runs.


## Duplicate-parser guard

The async parse path prepares the resume before AI analysis and the AI analysis service also normalizes inputs before calling a provider. Without a guard, an eligible PDF could run observe-only parsing once in `runParse()` and again inside `analyzeResumeWithConfiguredFallback()`, doubling local parser CPU for the same resume.

The parse job now passes a narrow diagnostics marker to the AI analysis call after the first preparation step. The second preparation reuses the prior safe `observeOnlyEligibility` and `pdfCanonicalExtractionObserveOnly` diagnostics and skips local observe-only extraction. Provider retry/fallback attempts reuse the single prepared payload, so retries do not trigger additional observe-only parsing.

## Safe diagnostic metadata

A PII-safe eligibility decision log is emitted for every PDF preparation decision, including master-disabled and not-selected uploads. The eligibility log contains only `masterEnabled`, `eligible`, `eligibilityReason`, `allowlistMatched`, `matchedAllowlistType`, `sampled`, `sampleRate`, and `samplingBucket`.

Structured diagnostics include eligibility fields and parser metrics only:

```json
{
  "observeOnlyEligibility": {
    "masterEnabled": true,
    "eligible": true,
    "eligibilityReason": "user_allowlist",
    "allowlistMatched": true,
    "matchedAllowlistType": "user_id",
    "sampled": false,
    "sampleRate": 0,
    "samplingBucket": null
  },
  "pdfCanonicalExtractionObserveOnly": {
    "enabled": true,
    "success": true,
    "extractionMethod": "pdfjs_dist_text_content_observe_only",
    "parserVersion": "5.4.394",
    "durationMs": 12.4,
    "inputByteSize": 1820,
    "pageCount": 1,
    "pagesRead": 1,
    "observationTruncated": false,
    "pageLimitReached": false,
    "lineCount": 7,
    "extractedTextLength": 361,
    "canonicalTextLength": 361,
    "normalizedFingerprint": "<sha256>",
    "printableRatio": 1,
    "suspiciousNoiseRatio": 0,
    "duplicateLineRatio": 0,
    "safeSectionMarkerCoverage": { "expected": 6, "found": 4, "ratio": 0.6667 },
    "qualityClassification": "usable_text_extraction",
    "ocrRequired": false,
    "failureCategory": null
  }
}
```

Allowed eligibility reasons are `master_disabled`, `user_allowlist`, `analysis_allowlist`, `deterministic_sample`, and `not_selected`. Allowed allowlist match types are `user_id`, `analysis_id`, and `null`.

Never log raw extracted resume text, candidate names, emails, phone numbers, filenames, or binary content. Ordinary observe-only logs should prefer boolean match fields, reasons, fingerprints, counts, timings, and classifications rather than raw identifiers.

## Parser/dependency decision

PR 1A uses `pdfjs-dist` as the observe-only parser so diagnostics exercise the likely production candidate rather than a handcrafted parser.

| Item | Decision |
| --- | --- |
| Package | `pdfjs-dist` |
| Version | `5.4.394` pinned exactly in `package.json` and `package-lock.json` |
| License | Apache-2.0 |
| Import target | `pdfjs-dist/legacy/build/pdf.mjs` |
| Worker configuration | Observe-only extraction passes `disableWorker: true` and uses the legacy ESM build in-process to avoid worker asset deployment/configuration fragility on Railway. |
| Timeout considerations | The wrapper races PDF.js document/page/text-content promises against `PDF_CANONICAL_EXTRACTION_TIMEOUT_MS`, destroys the loading task on timeout, checks deadlines between pages and text-item layout passes, and returns `parser_timeout` as diagnostics only. |
| Rollback procedure | Disable `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED`; no DB migration or scoring rollback is required. |

Native Poppler/PDFium wrappers were rejected for PR 1A because they introduce deployment-specific binaries. `pdf-parse` was rejected because it wraps/abstracts PDF.js with less direct access to layout-position metadata needed for multi-column diagnostics.

## Quality classifications and thresholds

Classifications are diagnostic only:

- `usable_text_extraction`: text length and density look sufficient, printable ratio is acceptable, and OCR is not indicated.
- `low_text_density`: text exists but is short, sparse, or low-density relative to bytes/pages.
- `likely_scanned_pdf`: no or extremely little selectable text; OCR may be required in a future PR.
- `suspicious_noise`: printable-character ratio below 0.92 or suspicious-noise ratio above 0.05.
- `malformed_pdf`: missing PDF magic header or invalid empty input.
- `dependency_error`: `pdfjs-dist` production import or required API is unavailable.
- `file_too_large`: the file exceeds `PDF_CANONICAL_EXTRACTION_MAX_BYTES`.
- `parser_timeout`: deadline exceeded.
- `parser_error`: controlled parser failure not covered by the more specific categories.

These thresholds must not reject, reroute, or rescore PDFs in PR 1A.

## Production-only internal rollout sequence

1. Deploy with:
   - `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=false`
2. Add the remaining variables while still disabled:
   - `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE=0`
   - `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS=<internal user ID>`
   - `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS=`
3. Enable:
   - `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=true`
4. Upload controlled internal PDF and DOCX fixtures only.
5. Monitor:
   - `eligibilityReason`;
   - extraction duration;
   - `qualityClassification`;
   - `failureCategory`;
   - `ocrRequired`;
   - `pageCount`;
   - `pagesRead`;
   - `observationTruncated`;
   - marker coverage;
   - worker latency;
   - async completion behavior.
6. Roll back immediately by setting:
   - `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=false`
7. Only after internal validation, consider:
   - `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE=1`
8. Expand gradually to `5` only after reviewing latency and parser-error rates.

Do not enable broad sampling automatically.

## Evidence required before PR 1B

Do not change PDF scoring inputs until observe-only data shows:

1. High fingerprint/marker equivalence across representative PDF/DOCX resume pairs.
2. Stable date-range, skills, and section-order preservation for multi-column and table-like resumes.
3. Acceptable parser timeout and memory behavior in Railway.
4. Low malformed/parser-error rates on real uploads.
5. Clear handling plan for scanned/image-only PDFs, likely requiring OCR in a separate PR.
6. No PII/raw text leakage in logs.

## Known limitations

- PDF.js timeout is enforced around async document/page/text-content calls and between layout passes, but CPU inside PDF.js cannot be interrupted at every instruction; conservative size/page limits mitigate this.
- `disableWorker: true` avoids Railway worker asset complexity but runs parsing in the current process when enabled.
- Some PDFs with unusual font maps can still produce sparse or noisy text and should remain diagnostics-only until corpus evidence is reviewed.
- OCR and PR 1B scoring changes are intentionally out of scope.
