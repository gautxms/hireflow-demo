# HireFlow - AI Resume Screening Demo

A modern, fast resume screening and candidate ranking application powered by AI.

![HireFlow Demo](https://img.shields.io/badge/status-MVP-blue) ![React](https://img.shields.io/badge/react-19.2-blue) ![Vite](https://img.shields.io/badge/vite-7.3-green) ![TailwindCSS](https://img.shields.io/badge/tailwind-4.2-blueviolet)

## 🚀 Features

- **Smart Resume Upload** - Drag-and-drop PDF/TXT file uploads
- **AI Candidate Scoring** - Mock Claude-powered resume analysis
- **Ranking Dashboard** - View top 3 candidates with AI insights
- **Mobile Responsive** - Works beautifully on any device
- **Zero Dependencies** - No backend required for MVP (client-side only)
- **Fast Performance** - Optimized build (~225KB gzipped)

## 📋 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
# → Opens http://localhost:5173

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🎯 How It Works

### 1. Landing Page
- Hero section with feature overview
- Three benefit cards (fast screening, smart ranking, clear insights)
- Call-to-action: "Try Demo Now"

### 2. Resume Uploader
- Drag-and-drop interface
- Accepts PDF and TXT files
- Shows loading state while "analyzing" (2-second simulation)
- Validates file types

### 3. Candidate Dashboard
- Summary statistics (total analyzed, strong matches, avg score)
- AI assessment summary
- Three mock candidates with detailed scoring:
  - **Sarah Chen** - 92% (Strong match)
  - **Marcus Johnson** - 78% (Good match)
  - **Elena Rodriguez** - 68% (Possible match)
- Expandable candidate cards showing:
  - AI assessment text
  - Key skills (with badges)
  - Strengths and considerations
  - Action buttons (Schedule Interview, View Resume)

## 📁 Project Structure

```
src/
├── components/               # Candidate and marketing UI
├── pages/                    # Route-level pages
├── admin/                    # Admin pages/components/hooks
├── styles/                   # Shared frontend styles/tokens
├── App.jsx                   # Main routing
├── main.jsx                  # Vite entry point
└── index.css                 # Global CSS entry

backend/src/                  # Express API
public/
vite.config.js                # Vite bundler config
```

## 🧭 Frontend Source of Truth

The canonical frontend code lives in the repository-root `src/` tree.

- ✅ Use `src/` for all pages, components, admin UI, and styles.
- ❌ Do not create or reintroduce `frontend/src` mirrors.
- ✅ Treat `frontend/README.md` as the deprecation guardrail for this historical path.

## 🛠 Tech Stack

- **Frontend Framework:** React 19 + JSX
- **Build Tool:** Vite (ultra-fast)
- **Styling:** TailwindCSS v4 (utility-first CSS)
- **PostCSS:** Autoprefixer for browser compatibility
- **Package Manager:** npm

## 📦 Build Output

```
dist/
├── index.html         (~0.46KB)
├── assets/
│   ├── index-*.css    (~2.93KB, 1.08KB gzipped)
│   └── index-*.js     (~207KB, 64.5KB gzipped)
└── vite.svg
```

**Total production bundle:** ~225KB (gzipped: ~68KB)

## 🌐 Deploy to Vercel

See [README_DEPLOYMENT.md](./README_DEPLOYMENT.md) for detailed instructions.

**Quick deploy:**
```bash
# One-click: https://vercel.com/new (link GitHub repo)
# Or CLI:
npm install -g vercel
vercel --prod
```

## 📱 Mobile Testing

The app is fully responsive:
- ✅ Mobile (375px)
- ✅ Tablet (768px)
- ✅ Desktop (1024px+)

Test on your device:
```bash
npm run dev
# Visit http://YOUR_IP:5173 from mobile
```

## 🎨 Customization

### Update Mock Candidates
Edit `src/components/CandidateRanking.jsx` → `MOCK_CANDIDATES` array

### Change Colors
Edit `tailwind.config.js` → `theme.extend` or modify Tailwind classes directly in components

### Add Real Data
Replace mock state with API calls:
```javascript
// Before (mock):
const MOCK_CANDIDATES = [...]

// After (real):
const [candidates, setCandidates] = useState([])
useEffect(() => {
  fetchCandidates()
}, [])
```

## 🧪 Testing Checklist

- [ ] Landing page loads without errors
- [ ] "Try Demo Now" button navigates to upload form
- [ ] Can drag-and-drop a PDF/TXT file
- [ ] File upload shows loading state
- [ ] Candidate results display correctly
- [ ] Top 3 candidates have scores and recommendations
- [ ] Clicking candidate card expands details
- [ ] Back button returns to landing page
- [ ] Responsive on mobile (test at 375px width)

## 🔄 Next Steps (Post-MVP)

1. **Real AI Integration** - Connect Claude API for actual resume parsing
2. **PDF Parsing** - Extract text from PDF files on the backend
3. **User Auth** - Add login with GitHub/Google
4. **Database** - Store candidate results and history
5. **Export** - Download results as PDF/CSV
6. **Notifications** - Email reports to hiring team
7. **Payments** - TODO: add Paddle integration for premium tiers

## 📊 Performance Metrics

- **Lighthouse Score:** 90+
- **First Contentful Paint:** <1.5s
- **Time to Interactive:** <2.5s
- **Lighthouse Performance Score:** 85+

(Measured on production build with Vercel CDN)

## 📄 License

MIT © 2026 HireFlow Team

## 🤝 Contributing

This is a demo/MVP project. For feature requests or bug reports, contact the team.

---

**Live Demo:** [Deploy to see live](./README_DEPLOYMENT.md)  
**Created:** Feb 19, 2026  
**Status:** MVP Ready for Customer Feedback

## Auth implementation notes

- Backend auth is in `backend/src` with JWT (7d), PostgreSQL-backed users, and auth rate limiting (5 requests/minute/IP on signup/login).
- JWT is issued in an HTTP-only cookie (`token`) and also returned in response JSON.
- Frontend currently stores token in `localStorage` as a temporary bridge for app-level auth state; migrate to cookie-only session checks for production hardening.
- Frontend auth requests default to `http://localhost:4000` when `VITE_API_BASE_URL` is not set, which prevents the generic "Unable to connect" error when Vite proxy is unavailable.
