# EGX Market

سحب سريع لأسعار/شموع البورصة المصرية عبر **Yahoo Finance API** (fetch موازي)، وعرضها بـ **Vue + Vite**.

## تشغيل

```bash
npm install
npm run scrape    # سحب مرة واحدة
npm run view      # http://localhost:5173
npm run watch     # سحب كل 10ث
```

## الهيكل

```
data/symbols.js     # قائمة الأسهم
src/scrape.js       # سحب موازي
src/watch.js        # تحديث دوري
src/lib/yahoo.js    # Yahoo fetch
web/                # Vue dashboard
```

الواجهة تعمل poll لـ `latest.json` كل 5 ثواني.

## Deploy (GitHub Pages + Render API)

### 1) API on Render (free)

1. Open [Render Blueprints](https://dashboard.render.com/blueprints) → **New Blueprint Instance**
2. Connect the `Beshoy2549/EGX` repo (uses `render.yaml`)
3. Fill secrets when prompted:
   - `OPENAI_API_KEY` (recommended for free tier)
   - or `CURSOR_API_KEY`
4. Deploy → copy the service URL, e.g. `https://egx-api.onrender.com`
5. Check health: `https://egx-api.onrender.com/api/health`

Free Render services sleep after idle; the first request can take ~30–60s.

### 2) Frontend on GitHub Pages

1. Repo **Settings → Pages → Source: GitHub Actions**
2. Repo **Settings → Secrets and variables → Actions → Variables**
   - Add `VITE_API_BASE` = your Render URL (no trailing slash)
3. Push to `main` (or re-run **Deploy GitHub Pages**)
4. Site: `https://beshoy2549.github.io/EGX/`
5. Dev bypass: `https://beshoy2549.github.io/EGX/?devbypass=1`

Locally, leave `VITE_API_BASE` unset — Vite still proxies `/api` to `localhost:8787`.
