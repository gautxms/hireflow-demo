# PDF canonical extraction observe-only rollout (PR 1A)

## Current PDF flow

- PDF uploads are prepared as `application/pdf` binary provider inputs with `inputKind: pdf_binary` and `inputMode: binary`.
- `extractedText` remains `null` for PDFs and the AI provider receives the original base64 PDF bytes.
- DOCX and enabled legacy DOC files continue to be locally extracted to `text/plain` before AI analysis.

## Observe-only flow

When `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=true`, PDF preparation also runs a local selectable-text extraction diagnostic. The diagnostic result is attached to safe in-memory diagnostics and logged as structured metadata only. It does **not**:

- change `fileBufferBase64`;
- change `preparedMimeType`;
- set PDF `extractedText`;
- replace the binary provider payload;
- trigger a second AI call;
- reject or reroute PDF analysis based on quality classification.

## Feature flag

- Flag: `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED`
- Default: disabled. Only `1`, `true`, `yes`, `on`, or `enabled` enable it.
- Limits:
  - `PDF_CANONICAL_EXTRACTION_MAX_BYTES` defaults to 10 MiB.
  - `PDF_CANONICAL_EXTRACTION_TIMEOUT_MS` defaults to 1500 ms.

Rollback is disabling or removing `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED`.

## Parser/dependency decision

For PR 1A, the implementation uses an internal no-native-dependency selectable-text extractor (`builtin-pdf-selectable-text-v1`) that reads literal and hex text strings from PDF content streams. This keeps the observe-only benchmark rollback-safe while the production PDF scoring path remains unchanged.

Options evaluated:

| Option | Decision | Rationale |
| --- | --- | --- |
| `pdfjs-dist` | Recommended future production-grade candidate, not added in PR 1A | Apache-2.0, Node-compatible pure JavaScript distribution, strong text-content API, and exposes text item positions that can support layout-aware multi-column resume diagnostics. It adds a sizeable package and requires careful worker/build configuration validation in Railway. |
| `pdf-parse` | Not selected | Small API but historically wraps PDF.js and exposes less layout metadata, making multi-column diagnostics harder. |
| Poppler/PDFium/native wrappers | Not selected | Better extraction fidelity in some cases, but native binaries are higher-risk for Railway deployment and rollback. |
| Internal selectable-text extractor | Selected for PR 1A observe-only | No native runtime dependency, no install-time deployment risk, bounded timeout/size controls, and sufficient for synthetic equivalence measurement. It is not a final scoring-input parser. |

Selected parser metadata:

- Package chosen: no external package in PR 1A; internal parser version `builtin-pdf-selectable-text-v1`.
- License: repository MIT code.
- Deployment compatibility: Node.js only, no native binaries, no worker process.
- Memory considerations: buffers are already resident for provider upload; observe-only parsing is bounded by `PDF_CANONICAL_EXTRACTION_MAX_BYTES` and does not persist raw text.
- Timeout considerations: parser loop checks a deadline and returns `parser_timeout` on timeout.
- Package-size impact: no new package size in PR 1A.
- Rollback procedure: disable `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED`.

Before PR 1B changes scoring inputs, collect enough observe-only evidence to decide whether to promote `pdfjs-dist` or another parser for production scoring.

## Quality classifications and thresholds

Classifications are diagnostic only:

- `usable_text_extraction`: text length and density look sufficient, printable ratio is acceptable, and OCR is not indicated.
- `low_text_density`: text exists but is short, sparse, or low-density relative to bytes/pages.
- `likely_scanned_pdf`: no or extremely little selectable text; OCR may be required in a future PR.
- `suspicious_noise`: printable-character ratio below 0.92 or suspicious-noise ratio above 0.05.
- `malformed_pdf`: missing PDF magic header or invalid empty input.
- `parser_timeout`: deadline exceeded.
- `parser_error`: controlled parser failure or size-limit failure.

Conservative thresholds:

- OCR heuristic: total canonical text below 80 characters or below 80 characters/page.
- Likely scanned: zero text or below 20 characters/page.
- Low density: below 200 canonical characters, below 120 characters/page, or below 0.015 text characters per input byte.
- Suspicious noise: suspicious-noise ratio above 5% or printable ratio below 92%.

These thresholds must not reject, reroute, or rescore PDFs in PR 1A.

## Safe diagnostic metadata

Structured logs include only PII-safe fields:

```json
{
  "enabled": true,
  "success": true,
  "extractionMethod": "pdf_selectable_text_observe_only_builtin",
  "parserVersion": "builtin-pdf-selectable-text-v1",
  "durationMs": 4.12,
  "inputByteSize": 1820,
  "pageCount": 1,
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
```

Never log raw extracted resume text, candidate names, emails, phone numbers, filenames, or binary content.

## Synthetic test corpus

The diagnostic fixtures cover:

- standard single-column selectable-text PDF;
- multi-column-like text ordering fixture;
- bullets;
- employment date ranges;
- tables;
- headers and footers;
- selectable-text PDFs;
- image-only/missing-text PDFs;
- malformed PDFs;
- large PDFs within upload constraints.

The harness compares PDF observe-only diagnostics to equivalent DOCX/DOC fixtures using normalized fingerprints, marker coverage, text-length variance, date-range preservation, skills preservation, and practical section-order signals.

## Evidence required before PR 1B

Do not change PDF scoring inputs until observe-only data shows:

1. High fingerprint/marker equivalence across representative PDF/DOCX resume pairs.
2. Stable date-range, skills, and section-order preservation for multi-column and table-like resumes.
3. Acceptable parser timeout and memory behavior in Railway.
4. Low malformed/parser-error rates on real uploads.
5. Clear handling plan for scanned/image-only PDFs, likely requiring OCR in a separate PR.
6. No PII/raw text leakage in logs.

## Remaining risks

- The internal extractor is intentionally conservative and not layout-complete.
- Some PDFs encode text in compressed or font-mapped forms this PR may classify as low density/scanned.
- Observe-only extraction adds bounded CPU work when enabled.
- A production scoring change still needs a stronger parser decision and wider corpus evidence.
