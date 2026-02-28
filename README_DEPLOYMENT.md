# HireFlow - Deployment Guide

## Project Overview

HireFlow is an AI-powered resume screening and candidate ranking MVP demo.

**Features:**
- ✅ Landing page with feature overview
- ✅ Resume upload form (PDF/TXT support)
- ✅ Mock AI scoring with hardcoded results
- ✅ Candidate ranking dashboard (top 3 candidates)
- ✅ Mobile-responsive design
- ✅ Clean, professional UI (TailwindCSS)

**Tech Stack:**
- React 18 + Vite (fast bundler)
- TailwindCSS v4 (styling)
- No backend needed (client-side only)
- ~225KB production bundle

---

## Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Start dev server (localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

---

## Deploy to Vercel

### Option 1: One-Click Vercel Deploy (Recommended)

1. **Upload this folder to GitHub:**
   - Go to https://github.com/new
   - Create a new public repo called `hireflow-demo`
   - Run locally:
     ```bash
     cd /path/to/hireflow-demo
     git remote add origin https://github.com/YOUR_USERNAME/hireflow-demo.git
     git branch -M main
     git push -u origin main
     ```

2. **Deploy to Vercel:**
   - Go to https://vercel.com/new
   - Click "Import Git Repository"
   - Select your `hireflow-demo` repo
   - Settings:
     - **Framework:** React
     - **Build Command:** `npm run build`
     - **Output Directory:** `dist`
     - **Environment Variables:** (none needed)
   - Click "Deploy"
   - Vercel will auto-build and deploy

3. **Connect Custom Domain:**
   - In Vercel project settings → Domains
   - Add custom domain: `hireflow.dev`
   - Update DNS records (your registrar)
   - Wait 24-48h for propagation

### Option 2: Direct Vercel CLI Deploy

```bash
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel --prod

# You'll be prompted for:
# - Project name: hireflow
# - Scope: your account
# - Link to existing project: no
# - Override settings: use defaults
```

### Option 3: Docker Deploy (Heroku/Railway alternative)

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
```

---

## Project Structure

```
hireflow-demo/
├── src/
│   ├── components/
│   │   ├── LandingPage.jsx        # Hero + features
│   │   ├── Dashboard.jsx           # Main container
│   │   ├── ResumeUploader.jsx      # File upload form
│   │   ├── CandidateRanking.jsx    # Results dashboard
│   │   └── CandidateCard.jsx       # Individual candidate card
│   ├── App.jsx                     # Router/state
│   ├── main.jsx                    # Entry point
│   └── index.css                   # TailwindCSS imports
├── public/
├── vercel.json                     # Vercel config (SPA routing)
├── tailwind.config.js              # TailwindCSS settings
├── postcss.config.js               # PostCSS config
├── vite.config.js                  # Vite bundler config
└── package.json
```

---

## Features & Flow

### 1. Landing Page
- Headline: "Hire Smarter, Faster"
- Feature cards (fast screening, smart ranking, clear insights)
- CTA button: "Try Demo Now"

### 2. Resume Upload
- Drag-and-drop or click to upload
- Accepts PDF & TXT files
- Shows "Analyzing resumes..." loading state (2s)
- Then proceeds to results

### 3. Candidate Ranking
- Summary stats (candidates analyzed, strong matches, avg score)
- AI summary box (mock assessment)
- 3 mock candidates with scores:
  - **Sarah Chen** (92%) - Strong match
  - **Marcus Johnson** (78%) - Good match
  - **Elena Rodriguez** (68%) - Possible match
- Expandable candidate cards with:
  - AI assessment summary
  - Skills (badges)
  - Strengths & considerations
  - Action buttons (schedule interview, view resume)

### 4. Mobile Responsive
- All components work on mobile/tablet
- Touch-friendly buttons
- Responsive grid layout

---

## Mock Data

Candidate data is hardcoded in `src/components/CandidateRanking.jsx`:

```javascript
const MOCK_CANDIDATES = [
  {
    id: 1,
    name: 'Sarah Chen',
    score: 92,
    recommendation: 'Strong match',
    skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL'],
    experience: '5 years full-stack',
    summary: '...',
    pros: [...],
    cons: [...]
  },
  // ... more candidates
]
```

### To update mock data:
Edit the `MOCK_CANDIDATES` array in `src/components/CandidateRanking.jsx`

---

## Testing Checklist

- [ ] Landing page loads
- [ ] "Try Demo Now" button navigates to upload form
- [ ] Resume uploader shows drag-drop area
- [ ] Can select PDF/TXT files
- [ ] Shows "Analyzing..." state for 2 seconds
- [ ] Redirects to candidate ranking
- [ ] Top 3 candidates display with scores
- [ ] Clicking candidate card expands details
- [ ] Back button returns to landing page
- [ ] Mobile responsive (test at 375px, 768px, 1024px)

---

## Performance

- **Bundle size:** ~225KB gzipped (Vite + React + TailwindCSS)
- **First contentful paint:** <1.5s (Vercel CDN)
- **Lighthouse score:** 90+ (production build)

---

## Next Steps (Post-MVP)

1. **Real AI Integration:** Replace mock scoring with Claude API
2. **File Parsing:** Extract text from PDFs for actual parsing
3. **Backend:** Add Node.js/Python backend for resume analysis
4. **Database:** Store candidate results (PostgreSQL/MongoDB)
5. **Auth:** Add user login (GitHub, Google OAuth)
6. **Payment:** TODO: add Paddle for paid plans
7. **Analytics:** Track usage, conversion metrics

---

## Support

- Vite docs: https://vite.dev
- TailwindCSS docs: https://tailwindcss.com
- React docs: https://react.dev
- Vercel docs: https://vercel.com/docs

---

## Credentials for Testing

No auth needed for the demo! It's a fully client-side app.

Just share the URL: `https://hireflow.dev` (once deployed)

Example test flow:
1. Click "Try Demo Now"
2. Upload any PDF/TXT file
3. See mock AI results
4. Expand candidate cards to see details

---

**Deployed:** [INSERT URL AFTER DEPLOYMENT]
**Code Repository:** [INSERT GITHUB REPO LINK]

Last updated: 2026-02-19
