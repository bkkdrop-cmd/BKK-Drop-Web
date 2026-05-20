window.addEventListener("error", (event) => {
  console.error("BKK DROP startup error:", event.error || event.message);
setTimeout(() => {
  const loginBtn = document.getElementById("loginBtn");
  const status = document.getElementById("firebaseStatus");
  if (loginBtn && loginBtn.disabled) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Masuk";
    if (status && status.textContent.includes("Mengecek")) {
      status.textContent = "Firebase belum selesai loading. Kamu tetap bisa coba login. Jika gagal, cek Firebase rules/config.";
      status.className = "notice notice-warning";
    }
  }
}, 6000);
const status = document.getElementById("firebaseStatus");
  const loginBtn = document.getElementById("loginBtn");
  if (status) {
    status.textContent = `App error: ${event.message || "Unknown error"}. Please check console.`;
    status.className = "notice notice-error";
  }
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Masuk";
  }
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("BKK DROP unhandled promise:", event.reason);
  const status = document.getElementById("firebaseStatus");
  const loginBtn = document.getElementById("loginBtn");
  if (status) {
    status.textContent = `Firebase/App error: ${event.reason?.message || event.reason || "Unknown error"}`;
    status.className = "notice notice-error";
  }
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Masuk";
  }
});
import { firebaseConfig, cloudinaryConfig, appOptions } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
const $ = (id) => document.getElementById(id);
let app;
let database;
let currentUser = null;
let currentView = "customer";
let customerPage = "warehouse";
let adminPage = "warehouse";
let inventorySearch = "";
let inventoryStatusFilter = "all";
let dbLoaded = false;
let dbError = null;
let db = {
  users: {},
  slots: {},
  bookings: {},
  items: {},
  shipments: {},
  shipmentItems: {},
  housingBookings: {},
  housing: {},
  invoices: {}
};
const statusLabels = {
  waiting_to_arrive: "Menunggu Barang Datang",
  arrived_warehouse: "Sudah Masuk Warehouse",
  checked: "Sudah Dicek Admin",
  packed: "Sudah Dipacking",
  shipped_indonesia: "Dikirim ke Indonesia",
  completed: "Selesai",
  cancelled: "Dibatalkan"
};
const bookingLabels = {
  pending: "Menunggu Konfirmasi",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan"
};
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function idToArray(object) {
  return Object.entries(object || {}).map(([id, data]) => ({ id, ...data }));
}
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}
function setConnectionStatus(type, message) {
  const el = $("connectionStatus");
  if (!el) return;
  el.className = `notice notice-${type}`;
  el.textContent = message;
}
function showModal(title, html) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = html;
  $("modalBackdrop").classList.remove("hidden");
}
function closeModal() {
  $("modalBackdrop").classList.add("hidden");
  $("modalBody").innerHTML = "";
}
function formatBytes(bytes = 0) {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
function formatWeight(value = 0) {
  const number = Number(value || 0);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}
function isFirebaseConfigPlaceholder() {
  return JSON.stringify(firebaseConfig).includes("PASTE_");
}
async function seedDemoDataIfEmpty() {
  if (!appOptions.seedDemoData) return;
  const usersSnap = await get(ref(database, "users"));
  if (usersSnap.exists()) return;
  const now = new Date().toISOString();
  await update(ref(database), {
    "appSettings/businessName": "BKK DROP",
    "users/admin_001": {
      username: "admin",
      password: "admin123",
      name: "BKK DROP Admin",
      whatsapp: "",
      role: "admin",
      status: "active",
      createdAt: now
    },
    "users/user_001": {
      username: "ungki",
      password: "1234",
      name: "Ungki",
      whatsapp: "08123456789",
      role: "customer",
      status: "active",
      createdAt: now
    },
    "slots/slot_001": {
      title: "Warehouse Slot May 2026",
      description: "Slot warehouse Bangkok untuk jastip Thailand ke Indonesia.",
      maxWeightKg: 20,
      maxItems: 200,
      status: "open",
      createdAt: now
    },
    "bookings/booking_001": {
      userId: "user_001",
      slotId: "slot_001",
      status: "approved",
      createdAt: now
    },
    "items/item_001": {
      userId: "user_001",
      slotId: "slot_001",
      itemName: "Mistine Sunscreen",
      category: "Skincare",
      quantity: 3,
      estimatedPrice: 350,
      productLink: "",
      notes: "Please check expiry date.",
      status: "waiting_to_arrive",
      images: {},
      createdAt: now
    }
  });
}
async function login() {
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value.trim();
  if (!username || !password) {
    toast("Masukkan username dan password.");
    return;
  }
  if (isFirebaseConfigPlaceholder()) {
    toast("config.js masih placeholder. Paste Firebase config dulu.");
    setConnectionStatus("error", "config.js masih placeholder. Login belum bisa.");
    return;
  }
  if (dbError) {
    toast("Firebase error: " + dbError);
    return;
  }
  if (!dbLoaded || !db.users || Object.keys(db.users).length === 0) {
    try {
      const usersSnap = await get(ref(database, "users"));
      if (usersSnap.exists()) {
        db.users = usersSnap.val();
        dbLoaded = true;
      }
    } catch (error) {
      console.error(error);
      toast("Tidak bisa membaca /users. Cek Realtime Database Rules.");
      return;
    }
  }
  const users = idToArray(db.users);
  console.log("BKK DROP available users:", users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status
  })));
  const found = users.find((u) =>
    String(u.username || "").trim() === username &&
    String(u.password || "").trim() === password &&
    u.status !== "inactive"
  );
  if (!found) {
    toast("Login gagal. Username/password salah atau /users belum ada.");
    return;
  }
  currentUser = found;
  localStorage.setItem("bkkDropUserId", found.id);
  currentView = found.role === "admin" ? "admin" : "customer";
  renderApp();
  toast(`Selamat datang, ${found.name}.`);
}
function logout() {
  currentUser = null;
  localStorage.removeItem("bkkDropUserId");
  $("loginSection").classList.remove("hidden");
  $("dashboardSection").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
  $("customerViewBtn").classList.add("hidden");
  $("adminViewBtn").classList.add("hidden");
  $("loginUsername").value = "";
  $("loginPassword").value = "";
  document.getElementById("mainMenuRibbon")?.classList.add("hidden");
}
function restoreSession() {
  const userId = localStorage.getItem("bkkDropUserId");
  if (!userId || !db.users?.[userId]) return;
  currentUser = { id: userId, ...db.users[userId] };
  currentView = currentUser.role === "admin" ? "admin" : "customer";
  renderApp();
}
async function compressImage(file, maxWidth = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onerror = reject;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Image compression failed."));
        const compressedFile = new File(
          [blob],
          file.name.replace(/\.[^/.]+$/, "") + "_compressed.jpg",
          { type: "image/jpeg", lastModified: Date.now() }
        );
        resolve(compressedFile);
      }, "image/jpeg", quality);
    };
    reader.readAsDataURL(file);
  });
}
async function uploadImageToCloudinary(file, userId, itemId) {
  if (cloudinaryConfig.cloudName.includes("PASTE_")) {
    throw new Error("Cloudinary belum dikonfigurasi di config.js.");
  }
  const MAX_ORIGINAL_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_ORIGINAL_SIZE) {
    throw new Error("Ukuran foto terlalu besar. Maksimal 5 MB.");
  }
  const compressedFile = await compressImage(file, 1200, 0.7);
  const formData = new FormData();
  formData.append("file", compressedFile);
  formData.append("upload_preset", cloudinaryConfig.uploadPreset);
  formData.append("folder", `bkk-drop/users/${userId}/items/${itemId}`);
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`,
    { method: "POST", body: formData }
  );
  if (!response.ok) throw new Error("Upload gagal. Cek Cloudinary upload preset.");
  const data = await response.json();
  return {
    url: data.secure_url,
    publicId: data.public_id,
    originalSize: file.size,
    compressedSize: compressedFile.size,
    uploadedAt: new Date().toISOString()
  };
}
async function handleImageUpload(itemId, inputElement, source = "customer") {
  const file = inputElement.files?.[0];
  if (!file) return;
  const item = db.items[itemId];
  if (!item) return;
  const imageCount = Object.keys(item.images || {}).length;
  if (imageCount >= 8) {
    toast("Maksimal 8 foto per barang.");
    return;
  }
  try {
    toast(source === "admin_received" ? "Admin mengupload foto barang diterima..." : "Mengompres foto...");
    const uploaded = await uploadImageToCloudinary(file, item.userId, itemId);
    const imageRef = push(ref(database, `items/${itemId}/images`));
    await set(imageRef, {
      ...uploaded,
      source,
      uploadedBy: currentUser?.id || "unknown",
      uploadedByRole: currentUser?.role || "customer"
    });
    if (source === "admin_received") {
      await update(ref(database, `items/${itemId}`), {
        status: "arrived_warehouse",
        photoVerificationStatus: "verified",
        photoVerifiedAt: new Date().toISOString(),
        photoVerifiedBy: currentUser?.id || "admin"
      });
      toast(`Foto barang diterima berhasil diupload. ${formatBytes(uploaded.originalSize)} → ${formatBytes(uploaded.compressedSize)}`);
    } else {
      toast(`Foto berhasil. ${formatBytes(uploaded.originalSize)} → ${formatBytes(uploaded.compressedSize)}`);
    }
  } catch (error) {
    console.error(error);
    toast(error.message || "Upload gagal.");
  } finally {
    inputElement.value = "";
  }
}
async function uploadReceiptImage(file, userId, itemId) {
  if (!file) return null;
  if (cloudinaryConfig.cloudName.includes("PASTE_")) {
    throw new Error("Cloudinary belum dikonfigurasi di config.js.");
  }
  const MAX_ORIGINAL_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_ORIGINAL_SIZE) {
    throw new Error("Ukuran foto barang terlalu besar. Maksimal 5 MB.");
  }
  const uploaded = await uploadImageToCloudinary(file, userId, itemId);
  return {
    ...uploaded,
    source: "resi",
    uploadedBy: currentUser?.id || userId,
    uploadedByRole: currentUser?.role || "customer",
    uploadedAt: new Date().toISOString()
  };
}
async function deleteResiRecord(itemId, resiId) {
  if (!confirm("Hapus foto barang ini?")) return;
  await remove(ref(database, `items/${itemId}/resiImages/${resiId}`));
  toast("Foto resi dihapus dari database.");
}
async function deleteImageRecord(itemId, imageId) {
  if (!confirm("Hapus foto ini dari daftar?")) return;
  await remove(ref(database, `items/${itemId}/images/${imageId}`));
  toast("Foto dihapus dari database.");
}
async function requestSlot(slotId) {
  const already = idToArray(db.bookings).find(
    (b) => b.userId === currentUser.id && b.slotId === slotId && b.status !== "cancelled"
  );
  if (already) {
    toast("Kamu sudah memiliki booking untuk slot ini.");
    return;
  }
  const bookingRef = push(ref(database, "bookings"));
  await set(bookingRef, {
    userId: currentUser.id,
    slotId,
    status: "pending",
    createdAt: new Date().toISOString()
  });
  toast("Permintaan slot berhasil dikirim.");
}
async async function addItemFromForm() {
  const itemName = $("itemName").value.trim();
  const slotId = $("itemSlot").value;
  const category = $("itemCategory").value.trim();
  const quantity = Number($("itemQuantity").value || 0);
  const estimatedPrice = Number($("itemPrice").value || 0);
  const productLink = $("itemLink").value.trim();
  const nomorResi = $("itemNomorResi")?.value.trim() || "";
  const notes = $("itemNotes").value.trim();
  const resiFile = $("itemResiPhoto")?.files?.[0] || null;
  if (!itemName || !slotId) {
    toast("Nama barang dan slot wajib diisi.");
    return;
  }
  const slot = db.slots[slotId] || {};
  const maxWeight = Number(slot.maxWeightKg || slot.maxCustomers || 0);
  const usedWeight = getSlotUsedWeight(slotId);
  const newWeight = Number(estimatedPrice || 0);
  if (maxWeight > 0 && usedWeight + newWeight > maxWeight) {
    toast(`Slot melebihi kapasitas berat. Tersisa ${formatWeight(Math.max(0, maxWeight - usedWeight))} kg.`);
    return;
  }
  const itemRef = push(ref(database, "items"));
  const itemId = itemRef.key;
  await set(itemRef, {
    userId: currentUser.id,
    slotId,
    itemName,
    category,
    quantity,
    estimatedPrice,
    productLink,
    nomorResi,
    notes,
    status: "waiting_to_arrive",
    images: {},
    resiImages: {},
    createdAt: new Date().toISOString()
  });
  if (resiFile) {
    try {
      toast("Mengupload foto barang...");
      const receiptData = await uploadReceiptImage(resiFile, currentUser.id, itemId);
      const receiptRef = push(ref(database, `items/${itemId}/resiImages`));
      await set(receiptRef, {
        ...receiptData,
        source: "item_photo",
        label: "Foto Barang"
      });
    } catch (error) {
      console.error(error);
      toast(error.message || "Barang tersimpan, tetapi upload foto barang gagal.");
    }
  }
  closeModal();
  toast(resiFile ? "Barang dan foto barang berhasil ditambahkan." : "Barang berhasil ditambahkan.");
}
async function deleteItem(itemId) {
  if (!confirm("Hapus barang ini?")) return;
  await remove(ref(database, `items/${itemId}`));
  toast("Barang dihapus.");
}
async function createUserFromForm() {
  const name = $("newUserName").value.trim();
  const username = $("newUsername").value.trim();
  const password = $("newPassword").value.trim();
  const whatsapp = $("newWhatsapp").value.trim();
  const role = $("newRole").value;
  if (!name || !username || !password) {
    toast("Nama, username, dan password wajib diisi.");
    return;
  }
  const duplicate = idToArray(db.users).some((u) => u.username === username);
  if (duplicate) {
    toast("Username sudah digunakan.");
    return;
  }
  const userRef = push(ref(database, "users"));
  await set(userRef, {
    name, username, password, whatsapp, role,
    status: "active",
    createdAt: new Date().toISOString()
  });
  closeModal();
  toast("Akun berhasil dibuat.");
}
async function createSlotFromForm() {
  const title = $("newSlotTitle").value.trim();
  const description = $("newSlotDesc").value.trim();
  const maxWeightKg = Number($("newSlotMaxWeight").value || 0);
  const maxItems = Number($("newSlotMaxItems").value || 0);
  const status = $("newSlotStatus").value;
  if (!title || !maxWeightKg) {
    toast("Judul slot dan kapasitas berat wajib diisi.");
    return;
  }
  const slotRef = push(ref(database, "slots"));
  await set(slotRef, {
    title,
    description,
    maxWeightKg,
    maxItems,
    status,
    createdAt: new Date().toISOString()
  });
  closeModal();
  toast("Slot berhasil dibuat.");
}
async function updateBookingStatus(bookingId, status) {
  await update(ref(database, `bookings/${bookingId}`), { status });
  toast("Status booking diperbarui.");
}
async function updateItemStatus(itemId, status) {
  await update(ref(database, `items/${itemId}`), { status });
  toast("Status barang diperbarui.");
}
function triggerAdminReceivedPhotoUpload(itemId) {
  const input = document.getElementById(`adminReceivedPhotoInput_${itemId}`);
  if (input) input.click();
}
async function verifyItemPhoto(itemId) {
  const item = db.items[itemId];
  if (!item) {
    toast("Barang tidak ditemukan.");
    return;
  }
  const images = Object.values(item.images || {});
  if (!images.length) {
    toast("Belum ada foto untuk diverifikasi.");
    return;
  }
  await update(ref(database, `items/${itemId}`), {
    photoVerificationStatus: "verified",
    photoVerifiedAt: new Date().toISOString(),
    photoVerifiedBy: currentUser?.id || "admin",
    status: item.status === "waiting_to_arrive" ? "arrived_warehouse" : item.status
  });
  toast("Foto barang sudah diverifikasi oleh admin.");
}
async function unverifyItemPhoto(itemId) {
  const item = db.items[itemId];
  if (!item) {
    toast("Barang tidak ditemukan.");
    return;
  }
  await update(ref(database, `items/${itemId}`), {
    photoVerificationStatus: "pending",
    photoVerifiedAt: null,
    photoVerifiedBy: null
  });
  toast("Verifikasi foto dibatalkan.");
}
function openAdminPhotoReview(itemId) {
  const item = db.items[itemId];
  if (!item) {
    toast("Barang tidak ditemukan.");
    return;
  }
  const user = db.users[item.userId] || {};
  const slot = db.slots[item.slotId] || {};
  const images = Object.entries(item.images || {});
  const resiImages = Object.entries(item.resiImages || {});
  const verified = item.photoVerificationStatus === "verified";
  showModal("Review Foto Barang", `
    <div class="review-summary">
      <div>
        <div class="stat-label">Customer</div>
        <strong>${escapeHtml(user.name || "-")}</strong>
      </div>
      <div>
        <div class="stat-label">Barang</div>
        <strong>${escapeHtml(item.itemName || "-")}</strong>
      </div>
      <div>
        <div class="stat-label">Slot</div>
        <strong>${escapeHtml(slot.title || "-")}</strong>
      </div>
      <div>
        <div class="stat-label">Status Foto</div>
        <strong>${verified ? "Terverifikasi" : "Belum Diverifikasi"}</strong>
      </div>
    </div>
    <div class="admin-resi-box">
      <div class="admin-resi-header">
        <div>
          <strong>Foto Barang dari Customer</strong>
          <p class="muted small">Gunakan foto barang ini untuk mencocokkan paket/barang saat diterima di warehouse.</p>
        </div>
        <span class="pill">${resiImages.length} foto</span>
      </div>
      <div class="admin-resi-grid">
        ${resiImages.length ? resiImages.map(([resiId, resi]) => `
          <div class="admin-photo-card resi-photo-card">
            <img src="${escapeHtml(resi.url)}" alt="Receipt photo" />
            <div class="admin-photo-meta">
              <span class="photo-source-badge resi-source">Foto Barang Customer</span>
              <span>${escapeHtml(formatBytes(resi.compressedSize || resi.originalSize || 0))}</span>
              <button class="btn btn-danger" onclick="window.deleteResiRecord('${itemId}', '${resiId}')">Hapus Foto</button>
            </div>
          </div>
        `).join("") : `<div class="empty">Belum ada foto barang untuk item ini.</div>`}
      </div>
    </div>
    <div class="admin-received-upload-box">
      <div>
        <strong>Upload Foto Barang yang Diterima Admin</strong>
        <p class="muted small">Gunakan ini untuk upload foto real barang saat sudah masuk warehouse. Customer akan melihat foto ini di Gudang Saya.</p>
      </div>
      <button class="btn btn-accent" onclick="window.triggerAdminReceivedPhotoUpload('${itemId}')">+ Upload Foto Diterima</button>
      <input id="adminReceivedPhotoInput_${itemId}" type="file" accept="image
window.openAddItemModal = typeof openAddItemModal !== "undefined" ? openAddItemModal : window.openAddItemModal;
window.addItemFromForm = typeof addItemFromForm !== "undefined" ? addItemFromForm : window.addItemFromForm;