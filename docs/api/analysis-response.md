# Analysis Response Contract

This document defines the API response contract for analysis detail payloads (for example, `GET /analyses/:id`).

## Status semantics

- `analysis.status` is **lifecycle-oriented** at the batch level.
- `analysis.status: "complete"` means the batch processing run has finished, **not** that every resume parsed successfully.
- Resume-level outcomes are captured using per-resume fields (`parseOutcome`, `failureCategory`, `failureMessageUserSafe`) and batch aggregates.

## Backward compatibility rules

- Existing consumers can safely ignore all newly added fields.
- This contract update is additive only; existing top-level fields remain valid.
- `analysis.status` semantics remain unchanged and lifecycle-oriented.

## Per-resume fields

Each resume item in the analysis response includes:

- `parseOutcome`
- `failureCategory`
- `failureMessageUserSafe`

### `parseOutcome`

Enum: `success | partial | failed`

- `success`: Resume parse and downstream extraction completed successfully for this resume.
- `partial`: Resume was processed but with incomplete extraction or recoverable degradation.
- `failed`: Resume could not be parsed into usable structured output.

### `failureCategory`

Enum:

- `corrupt_or_unreadable`
- `ai_output_validation_failed`
- `encrypted_or_password_protected_pdf`
- `image_only_low_ocr`
- `unsupported_encoding_or_format`
- `extraction_failed`
- `response_format_error`
- `response_truncated_error`
- `invalid_request_error`
- `not_found_error`
- `auth_error`
- `billing_quota_error`
- `rate_limit_error`
- `timeout_error`
- `network_error`
- `unknown_error`
- `unknown`

Exact meanings:

- `corrupt_or_unreadable`: The source PDF is malformed or unreadable.
- `ai_output_validation_failed`: AI responded, but candidate output failed strict post-parse validation and was rejected as non-usable.
- `encrypted_or_password_protected_pdf`: The PDF is password-protected or otherwise encrypted.
- `image_only_low_ocr`: Content is image-only and OCR quality is insufficient for reliable extraction.
- `unsupported_encoding_or_format`: File encoding/content format cannot be decoded by the parser stack.
- `response_format_error`: Upstream parsing/model provider returned an invalid or unusable response format.
- `timeout_error`: Processing exceeded configured timeout thresholds.
- `unknown`: Failure reason is not confidently classifiable into another category.

### `failureMessageUserSafe`

- A user-facing, safe-to-display failure message.
- Must not include sensitive internal diagnostics, stack traces, or provider secrets.
- May be `null` when `parseOutcome = "success"`.

## Batch aggregate fields

The analysis response includes batch-level aggregates:

- `totalResumes`: total resumes in the batch.
- `successCount`: count of resumes where `parseOutcome = "success"`.
- `partialCount`: count of resumes where `parseOutcome = "partial"`.
- `failedCount`: count of resumes where `parseOutcome = "failed"`.

Constraint:

- `totalResumes = successCount + partialCount + failedCount`

## Example payloads

### 1) All-success batch

```json
{
  "analysis": {
    "id": "an_1001",
    "status": "complete",
    "totalResumes": 2,
    "successCount": 2,
    "partialCount": 0,
    "failedCount": 0,
    "resumes": [
      {
        "resumeId": "r_001",
        "parseOutcome": "success",
        "failureCategory": null,
        "failureMessageUserSafe": null
      },
      {
        "resumeId": "r_002",
        "parseOutcome": "success",
        "failureCategory": null,
        "failureMessageUserSafe": null
      }
    ]
  }
}
```

### 2) Mixed batch (1 success, 2 failed)

```json
{
  "analysis": {
    "id": "an_1002",
    "status": "complete",
    "totalResumes": 3,
    "successCount": 1,
    "partialCount": 0,
    "failedCount": 2,
    "resumes": [
      {
        "resumeId": "r_101",
        "parseOutcome": "success",
        "failureCategory": null,
        "failureMessageUserSafe": null
      },
      {
        "resumeId": "r_102",
        "parseOutcome": "failed",
        "failureCategory": "encrypted_or_password_protected_pdf",
        "failureMessageUserSafe": "This file is password-protected. Please upload an unlocked PDF."
      },
      {
        "resumeId": "r_103",
        "parseOutcome": "failed",
        "failureCategory": "timeout_error",
        "failureMessageUserSafe": "We could not finish processing this file in time. Please try again."
      }
    ]
  }
}
```

### 3) All-failed batch

```json
{
  "analysis": {
    "id": "an_1003",
    "status": "complete",
    "totalResumes": 2,
    "successCount": 0,
    "partialCount": 0,
    "failedCount": 2,
    "resumes": [
      {
        "resumeId": "r_201",
        "parseOutcome": "failed",
        "failureCategory": "corrupt_or_unreadable",
        "failureMessageUserSafe": "This PDF appears corrupted and could not be read."
      },
      {
        "resumeId": "r_202",
        "parseOutcome": "failed",
        "failureCategory": "image_only_low_ocr",
        "failureMessageUserSafe": "This file is image-based and text extraction quality was too low."
      }
    ]
  }
}
```
