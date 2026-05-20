# BKK DROP Startup Login Fix V27

This version fixes the issue where the app stays stuck at:
"Mengecek koneksi Firebase..."

What changed:
- Added startup error guard.
- Login button no longer stays disabled forever.
- Real Firebase/App error will be shown on the login page.
- Added cache-busting for app.js and styles.css.
- Keeps V26 updates:
  - Upload Foto Barang
  - Nomor Resi
  - Latest logo
  - Improved UI spacing

Replace these files in GitHub:
- index.html
- styles.css
- app.js
- config.js
- bkkdrop-logo-transparent.png

After uploading:
1. Commit changes.
2. Wait for redeploy.
3. Open the website in incognito/private mode.
4. If it still fails, send the exact error message shown under login.

Demo login:
- admin / admin123
- ungki / 1234
