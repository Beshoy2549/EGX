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

## Deploy (GitHub Pages)

Push to `main` runs `.github/workflows/deploy-pages.yml` and publishes the Vue build.

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. After the workflow succeeds, open: `https://<user>.github.io/EGX/`
3. Dev bypass: `https://<user>.github.io/EGX/?devbypass=1`

**Note:** GitHub Pages serves the static frontend only (`latest.json` / `fundamentals.json`). AI `/api/*` needs a separate Node host (`npm run api`).
