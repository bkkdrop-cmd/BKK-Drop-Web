# BKK DROP Firebase Rescue V29

This version is built from the last working fixed build, but with a cleaner Firebase connection flow.

Fixes:
- Removes risky V27/V28 startup patches.
- Adds a clear Firebase connection test.
- Shows the exact Firebase error on the login page.
- Keeps:
  - Foto Barang
  - Nomor Resi
  - Latest logo
  - Improved pink/elegant UI

Replace these files in GitHub:
- index.html
- styles.css
- app.js
- config.js
- bkkdrop-logo-transparent.png

After upload:
1. Commit changes.
2. Wait for redeploy.
3. Open in incognito/private mode.
4. If it still fails, copy the exact Firebase error shown under "Masuk Akun".

Firebase rules for testing:
{
  "rules": {
    ".read": true,
    ".write": true
  }
}

Demo login:
- admin / admin123
- ungki / 1234
