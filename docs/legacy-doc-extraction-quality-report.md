# Legacy DOC Extraction Quality Report

## Scope

This report validates the feature-flagged legacy Microsoft Word `.doc` extraction path using small synthetic fixtures only. It does not add frontend `.doc` upload acceptance and does not enable `.doc` support in production.

The validation focuses on local extraction quality, safe payload preparation, deterministic failures, and mixed-format routing. It intentionally does not change AI prompts, scoring, ranking, provider fallback, async processing, or result rendering.

## Quality thresholds

For this synthetic validation pass, valid `.doc` fixtures must meet all of these thresholds:

- Expected marker coverage: **100%** in this fixture set; a larger staging-representative corpus should not proceed below **95%** marker coverage.
- Printable character ratio: **>= 0.95**.
- Duplicate-line ratio: **<= 0.20**.
- Suspicious binary-noise ratio: **<= 0.02**.
- Extraction duration: **<= 1000 ms** per small fixture.
- Prepared payload must use `text/plain` extracted text and must not expose the raw `.doc` binary to providers.

## Fixture matrix

| Fixture | Format | Expected route | Result | Notes |
| --- | --- | --- | --- | --- |
| legacy-doc-normal-paragraphs | `.doc` | Legacy DOC text-run extractor | Pass | Normal resume paragraphs with name, skills, education, and company markers. |
| legacy-doc-headings-and-bullets | `.doc` | Legacy DOC text-run extractor | Pass | Headings and bullet-like structure preserved well enough for AI analysis. |
| legacy-doc-tables | `.doc` | Legacy DOC text-run extractor | Pass | Tabular text markers survived in extracted text. |
| legacy-doc-contact-skills-education-multiple-experience | `.doc` | Legacy DOC text-run extractor | Pass | Contact details, skills, education, and multiple experience entries covered. |
| legacy-doc-corrupt | `.doc` | Local deterministic failure | Pass | Failed without provider routing. |
| legacy-doc-empty | `.doc` | Local deterministic failure | Pass | Failed without provider routing. |
| legacy-doc-ole-like-not-word-resume | `.doc` | Local deterministic failure | Pass | Failed without provider routing. |
| legacy-doc-password-protected-unreadable-simulated | `.doc` | Local deterministic failure | Pass | Simulated unreadable/encrypted-like binary failed safely. |
| docx-control | `.docx` | Mammoth DOCX extraction | Pass | Control fixture confirms DOCX is not routed through legacy DOC extraction. |
| pdf-control | PDF | Existing PDF binary provider input | Pass | Control fixture confirms PDF path remains binary provider input. |
| txt-control | TXT | Existing text/plain extraction | Pass | Control fixture confirms TXT remains extracted text. |
| same-basename-pdf / same-basename-doc / same-basename-docx | PDF/DOC/DOCX | Distinct per-format routes | Pass | Same basename does not overwrite or masquerade across formats. |

## Safe metrics from local harness

The local harness emits safe metrics only: fixture name, success/failure, extracted text length, line count, printable ratio, duplicate-line ratio, suspicious binary-noise ratio, expected marker coverage, error category, and extraction duration. It intentionally omits raw extracted text, emails, phones, filenames, and binary content.

Current harness results for the valid synthetic `.doc` fixtures:

| Fixture | Length | Lines | Printable ratio | Duplicate-line ratio | Noise ratio | Marker coverage | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy-doc-normal-paragraphs | 211 | 5 | 1.0000 | 0.0000 | 0.0000 | 100% | < 1000 ms |
| legacy-doc-headings-and-bullets | 203 | 10 | 1.0000 | 0.0000 | 0.0000 | 100% | < 1000 ms |
| legacy-doc-tables | 164 | 5 | 1.0000 | 0.0000 | 0.0000 | 100% | < 1000 ms |
| legacy-doc-contact-skills-education-multiple-experience | 308 | 7 | 1.0000 | 0.0000 | 0.0000 | 100% | < 1000 ms |

Invalid/unreadable `.doc` fixtures failed with `legacy_doc_extraction_failed` and did not produce extracted text.

## Security validation

- A default 5 MiB legacy DOC extraction size limit is enforced.
- A default 2 second extraction timeout guard is enforced during text-run scanning.
- The extractor reads bytes locally only; it does not execute macros, invoke network access, or call external processes.
- Successful `.doc` payloads are converted to `text/plain` with `inputKind: extracted_text`, `inputMode: extracted_text`, `sourceFormat: doc`, and `extractionMethod: legacy_doc_text_extraction`.
- Failed `.doc` extraction remains non-retryable and deterministic.
- Safe diagnostics and harness metrics avoid raw resume text, email, phone, original filename, or binary logging.

## Remaining risks

- The current extractor is still a best-effort UTF-16LE/ASCII text-run scanner, not a full Word binary parser.
- Synthetic fixtures prove routing and basic text-run recovery, but they cannot prove reliability across real legacy Word internals, compression variants, embedded objects, tracked changes, fields, headers/footers, or unusual encodings.
- Password-protected and encrypted `.doc` behavior is represented by a safe simulated unreadable fixture, not a real encrypted Word file.
- Table structure can be adequate for marker recovery but may not preserve all row/column semantics.
- No large, messy, real-world staging corpus has been evaluated in this pass.

## Recommendation

**B) Improve/validate the lightweight extractor before rollout.**

The lightweight extractor passes the new synthetic validation suite and appears safe for local, feature-flagged experimentation. However, because it is not a true Word binary parser, this pass is not enough to recommend a controlled staging rollout by itself. Before staging rollout, run this harness against a larger synthetic and sanitized staging-representative corpus; if marker coverage drops below 95% or noise/duplication increases, stop and add a stronger controlled extractor/runtime dependency such as LibreOffice, antiword, or another vetted parser.

## Unchanged behavior confirmation

This validation pass does not intentionally change PDF, DOCX, TXT, async processing, provider fallback, scoring/ranking, or historical analysis rendering behavior. DOC remains feature-flagged and rejected when `ENABLE_LEGACY_DOC_EXTRACTION=false`.
