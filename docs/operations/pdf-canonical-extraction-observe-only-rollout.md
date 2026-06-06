# PDF canonical extraction observe-only rollout (PR 1A)

## RCA: why the first handcrafted parser was insufficient

The original PR 1A implementation used a handcrafted parser that decoded PDF bytes as Latin-1, regex-matched `stream ... endstream`, and extracted literal/hex strings. That was safe but not representative enough for staging evidence: real resume PDFs often use FlateDecode compressed streams, object streams, embedded/subset fonts, ToUnicode maps, split text operators, and positional text items. A parser tailored to uncompressed literal-string fixtures could misclassify selectable-text PDFs as `likely_scanned_pdf` or `low_text_density`, which would produce misleading evidence for PR 1B.

## Current PDF flow

- PDF uploads are prepared as `application/pdf` binary provider inputs with `inputKind: pdf_binary` and `inputMode: binary`.
- `extractedText` remains `null` for PDFs and the AI provider receives the original base64 PDF bytes.
- DOCX and enabled legacy DOC files continue to be locally extracted to `text/plain` before AI analysis.

## Observe-only flow

When `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=true`, PDF preparation also runs local selectable-text diagnostics using `pdfjs-dist` text-content extraction. The diagnostic result is attached to safe in-memory diagnostics and logged as structured metadata only. It does **not**:

- change `fileBufferBase64`;
- change `preparedMimeType`;
- set PDF `extractedText`;
- replace the binary provider payload;
- trigger a second AI call;
- reject or reroute PDF analysis based on quality classification.

## Feature flag and limits

- Flag: `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED`
- Default: disabled. Only `1`, `true`, `yes`, `on`, or `enabled` enable it.
- Limits:
  - `PDF_CANONICAL_EXTRACTION_MAX_BYTES` defaults to 5 MiB for the observe-only benchmark.
  - `PDF_CANONICAL_EXTRACTION_TIMEOUT_MS` defaults to 1500 ms.
  - `PDF_CANONICAL_EXTRACTION_MAX_PAGES` defaults to 20 pages.

Rollback is disabling or removing `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED`.

## Parser/dependency decision

PR 1A now uses `pdfjs-dist` as the observe-only parser so staging benchmarks exercise the likely production candidate rather than a handcrafted parser.

| Item | Decision |
| --- | --- |
| Package | `pdfjs-dist` |
| Version | `^5.4.394` pinned in `package-lock.json` to `5.4.394` |
| License | Apache-2.0 |
| Import target | `pdfjs-dist/legacy/build/pdf.mjs` |
| Runtime dependency profile | Pure JavaScript PDF.js distribution; no required native runtime dependency. The optional `@napi-rs/canvas` package is not required for text extraction. |
| Node/Railway compatibility | Repository engines require Node `>=20.19.0`; `pdfjs-dist@5.4.394` declares Node `>=20.16.0 || >=22.3.0`, so the current Railway-compatible runtime satisfies it. Local inspection ran on Node `v24.15.0` / npm `11.4.2`. |
| Worker configuration | Observe-only extraction passes `disableWorker: true` and uses the legacy ESM build in-process to avoid worker asset deployment/configuration fragility on Railway. |
| Memory considerations | The upload buffer is already resident for the provider call. Observe-only parsing copies it to `Uint8Array`, reads text-content items only, caps bytes/pages, and never persists raw text. |
| Timeout considerations | The wrapper races PDF.js document/page/text-content promises against `PDF_CANONICAL_EXTRACTION_TIMEOUT_MS`, destroys the loading task on timeout, checks deadlines between pages and text-item layout passes, and returns `parser_timeout` as diagnostics only. PDF.js internals cannot be force-interrupted at every CPU instruction, so rollout uses conservative size/page limits. |
| Package-size impact | Adds the PDF.js distribution package, which is materially larger than the removed internal parser (release dist zip is roughly 6–7 MiB; npm unpacked package is larger because it includes builds/assets/types). |
| Rollback procedure | Disable `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED`; no DB migration or scoring rollback is required. |

Native Poppler/PDFium wrappers were rejected for PR 1A because they introduce deployment-specific binaries. `pdf-parse` was rejected because it wraps/abstracts PDF.js with less direct access to layout-position metadata needed for multi-column diagnostics.

