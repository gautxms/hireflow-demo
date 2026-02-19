# 🚀 Quick Deploy to Vercel

This is the **fastest way** to get HireFlow live at `hireflow.dev`.

## Step 1: Push to GitHub (2 minutes)

```bash
# Create a new GitHub repo: https://github.com/new
# Name it: hireflow-demo
# Make it PUBLIC

# Then run:
git remote add origin https://github.com/YOUR_USERNAME/hireflow-demo.git
git branch -M main
git push -u origin main
```

> If you don't have GitHub, create one: https://github.com/signup (free)

## Step 2: Deploy to Vercel (1 minute)

1. Go to https://vercel.com/new
2. Click **"Import Git Repository"**
3. Paste your GitHub URL: `https://github.com/YOUR_USERNAME/hireflow-demo`
4. Click **"Import"**
5. Vercel will auto-detect everything (React, Vite, etc.)
6. Click **"Deploy"** 
7. **Wait 30-60 seconds** ⏳

That's it! You'll get a URL like `https://hireflow-demo-abc123.vercel.app`

## Step 3: Add Custom Domain `hireflow.dev` (2 minutes)

1. In your Vercel project, go to **Settings → Domains**
2. Click **"Add Domain"**
3. Type: `hireflow.dev`
4. Click **"Add"**
5. Vercel will show you DNS records to add
6. Go to your domain registrar (GoDaddy, Namecheap, etc.)
7. Add the DNS records Vercel shows
8. **Wait 24-48 hours** for DNS to propagate
9. Once live, test it: https://hireflow.dev ✅

## Alternative: Deploy Without GitHub (Easiest!)

If you just want to test quickly without GitHub:

1. **Download this folder as ZIP**
2. Go to https://vercel.com/new
3. Click **"Upload"** instead of "Import Git Repository"
4. Drag & drop this entire folder
5. Click **"Deploy"**

Done in 1 minute! You get a live URL instantly.

---

## Troubleshooting

**Q: Build failed?**
- Check Node version: `node --version` (should be 18+)
- Try: `npm install && npm run build` locally first

**Q: DNS not working after 24h?**
- Check your DNS records are correct in the registrar
- Use: `nslookup hireflow.dev` to verify
- Vercel has a guide under project Settings → Domains

**Q: Want to update the app later?**
- Just push to GitHub: `git push`
- Vercel auto-redeploys within 30 seconds!

---

## Test the Deployed App

Once live at `hireflow.dev`:

1. Click **"Try Demo Now"**
2. Upload any PDF or TXT file
3. See mock candidate results
4. Test on mobile (check responsive design)

---

## Share with Gautam

Once deployed, share this:

**🔗 Live URL:** https://hireflow.dev  
**📝 Test Flow:** Click "Try Demo Now" → Upload any file → See results  
**💡 No login needed** (fully functional demo)

---

**That's it! You're live.** 🎉

For more detailed options, see [README_DEPLOYMENT.md](./README_DEPLOYMENT.md)
