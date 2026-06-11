# Legacy `.doc` semantic extraction observe-only rollout

## Purpose

PR 1 adds a default-off, allowlist-only diagnostics path for legacy binary Word `.doc` files using the pinned `word-extractor@1.0.4` dependency. The path is observe-only: it computes privacy-safe quality diagnostics and fingerprints, then discards semantic text before logging, returning diagnostics, or persistence.

Scoring remains unchanged. Eligible legacy `.doc` resumes still use the existing byte-run extractor as the AI input with:

- `extractionMethod: "legacy_doc_text_extraction"`
- `preparedMimeType: "text/plain"`
- `inputKind: "extracted_text"`
- `inputMode: "extracted_text"`

## Environment variables and safe defaults

| Variable | Default | Notes |
| --- | --- | --- |
| `LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED` | `false` | Master flag. When unset or false, the semantic parser does not run. |
| `LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS` | empty string | Comma-separated user IDs. |
| `LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS` | empty string | Comma-separated analysis UUIDs/IDs. |
| `LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE` | `0` | Integer percentage from `0` to `100`. Sampling is deterministic, but should remain `0` for the first rollout. |
| `LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_BYTES` | `5242880` | Maximum input bytes for the observe-only parser. Existing scoring flow is unchanged if this limit rejects. |
| `LEGACY_DOC_SEMANTIC_EXTRACTION_TIMEOUT_MS` | `2000` | Promise timeout for observe-only parsing. Promise timeouts may not interrupt CPU-bound parsing. |
| `LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_OUTPUT_CHARS` | `20000` | Maximum semantic text characters processed for diagnostics. Raw text is never persisted. |

Recommended first deployment values after merge:

```bash
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED="false"
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS=""
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS=""
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE="0"
```

Do not enable sampling during the initial rollout.

## Enable for one user only

1. Confirm `ENABLE_LEGACY_DOC_EXTRACTION=true` is already intentionally enabled for the environment. The observe-only flags do not bypass the existing legacy-DOC acceptance flag.
2. Set:

```bash
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED="true"
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS="<user-id>"
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS=""
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE="0"
```

3. Upload or re-run only the targeted legacy binary `.doc` resume analysis.
4. Inspect `parseDiagnostics.legacyDocSemanticExtractionObserveOnly`.

## Diagnostics to inspect

The additive diagnostics object is `parseDiagnostics.legacyDocSemanticExtractionObserveOnly`. Useful fields include:

- Eligibility: `enabled`, `eligible`, `eligibilityReason`, `allowlistMatched`, `matchedAllowlistType`, `sampled`, `sampleRate`, `samplingBucket`.
- Parser result: `success`, `failureCategory`, `qualityClassification`, `durationMs`, `inputByteSize`, `outputTruncated`.
- Safe text comparison: `semanticNormalizedCharCount`, `semanticNormalizedLineCount`, `semanticNormalizedFingerprint`, `currentLegacyNormalizedCharCount`, `currentLegacyNormalizedLineCount`, `currentLegacyNormalizedFingerprint`, `normalizedCharCountDelta`, `normalizedLineCountDelta`.
- Safe quality metrics: `duplicateLineRatio`, `printableRatio`, `suspiciousNoiseRatio`.
- Scoring invariant: `scoringFallbackReason: "observe_only"`.

Do not expect raw resume text, filenames, paths, emails, phone numbers, candidate names, base64 file content, or provider payloads in the new diagnostics or logs.

## Disable immediately

Operational rollback is immediate:

```bash
LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED="false"
```

Because this PR is observe-only, scoring behavior remains unchanged even before rollback.

## Risks

- `word-extractor@1.0.4` is pinned but inactive/low-maintenance.
- Legacy Office binary parsing expands the hostile-input surface.
- Promise-based timeouts may not interrupt CPU-bound parsing.
- A worker-thread or isolated child-process hardening step may be needed before any scoring experiment.
- Observe-only execution must remain narrow and default-off.
- Semantic output may still differ from Word-visible output for tables, revisions, headers, footers, textboxes, encrypted files, or malformed OLE structures.

## Hard rollback

Revert this PR only. Do not revert the earlier PDF canonical extraction work. Do not revert the dependency-only PR unless the dependency itself causes install or deployment issues.
