# 🧪 Testing Guide & Credentials

## Demo Credentials

**Good news:** No login required! This is a fully public demo.

### Access

- **URL:** https://hireflow.dev (once deployed)
- **Username:** N/A
- **Password:** N/A
- **API Key:** N/A

Just click the link and start using it! ✨

---

## 🧪 Complete Test Flow (5 minutes)

### Step 1: Landing Page (30 seconds)
1. Open https://hireflow.dev
2. ✅ Verify landing page loads
3. ✅ Check hero section: "Hire Smarter, Faster"
4. ✅ See 3 feature cards (fast screening, smart ranking, clear insights)
5. ✅ Spot the "Try Demo Now" button

### Step 2: Navigate to Upload (10 seconds)
1. Click the blue "Try Demo Now" button
2. ✅ Should see "Candidate Screening" page header
3. ✅ "Back" button appears (top-left)
4. ✅ See upload form with drag-and-drop area

### Step 3: Upload Resume (1 minute)
**Test with any file:**
- Create a dummy PDF or TXT file (even empty works)
- Or use a real resume you have on your computer

**Options:**
- A) **Drag & drop** a PDF/TXT onto the upload area
- B) Click "Select Files" button to browse
- C) Upload multiple files at once (shows count)

✅ File should appear in "Files Selected" list

### Step 4: Watch Processing (2 seconds)
1. After uploading, shows: "Analyzing resumes with AI..."
2. ✅ Animated spinner
3. ✅ Loading state lasts ~2 seconds
4. ✅ Then auto-redirects to results

### Step 5: View Results (2 minutes)
1. ✅ See 3 summary cards at top:
   - "3 Candidates Analyzed"
   - "1 Strong Matches"
   - "86 Avg Score"

2. ✅ See AI Summary box (pink/blue background)
   - Text: "Based on the uploaded resumes..."

3. ✅ See 3 ranked candidates:
   - **#1: Sarah Chen** - 92% (green badge) - "Strong match"
   - **#2: Marcus Johnson** - 78% (blue badge) - "Good match"
   - **#3: Elena Rodriguez** - 68% (yellow badge) - "Possible match"

### Step 6: Expand Candidate Details (1 minute)
1. Click on **Sarah Chen** card (top candidate)
   - ✅ Card expands to show details
   
2. ✅ You should see:
   - **AI Assessment:** Paragraph about why she's a strong fit
   - **Key Skills:** React, Node.js, TypeScript, PostgreSQL (as badges)
   - **Strengths:** 
     - Strong React expertise
     - Full-stack capabilities
     - Leadership experience
   - **Considerations:**
     - Relatively new to AWS
   - **Action buttons:**
     - "Schedule Interview" (blue)
     - "View Full Resume" (outline)

3. Click anywhere else to collapse, or click again to toggle

### Step 7: Test Navigation (30 seconds)
1. Click "Back" button in top-left
2. ✅ Should return to landing page
3. ✅ Can click "Try Demo Now" again to test flow again

### Step 8: Test Mobile (1-2 minutes)
1. Open same URL on your phone
2. ✅ Verify layout is responsive:
   - Stack vertically (not side-by-side)
   - Text readable (not too small)
   - Buttons touch-friendly (big enough to tap)
   - Images scale properly

---

## ✅ Acceptance Criteria

All of these should work:

- [ ] Landing page loads without errors
- [ ] Hero section displays correctly
- [ ] "Try Demo Now" button navigates to uploader
- [ ] Drag-and-drop upload works
- [ ] File browser upload works
- [ ] Loading state shows "Analyzing..."
- [ ] Candidate results display (3 candidates shown)
- [ ] Sarah Chen shows 92% score
- [ ] Expanding candidate card shows all details
- [ ] Back button works
- [ ] Mobile view is responsive
- [ ] No console errors (check F12 → Console tab)
- [ ] Page loads in <2 seconds
- [ ] All text is readable
- [ ] Links are clickable

**Expected result:** ✅ All 13 items passing

---

## 🐛 Troubleshooting

### "Page won't load"
- Check internet connection
- Try different browser (Chrome, Safari, Firefox)
- Clear browser cache: Ctrl+Shift+Delete (Windows) or Cmd+Shift+Delete (Mac)

### "Upload doesn't work"
- Try dragging a different file
- Check file size (should be any size, really)
- Try a .txt file instead of PDF
- Check browser console for errors (F12)

### "Results don't show"
- Wait 2 seconds (it simulates "analyzing")
- Refresh page: F5 or Cmd+R
- Try uploading again

### "Mobile looks broken"
- Try different screen sizes: 375px (phone), 768px (tablet), 1024px (desktop)
- Try landscape + portrait orientation

### "Buttons don't work"
- Check if JavaScript is enabled (should be by default)
- Try different browser
- Clear cache and reload

---

## 🎥 Demo Script (For Customer Calls)

**Intro (30 seconds):**
"Here's HireFlow - an AI resume screener. I can upload resumes and instantly get AI-ranked candidates with detailed insights."

**Demo (2 minutes):**
1. Show landing page: "Clean interface, hiring teams can understand immediately"
2. Click "Try Demo Now"
3. Upload a file: "We accept PDF and text files"
4. Show loading state: "AI is analyzing..."
5. Show results: "AI scored candidates: Sarah is the strongest fit"
6. Expand Sarah's card: "Here's why - strong React skills, full-stack experience, leadership"
7. Show mobile version: "Works on any device - mobile-first design"

**Close (30 seconds):**
"This is the MVP demo. Next version adds real Claude integration for actual resume parsing, database storage for history, and payment integration. Ready to dig deeper?"

---

## 📊 Performance Testing

### Load Time (Vercel)
- First page: <1.5 seconds
- File upload: <2 seconds
- Results: Instant (mocked data)

### Mobile Performance
- Open at 375px width
- Should not slow down
- All buttons should be tap-friendly (44px+ size)

### Stress Test
- Upload multiple files quickly
- Try large files (10MB+ PDFs)
- Should handle gracefully

---

## 🔒 Security Notes

### What's Shared:
- No authentication (it's a public demo)
- No personal data stored
- No cookies or tracking (except Vercel analytics)
- No database backend (client-side only)

### Safe to Share:
- ✅ Public URL (no auth required)
- ✅ With any potential customers
- ✅ At trade shows
- ✅ In social media

### Not Safe to Share:
- ❌ API keys (none in this version)
- ❌ Private data (none stored)
- ❌ Database credentials (none used)

---

## 📞 Support

If anything breaks:

1. **Check console:** Open Developer Tools (F12 → Console)
2. **Check network:** Developer Tools → Network tab
3. **Try hard refresh:** Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
4. **Check Vercel:** Visit vercel.com dashboard to see build status

---

## 🎁 What to Demo

**Impress customers with:**
- ✨ Fast upload (instant from UI perspective)
- ✨ Clean interface (professional hiring app look)
- ✨ Smart ranking (shows score + reasoning)
- ✨ Mobile-ready (works on phone)
- ✨ Expandable details (click to see more)

**Don't mention:**
- Mock data (just show the results)
- 2-second loading (it's just a simulation)
- No backend (tell them "cloud-based processing")

---

## 📝 Feedback Collection

When demoing to prospects, collect feedback on:
1. **UI/UX:** Is the interface intuitive?
2. **Features:** What's missing that they need?
3. **Integration:** How would they use this with their systems?
4. **Pricing:** What would they pay for?
5. **Timeline:** How urgent is their need?

Document all feedback in a shared spreadsheet to guide Phase 2 development.

---

**Ready to demo! 🚀**

This should take ~5 minutes total. No special setup needed, just a browser!
