# BKK DROP Fixed Consolidated V25

This is the consolidated fixed version for users currently still using V20.

Included fixes and updates after V20:
- Cleaner, stable, luxury-minimal UI
- Improved panel spacing for desktop and mobile
- Header/menu shadow fixed
- Mobile-friendly menu above the page header
- Billing menu fixed and visible
- Housing booking fix
- Updated BKK DROP logo
- Tambah Barang updated:
  - Upload Foto Resi changed to Upload Foto Barang
  - Added Nomor Resi field
  - nomorResi saved into each item
  - Customer/admin can see and edit Nomor Resi

Main modules included:
- Warehouse Page
- Kirim Barang
- Housing
- Billing / Invoice
- Customer account management
- Slot management
- Stock/item edit and delete
- Admin/customer shipment request flow
- Admin received-item photo upload
- Customer uploaded item photo
- Nomor Resi

How to update from V20:
1. Extract this ZIP.
2. Replace these files in GitHub:
   - index.html
   - styles.css
   - app.js
   - config.js
   - bkkdrop-logo-transparent.png
3. Commit changes.
4. Wait for GitHub Pages/Netlify redeploy.
5. Hard refresh your website with Ctrl + Shift + R or open in incognito.

Optional:
- Re-import bkk-drop-firebase-demo-data.json only if you want the demo database structure refreshed.
- If you already have real user data, do not re-import the demo JSON because it may overwrite existing data.

Demo login:
- admin / admin123
- ungki / 1234