## Quality classifications and thresholds

Classifications are diagnostic only:

- `usable_text_extraction`: text length and density look sufficient, printable ratio is acceptable, and OCR is not indicated.
- `low_text_density`: text exists but is short, sparse, or low-density relative to bytes/pages.
- `likely_scanned_pdf`: no or extremely little selectable text; OCR may be required in a future PR.
- `suspicious_noise`: printable-character ratio below 0.92 or suspicious-noise ratio above 0.05.
- `malformed_pdf`: missing PDF magic header or invalid empty input.
- `parser_timeout`: deadline exceeded.
- `parser_error`: dependency, size-limit, or controlled parser failure.

Conservative thresholds:

- OCR heuristic: total canonical text below 80 characters or below 80 characters/page.
- Likely scanned: zero text or below 20 characters/page.
- Low density: below 200 canonical characters, below 120 characters/page, or below 0.01 text characters per input byte.
- Suspicious noise: suspicious-noise ratio above 5% or printable ratio below 92%.

These thresholds must not reject, reroute, or rescore PDFs in PR 1A.

## Safe diagnostic metadata

Structured logs include only PII-safe fields:

```json
{
  "enabled": true,
  "success": true,
  "extractionMethod": "pdfjs_dist_text_content_observe_only",
  "parserVersion": "5.4.394",
  "durationMs": 12.4,
  "inputByteSize": 1820,
  "pageCount": 1,
  "pagesRead": 1,
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

The diagnostic fixtures use synthetic candidate data only and now include compressed/layout-aware PDFs rather than only uncompressed literal-string PDFs:

- standard selectable-text PDF with FlateDecode-compressed content stream;
- split text across multiple text operations;
- positional text items consumed through PDF.js `getTextContent()`;
- genuine two-column-like positional fixture;
- table-like rows;
- bullets;
- headers and footers;
- employment date ranges;
- WinAnsi font encoding coverage where practical in generated fixtures;
- image-only/missing-text PDF;
- malformed PDF;
- large PDF within upload constraints.

The harness compares PDF observe-only diagnostics to equivalent DOCX/DOC fixtures using normalized fingerprints, marker coverage, text-length variance, date-range preservation, skills preservation, and practical section-order signals.

## Staging validation tooling

Use the existing resume-format diagnostic harness with `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=true`. The helper summary reports only PII-safe aggregate evidence:

- parser success/failure counts and success rate;
- quality-classification counts;
- average/max extraction latency;
- extracted-text length statistics;
- section-marker coverage;
- OCR-required count;
- comparable/equivalent fingerprint pair rates.

No raw text, filenames, emails, phone numbers, candidate names, or binary content are emitted.

## Evidence required before PR 1B

Do not change PDF scoring inputs until observe-only data shows:

1. High fingerprint/marker equivalence across representative PDF/DOCX resume pairs.
2. Stable date-range, skills, and section-order preservation for multi-column and table-like resumes.
3. Acceptable parser timeout and memory behavior in Railway.
4. Low malformed/parser-error rates on real uploads.
5. Clear handling plan for scanned/image-only PDFs, likely requiring OCR in a separate PR.
6. No PII/raw text leakage in logs.

## Staged rollout instructions

1. Keep the flag disabled in production while deploying the code.
2. Enable `PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED=true` in staging with default 5 MiB / 1500 ms / 20-page limits.
3. Run synthetic exported pairs through the diagnostic harness and review only aggregate/fingerprint metadata.
4. Sample a small staging upload cohort and monitor parser latency, timeout/error classifications, and OCR-required rate.
5. If worker latency rises or parser errors spike, disable the flag immediately.
6. Only after stable staging evidence should PR 1B propose changing scoring inputs.

## Known limitations

- PDF.js timeout is enforced around async document/page/text-content calls and between layout passes, but CPU inside PDF.js cannot be interrupted at every instruction; conservative size/page limits mitigate this.
- `disableWorker: true` avoids Railway worker asset complexity but runs parsing in the current process when enabled.
- Some PDFs with unusual font maps can still produce sparse or noisy text and should remain diagnostics-only until corpus evidence is reviewed.
- OCR is intentionally out of scope for PR 1A.
