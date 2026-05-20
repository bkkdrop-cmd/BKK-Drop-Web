# BKK DROP Cloudinary Ready V49

Base: V48 / V46 stable.

Cloudinary is configured:

cloudName:
djtklfhbs

unsignedUploadPreset:
ml_default

Replace:
- index.html
- styles.css
- app.js
- config.js
- bkkdrop-logo-transparent.png

After upload:
1. Open the website in incognito/private mode.
2. Try Upload Foto Barang in customer account.
3. Check Cloudinary Media Library to confirm the uploaded image appears.
4. Check Firebase Realtime Database to confirm the image URL is saved in the item data.

Verify:
- /config.js?v=49 search: djtklfhbs
- /config.js?v=49 search: ml_default
- /styles.css?v=49 search: BKK DROP CLOUDINARY READY V49
