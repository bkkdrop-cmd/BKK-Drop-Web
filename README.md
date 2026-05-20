# BKK DROP GitHub Upload Fix V28

This package is based on V27 but with smaller app.js and styles.css.

Why:
- GitHub browser upload can fail when files become too large or slow to upload.
- app.js and styles.css were cleaned/minified to make upload easier.

Replace these files in GitHub:
- index.html
- styles.css
- app.js
- config.js
- bkkdrop-logo-transparent.png

Recommended GitHub upload method:
1. Upload/replace one file at a time.
2. Start with index.html and config.js.
3. Then upload styles.css.
4. Then upload app.js.
5. Then upload bkkdrop-logo-transparent.png.
6. Commit changes.

If GitHub still refuses app.js:
- Open app.js from this ZIP on your computer.
- Open your GitHub app.js file.
- Click the pencil/edit button.
- Select all old code.
- Paste the new app.js code.
- Commit changes.

Demo login:
- admin / admin123
- ungki / 1234
