# BKK DROP Cloudinary Hardfix V52

Fixes:
- Removes the Cloudinary config mismatch.
- app.js now has hard fallback values:
  cloudName: djtklfhbs
  unsignedUploadPreset: ml_default
- config.js also exports cloudinaryConfig and assigns window.cloudinaryConfig.
- Upload should no longer show:
  "Cloudinary is not configured..."

Replace:
- index.html
- styles.css
- app.js
- config.js
- bkkdrop-logo-transparent.png

After upload:
1. Open /app.js?v=52 and search:
   CLOUDINARY HARDFIX V52
2. Open /config.js?v=52 and search:
   djtklfhbs
   ml_default
3. Open the site in incognito/private mode.
4. Login and test Upload Foto Barang.

If upload still fails after V52, the next likely cause is Cloudinary preset permission:
- Go to Cloudinary > Settings > Upload > Upload presets
- Confirm ml_default is Unsigned
- Confirm it allows image uploads
