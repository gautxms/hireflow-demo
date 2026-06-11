# RCA: Legacy `.doc` score inconsistency versus equivalent `.pdf` and `.docx` resumes

Date: 2026-06-11
Scope: Root-cause analysis only. No production scoring, schema, prompt, feature-flag, or provider-routing changes were made.

## Executive summary

The remaining inconsistency is most likely caused by the legacy `.doc` local extraction path, not by async analysis state handling, persistence, JD propagation, provider retry/failover, or the allowlist-only PDF canonical text scoring experiment.

Legacy `.doc` files are converted to `text/plain` through a lightweight byte-run extractor when `ENABLE_LEGACY_DOC_EXTRACTION` is enabled. That extractor scans the raw OLE compound document bytes for UTF-16LE and ASCII text runs, normalizes and de-duplicates exact runs, and passes the result to the AI scorer as extracted text. It does not parse the Word binary document model, section structure, table order, styles, headers/footers, or embedded metadata semantically. Equivalent `.docx` files use Mammoth, while allowlisted PDFs can use pdfjs canonical text scoring when the extraction is eligible and high quality. Therefore the AI provider can receive materially different prompt text for the `.doc` resume even when the human-visible resume is equivalent.

## Observed code paths

### PDF path

- For PDFs, `prepareResumePayloadForAnalysis` evaluates observe-only eligibility and scoring-experiment eligibility independently.
- Canonical PDF extraction runs only when either observe-only or scoring eligibility is true.
- The scoring experiment switches the scoring payload to `text/plain` only when the allowlist eligibility and extraction quality checks pass.
- Otherwise, the PDF payload remains binary provider input.

This matches the current production experiment constraints: canonical PDF scoring remains gated and falls back to binary provider input when disabled, ineligible, or insufficient quality.

### DOCX path

- DOCX files are recognized by MIME type or `.docx` extension.
- The extractor validates ZIP/DOCX structure and `word/document.xml` presence.
- Mammoth `extractRawText` extracts text, then the payload is converted to `text/plain` with `inputKind: extracted_text`.

This path is intentionally separate from legacy `.doc` and does not call the legacy byte-run extractor.

### Legacy DOC path

- Legacy Word detection treats `.doc` extension, `application/msword`, or OLE compound-file magic as a legacy Word document.
- If `ENABLE_LEGACY_DOC_EXTRACTION` is not enabled, legacy `.doc` is rejected before DOCX extraction.
- If enabled, legacy `.doc` is extracted locally and sent to scoring as `text/plain` with `inputKind: extracted_text` and `extractionMethod: legacy_doc_text_extraction`.
- The local extractor reads UTF-16LE and ASCII runs directly from the binary buffer, normalizes line whitespace, removes exact duplicate runs, and returns the result. It does not use Mammoth and does not parse the Word `.doc` layout/document model.

## Why this explains the production symptom

The production validation showed all three Priya Nair files completed successfully. Completion success only proves the async pipeline and provider calls completed; it does not prove the scorer saw equivalent content.

For equivalent files, the scorer can receive three different input representations:

1. PDF: canonical pdfjs text when the allowlisted scoring experiment selects it; otherwise binary provider input.
2. DOCX: Mammoth-extracted plain text.
3. DOC: lightweight raw-byte text runs from the OLE `.doc` file.

The `.doc` path is the weakest equivalence link. It can over-include or under-include content compared with Mammoth/PDF extraction because raw OLE bytes may contain document text, repeated fragments, stale revision/storage text, table cell text in a different order, header/footer artifacts, field code fragments, or internal strings that are not part of the visible resume. Conversely, it can miss content that is encoded or stored in a way the UTF-16LE/ASCII run scan does not capture.

The code already contains a quality-validation script whose recommendation explicitly says synthetic fixtures pass but the current extractor still cannot guarantee full Word structure, tables, or encrypted/corrupt-document detection. That warning is consistent with a real-world `.doc` score drift after PDF canonical scoring was stabilized.

## Factors ruled down

- Async state handling: the production evidence had `summary.total = 3`, `summary.complete = 3`, `summary.failed = 0`, and no processing/pending items, so the symptom is not a stuck or failed async item.
- Persistence path: the parse job persists the AI result, parse diagnostics, and extracted text after success; this path is shared after scoring and is not format-specific for score calculation.
- JD context propagation: the analysis service appends JD context to the same provider prompt framework for text and binary inputs.
- Provider failover/retry: input diagnostics are attached to each attempt; provider selection supports extracted text across providers and PDF binary for Anthropic. There is no DOC-specific provider retry branch that would intentionally alter scoring.
- PDF allowlist behavior: PDF canonical scoring remains gated by eligibility and quality, and the fallback path preserves binary provider input.
- Prompt issue: no prompt branch is specific to legacy `.doc`. The more plausible issue is the content handed to the prompt, not the prompt instructions themselves.

## Recommended follow-up evidence before any fix

Do not broaden the PDF experiment or change scoring yet. First collect safe diagnostics for the exact Priya Nair analysis/resume IDs:

1. Compare `parseDiagnostics.extractionMethod`, `inputKind`, `promptInputMode`, `extractedTextCharCount`, `normalizedTextCharCount`, and `normalizedTextFingerprint` across the `.pdf`, `.docx`, and `.doc` parse results.
2. Compare AI token-usage rows by `parse_job_id`, including `prompt_input_mode`, `input_kind`, provider/model, success/failure attempts, and token counts.
3. Run a redacted local/staging text-equivalence check for the exact `.doc` and `.docx` files using existing fingerprint/quality utilities. Use only hashes, marker coverage, line counts, char counts, duplicate ratios, printable ratios, and suspicious-noise ratios; do not log raw resume text.
4. If permitted in a controlled non-production environment, use a real Word binary parser/converter as an oracle for the Priya `.doc` and compare safe metrics against the current lightweight extractor.

## Proposed fix direction, if evidence confirms extraction drift

This RCA does not implement a fix. If diagnostics confirm `.doc` text drift, the safest follow-up is a separate, feature-flagged legacy-DOC canonical extraction experiment with allowlist and quality gates, analogous to the PDF canonical scoring rollout. Candidate approaches:

- Prefer a controlled, stronger `.doc` conversion/extraction backend for legacy Word files.
- Add quality thresholds before allowing legacy `.doc` extracted text to influence scoring.
- Keep fallback/rejection semantics explicit for low-quality `.doc` extraction.
- Continue logging only safe, non-reversible diagnostics.
- Do not expand PDF canonical scoring as part of this investigation.

## Verification performed

- Inspected the PDF, DOCX, and legacy DOC extraction and scoring code paths.
- Ran the targeted resume extraction and format diagnostic test suites.
- Ran the legacy DOC extraction quality validation script.
- Confirmed the working tree changes are documentation-only for this RCA.
