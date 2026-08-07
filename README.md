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
