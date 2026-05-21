# Task: Fix `job_descriptions` create failure (`INSERT has more target columns than expressions`)

## RCA (Root Cause Analysis)
- The `POST /api/job-descriptions` insert statement listed **21 target columns** in `job_descriptions`.
- Its `VALUES` clause only supplied **19 expressions** (`$1` … `$18`, `NOW()`), which caused PostgreSQL parser error `42601: INSERT has more target columns than expressions`.
- Specifically, placeholders for `file_url` and `status` were missing in the SQL text even though the parameter array already included both values.
- Impact: every create request to this endpoint fails before any row insert, regardless of payload quality.

## Fix Implemented
- Updated the insert SQL in `backend/src/routes/jobDescriptions.js` so the `VALUES` clause now includes placeholders for all non-derived columns:
  - Added `$19` for `file_url`
  - Added `$20` for `status`
  - Kept `NOW()` for `updated_at`

## Validation Task Checklist
1. Start backend and call `POST /api/job-descriptions` with a minimal valid payload (title only).
2. Verify response is `201` and returned object includes expected defaults.
3. Verify row exists in `job_descriptions` with:
   - `file_url = null` when no file is uploaded
   - `status = active` default (or supplied status)
   - `updated_at` populated.
4. Repeat with multipart upload including a file to verify `file_url` persists.
5. Add/extend automated API test coverage for create endpoint to guard against column/value drift.

## Prevention Follow-up
- Add a lightweight SQL-shape assertion in tests for this route (column count vs. placeholders).
- Prefer extracting insert column/value mapping to a single constant to reduce mismatch risk during future schema changes.
