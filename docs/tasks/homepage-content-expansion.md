# Task: Expand Homepage Content to 600+ Words (Without Altering Existing Hero/Feature Layout)

## Objective
Increase visible body text on `https://hireflow.dev/` from ~158 words to **at least 600 words** while preserving the existing hero and feature sections exactly as-is.

## Scope
Update the homepage component (`src/components/LandingPage.jsx`) by appending new sections **below** the existing content.

### Hard constraints (must not change)
- Keep existing hero section unchanged:
  - H1 text remains **"Hire Smarter. Faster."**
  - Keep both existing hero CTAs unchanged.
- Keep existing 6-card feature grid unchanged.
- Preserve existing layout/components already present on the page.
- New content must be specific to Hireflow’s AI resume analysis/screening product.
- Tone: confident, professional, product-specific (no generic filler).

## Required new sections (append below current homepage content)

### 1) "How Hireflow works" section
Add a section with 3 numbered steps in this sequence:
1. Upload resumes in bulk
2. AI scores and ranks candidates
3. Review shortlist and hire

For each step:
- Add a short heading.
- Add **2–3 sentences** explaining how the step works in Hireflow.

### 2) "Who uses Hireflow" section
Add 3 audience blocks with **2–3 sentences each**:
- HR Managers at growing companies
- Recruitment agencies handling high volumes
- Startups hiring their first team

Each block should describe realistic use and value for that audience.

### 3) "Why AI resume screening" section
Add a bullet list with **4–5 bullets** addressing these pain points:
- Time spent manually reading CVs
- Unconscious bias
- Inconsistent scoring across reviewers
- Slow time-to-hire

Bullets should explain how Hireflow directly mitigates each pain point.

### 4) FAQ section
Add a section with **exactly these 5 questions** and full answers:
1. "What is AI resume screening?"
2. "How does Hireflow score resumes?"
3. "Can Hireflow handle bulk resume uploads?"
4. "Is Hireflow suitable for small businesses?"
5. "How is Hireflow different from a regular ATS?"

Answers should be substantive, specific to Hireflow behavior/positioning, and user-facing.

### 5) Closing CTA section
Add a final closing section with:
- Heading similar to: **"Ready to hire smarter?"**
- **2–3 sentences** encouraging signup.
- A CTA button that **re-uses the existing implemented CTA** behavior/component pattern.

## Acceptance criteria
- Homepage visible text content is **>= 600 words**.
- Existing hero text, CTAs, and feature grid are unchanged.
- All required sections are present in the specified order and with required structure.
- FAQ includes the exact 5 required questions.
- Copy remains Hireflow-specific and professional.
- Styling/layout is consistent with current homepage aesthetics and responsive behavior.

## Validation checklist
- [ ] Confirm hero H1 still reads "Hire Smarter. Faster.".
- [ ] Confirm both original hero CTA buttons remain unchanged.
- [ ] Confirm original 6 feature cards remain unchanged.
- [ ] Confirm new sections are appended below existing homepage content.
- [ ] Confirm total visible body word count is at least 600.
- [ ] Confirm final CTA button triggers existing homepage CTA flow.
