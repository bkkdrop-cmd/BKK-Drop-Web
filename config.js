// BKK DROP CONFIG FILE
// Your Firebase config is already inserted here.
// Login can work even if Cloudinary is not configured yet.

export const firebaseConfig = {
  apiKey: "AIzaSyCgFxXe3Q7Myx3dOPgrSAND_YksVNIFzq0",
  authDomain: "bkk-drop.firebaseapp.com",
  databaseURL: "https://bkk-drop-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "bkk-drop",
  storageBucket: "bkk-drop.firebasestorage.app",
  messagingSenderId: "533358007814",
  appId: "1:533358007814:web:f4fb1ac61abfead4015587",
  measurementId: "G-MFQ3SZXPGR"
};

// Cloudinary is only needed for photo upload.
// Later, replace cloudName after you create a Cloudinary account.
// Keep uploadPreset as bkk_drop_unsigned.
export const cloudinaryConfig = {
  cloudName: "PASTE_YOUR_CLOUDINARY_CLOUD_NAME",
  uploadPreset: "bkk_drop_unsigned"
};

// true = app will create admin / admin123 and andi / 1234 if /users is empty.
export const appOptions = {
  seedDemoData: true
};
