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
  $("mainMenuRibbon")?.classList.add("hidden");
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
      <input id="adminReceivedPhotoInput_${itemId}" type="file" accept="image/*" style="display:none" onchange="window.handleImageUpload('${itemId}', this, 'admin_received')" />
    </div>

    <div class="admin-photo-grid">
      ${images.length ? images.map(([imageId, image]) => `
        <div class="admin-photo-card ${image.source === "admin_received" ? "received-photo-card" : ""}">
          <img src="${escapeHtml(image.url)}" alt="Product photo" />
          <div class="admin-photo-meta">
            <span class="photo-source-badge ${image.source === "admin_received" ? "admin-source" : "customer-source"}">
              ${image.source === "admin_received" ? "Foto Diterima Admin" : "Foto Customer"}
            </span>
            <span>${escapeHtml(formatBytes(image.compressedSize || image.originalSize || 0))}</span>
            <button class="btn btn-danger" onclick="window.deleteImageRecord('${itemId}', '${imageId}')">Hapus Foto</button>
          </div>
        </div>
      `).join("") : `<div class="empty">Belum ada foto. Admin bisa upload foto barang diterima di atas.</div>`}
    </div>

    <div class="review-actions">
      <button class="btn btn-green" onclick="window.verifyItemPhoto('${itemId}')">Konfirmasi Barang Diterima</button>
      <button class="btn btn-danger" onclick="window.unverifyItemPhoto('${itemId}')">Batalkan Verifikasi</button>
    </div>

    <p class="muted small">
      Jika admin upload foto diterima, status barang otomatis menjadi “Sudah Masuk Warehouse” dan foto akan muncul di akun customer.
    </p>
  `);
}


function setCustomerPage(page) {
  customerPage = page;
  renderApp();
}

function setAdminPage(page) {
  adminPage = page;
  renderApp();
}

function getShipmentUsedWeight(shipmentId) {
  return idToArray(db.shipmentItems || {})
    .filter((shipmentItem) => shipmentItem.shipmentId === shipmentId)
    .reduce((sum, shipmentItem) => sum + Number(shipmentItem.weightKg || 0), 0);
}

function getWarehouseAvailableItems() {
  return idToArray(db.items || {}).filter((item) => {
    const qty = Number(item.quantity || 0);
    const weight = Number(item.estimatedPrice || 0);
    return qty > 0 && weight > 0 && item.status !== "cancelled" && item.status !== "shipped_indonesia" && item.status !== "completed";
  });
}

function getCustomerWarehouseAvailableItems(userId) {
  return getWarehouseAvailableItems().filter((item) => item.userId === userId);
}

function getOpenShipments() {
  return idToArray(db.shipments || {}).filter((shipment) => shipment.status !== "closed" && shipment.status !== "arrived_indonesia");
}


function getCustomerShipmentItems(userId) {
  return idToArray(db.shipmentItems || {}).filter((item) => item.userId === userId);
}

function openCreateShipmentModal() {
  showModal("Buat Batch Kirim Barang", `
    <div class="field"><label>Judul Pengiriman</label><input id="newShipmentTitle" value="Kirim Barang ke Indonesia" /></div>
    <div class="grid grid-3">
      <div class="field"><label>Tanggal Terbang</label><input id="newShipmentDate" type="date" /></div>
      <div class="field"><label>Max Weight Bisa Terbang (kg)</label><input id="newShipmentMaxWeight" type="number" min="0.01" step="0.01" value="20" /></div>
      <div class="field">
        <label>Status</label>
        <select id="newShipmentStatus">
          <option value="planning">Planning</option>
          <option value="ready">Ready to Fly</option>
          <option value="flown">Sudah Terbang</option>
          <option value="arrived_indonesia">Tiba di Indonesia</option>
          <option value="closed">Closed</option>
        </select>
      </div>
    </div>
    <p class="muted small">Destination otomatis: Indonesia. Max Weight adalah total berat yang bisa dibawa dalam batch ini.</p>
    <button class="btn btn-accent btn-full" onclick="window.createShipmentFromForm()">Buat Batch</button>
  `);
}

async function createShipmentFromForm() {
  const title = $("newShipmentTitle").value.trim();
  const flightDate = $("newShipmentDate").value;
  const maxWeightKg = Number($("newShipmentMaxWeight").value || 0);
  const status = $("newShipmentStatus").value;

  if (!title || !maxWeightKg) {
    toast("Judul pengiriman dan max weight wajib diisi.");
    return;
  }

  const shipmentRef = push(ref(database, "shipments"));
  await set(shipmentRef, {
    title,
    destination: "Indonesia",
    flightDate,
    maxWeightKg,
    status,
    createdAt: new Date().toISOString()
  });

  closeModal();
  adminPage = "kirim";
  renderApp();
  toast("Batch Kirim Barang berhasil dibuat.");
}

function openEditShipmentModal(shipmentId) {
  const shipment = db.shipments?.[shipmentId];
  if (!shipment) {
    toast("Batch pengiriman tidak ditemukan.");
    return;
  }

  showModal("Edit Batch Kirim Barang", `
    <div class="field"><label>Judul Pengiriman</label><input id="editShipmentTitle" value="${escapeHtml(shipment.title || "")}" /></div>
    <div class="grid grid-3">
      <div class="field"><label>Tanggal Terbang</label><input id="editShipmentDate" type="date" value="${escapeHtml(shipment.flightDate || "")}" /></div>
      <div class="field"><label>Max Weight Bisa Terbang (kg)</label><input id="editShipmentMaxWeight" type="number" min="0.01" step="0.01" value="${escapeHtml(shipment.maxWeightKg || 0)}" /></div>
      <div class="field">
        <label>Status</label>
        <select id="editShipmentStatus">
          ${[
            ["planning", "Planning"],
            ["ready", "Ready to Fly"],
            ["flown", "Sudah Terbang"],
            ["arrived_indonesia", "Tiba di Indonesia"],
            ["closed", "Closed"]
          ].map(([value, label]) => `<option value="${value}" ${shipment.status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>
    </div>
    <button class="btn btn-accent btn-full" onclick="window.updateShipmentFromForm('${shipmentId}')">Simpan Perubahan</button>
  `);
}

async function updateShipmentFromForm(shipmentId) {
  const title = $("editShipmentTitle").value.trim();
  const flightDate = $("editShipmentDate").value;
  const maxWeightKg = Number($("editShipmentMaxWeight").value || 0);
  const status = $("editShipmentStatus").value;

  if (!title || !maxWeightKg) {
    toast("Judul pengiriman dan max weight wajib diisi.");
    return;
  }

  await update(ref(database, `shipments/${shipmentId}`), {
    title,
    destination: "Indonesia",
    flightDate,
    maxWeightKg,
    status,
    updatedAt: new Date().toISOString()
  });

  closeModal();
  toast("Batch Kirim Barang diperbarui.");
}

function openAddShipmentItemModal(shipmentId) {
  const shipment = db.shipments?.[shipmentId];
  if (!shipment) {
    toast("Batch pengiriman tidak ditemukan.");
    return;
  }

  const warehouseItems = getWarehouseAvailableItems();
  const options = warehouseItems.map((item) => {
    const user = db.users[item.userId] || {};
    return `<option value="${item.id}">${escapeHtml(user.name || "-")} — ${escapeHtml(item.itemName)} — Qty ${escapeHtml(item.quantity || 0)} — ${formatWeight(item.estimatedPrice)} kg</option>`;
  }).join("");

  showModal("Tambah Barang ke Kirim Barang", `
    <div class="notice notice-warning">Destination: Indonesia • Batch: ${escapeHtml(shipment.title || "")}</div>

    <div class="field">
      <label>Sumber Barang</label>
      <select id="shipmentItemSource" onchange="window.toggleShipmentSourceForm()">
        <option value="warehouse">Dari Warehouse</option>
        <option value="non_warehouse">Non Warehouse</option>
      </select>
    </div>

    <div id="warehouseShipmentFields">
      <div class="field">
        <label>Pilih Barang Warehouse</label>
        <select id="shipmentWarehouseItem">
          ${options || `<option value="">Tidak ada stok warehouse tersedia</option>`}
        </select>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Qty Dikirim</label><input id="shipmentWarehouseQty" type="number" min="1" value="1" /></div>
        <div class="field"><label>Berat Dikirim (kg)</label><input id="shipmentWarehouseWeight" type="number" min="0.01" step="0.01" value="0.1" /></div>
      </div>
    </div>

    <div id="nonWarehouseShipmentFields" class="hidden">
      <div class="grid grid-2">
        <div class="field"><label>Nama Customer / Pemilik</label><input id="shipmentNonWarehouseOwner" placeholder="Nama customer" /></div>
        <div class="field"><label>Nama Barang</label><input id="shipmentNonWarehouseName" placeholder="Nama barang" /></div>
        <div class="field"><label>Qty</label><input id="shipmentNonWarehouseQty" type="number" min="1" value="1" /></div>
        <div class="field"><label>Berat (kg)</label><input id="shipmentNonWarehouseWeight" type="number" min="0.01" step="0.01" value="0.1" /></div>
      </div>
    </div>

    <div class="field"><label>Catatan</label><textarea id="shipmentItemNotes" placeholder="Catatan pengiriman..."></textarea></div>
    <button class="btn btn-accent btn-full" onclick="window.addItemToShipment('${shipmentId}')">Tambah ke Kirim Barang</button>
  `);
}

function toggleShipmentSourceForm() {
  const source = $("shipmentItemSource")?.value || "warehouse";
  $("warehouseShipmentFields")?.classList.toggle("hidden", source !== "warehouse");
  $("nonWarehouseShipmentFields")?.classList.toggle("hidden", source !== "non_warehouse");
}

async function addItemToShipment(shipmentId) {
  const shipment = db.shipments?.[shipmentId];
  if (!shipment) {
    toast("Batch pengiriman tidak ditemukan.");
    return;
  }

  const source = $("shipmentItemSource").value;
  const usedWeight = getShipmentUsedWeight(shipmentId);
  const maxWeight = Number(shipment.maxWeightKg || 0);
  let shipmentData = null;

  if (source === "warehouse") {
    const itemId = $("shipmentWarehouseItem").value;
    const qtyToSend = Number($("shipmentWarehouseQty").value || 0);
    const weightToSend = Number($("shipmentWarehouseWeight").value || 0);
    const item = db.items?.[itemId];

    if (!itemId || !item) {
      toast("Pilih barang warehouse dulu.");
      return;
    }

    const currentQty = Number(item.quantity || 0);
    const currentWeight = Number(item.estimatedPrice || 0);

    if (qtyToSend <= 0 || weightToSend <= 0) {
      toast("Qty dan berat harus lebih dari 0.");
      return;
    }

    if (qtyToSend > currentQty) {
      toast(`Qty melebihi stok warehouse. Stok tersedia: ${currentQty}.`);
      return;
    }

    if (weightToSend > currentWeight) {
      toast(`Berat melebihi stok warehouse. Berat tersedia: ${formatWeight(currentWeight)} kg.`);
      return;
    }

    if (maxWeight > 0 && usedWeight + weightToSend > maxWeight) {
      toast(`Melebihi kapasitas terbang. Sisa kapasitas: ${formatWeight(Math.max(0, maxWeight - usedWeight))} kg.`);
      return;
    }

    const user = db.users[item.userId] || {};
    shipmentData = {
      shipmentId,
      source: "warehouse",
      requestBy: "admin",
      requestStatus: "approved",
      itemId,
      userId: item.userId || "",
      ownerName: user.name || "",
      itemName: item.itemName || "",
      quantity: qtyToSend,
      weightKg: weightToSend,
      notes: $("shipmentItemNotes").value.trim(),
      destination: "Indonesia",
      shipmentStatus: shipment.status || "planning",
      createdAt: new Date().toISOString()
    };

    const remainingQty = Math.max(0, currentQty - qtyToSend);
    const remainingWeight = Math.max(0, currentWeight - weightToSend);

    await update(ref(database, `items/${itemId}`), {
      quantity: remainingQty,
      estimatedPrice: Number(remainingWeight.toFixed(2)),
      status: remainingQty <= 0 || remainingWeight <= 0 ? "shipped_indonesia" : item.status,
      lastShipmentId: shipmentId,
      updatedAt: new Date().toISOString()
    });
  } else {
    const ownerName = $("shipmentNonWarehouseOwner").value.trim();
    const itemName = $("shipmentNonWarehouseName").value.trim();
    const qty = Number($("shipmentNonWarehouseQty").value || 0);
    const weightKg = Number($("shipmentNonWarehouseWeight").value || 0);

    if (!ownerName || !itemName || qty <= 0 || weightKg <= 0) {
      toast("Lengkapi data non warehouse.");
      return;
    }

    if (maxWeight > 0 && usedWeight + weightKg > maxWeight) {
      toast(`Melebihi kapasitas terbang. Sisa kapasitas: ${formatWeight(Math.max(0, maxWeight - usedWeight))} kg.`);
      return;
    }

    shipmentData = {
      shipmentId,
      source: "non_warehouse",
      requestBy: "admin",
      requestStatus: "approved",
      itemId: "",
      userId: "",
      ownerName,
      itemName,
      quantity: qty,
      weightKg,
      notes: $("shipmentItemNotes").value.trim(),
      destination: "Indonesia",
      shipmentStatus: shipment.status || "planning",
      createdAt: new Date().toISOString()
    };
  }

  const shipmentItemRef = push(ref(database, "shipmentItems"));
  await set(shipmentItemRef, shipmentData);

  closeModal();
  toast("Barang berhasil ditambahkan ke Kirim Barang.");
}

async function deleteShipmentItem(shipmentItemId) {
  const shipmentItem = db.shipmentItems?.[shipmentItemId];
  if (!shipmentItem) {
    toast("Item pengiriman tidak ditemukan.");
    return;
  }

  if (!confirm("Hapus item dari Kirim Barang? Jika sumber dari warehouse, stok akan dikembalikan.")) return;

  if (shipmentItem.source === "warehouse" && shipmentItem.itemId && db.items?.[shipmentItem.itemId]) {
    const item = db.items[shipmentItem.itemId];
    const restoredQty = Number(item.quantity || 0) + Number(shipmentItem.quantity || 0);
    const restoredWeight = Number(item.estimatedPrice || 0) + Number(shipmentItem.weightKg || 0);

    await update(ref(database, `items/${shipmentItem.itemId}`), {
      quantity: restoredQty,
      estimatedPrice: Number(restoredWeight.toFixed(2)),
      status: item.status === "shipped_indonesia" ? "arrived_warehouse" : item.status,
      updatedAt: new Date().toISOString()
    });
  }

  await remove(ref(database, `shipmentItems/${shipmentItemId}`));
  toast("Item pengiriman dihapus.");
}

function exportShipmentCSV(shipmentId) {
  const shipment = db.shipments?.[shipmentId] || {};
  const items = idToArray(db.shipmentItems || {}).filter((item) => item.shipmentId === shipmentId);
  const headers = ["Batch", "Tanggal", "Destination", "Source", "Owner", "Item", "Qty", "Berat kg", "Notes"];
  const rows = items.map((item) => [
    shipment.title || "",
    shipment.flightDate || "",
    "Indonesia",
    item.source || "",
    item.ownerName || "",
    item.itemName || "",
    item.quantity || "",
    item.weightKg || "",
    item.notes || ""
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bkk-drop-kirim-barang-${shipmentId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}


function openEditItemModal(itemId) {
  const item = db.items?.[itemId];
  if (!item) {
    toast("Barang tidak ditemukan.");
    return;
  }

  const canEdit = currentUser?.role === "admin" || item.userId === currentUser?.id;
  if (!canEdit) {
    toast("Kamu tidak punya akses untuk edit barang ini.");
    return;
  }

  const isAdmin = currentUser?.role === "admin";
  const owner = db.users?.[item.userId] || {};
  const slot = db.slots?.[item.slotId] || {};

  showModal("Edit Stock / Barang", `
    <div class="notice notice-warning">
      ${isAdmin ? `Admin editing item milik: ${escapeHtml(owner.name || "-")}` : "Edit stock warehouse kamu."}
      ${slot.title ? ` • Slot: ${escapeHtml(slot.title)}` : ""}
    </div>

    <div class="grid grid-2">
      <div class="field">
        <label>Nama Barang</label>
        <input id="editItemName" value="${escapeHtml(item.itemName || "")}" />
      </div>
      <div class="field">
        <label>Kategori</label>
        <input id="editItemCategory" value="${escapeHtml(item.category || "")}" />
      </div>
      <div class="field">
        <label>Quantity Stock</label>
        <input id="editItemQuantity" type="number" min="0" step="1" value="${escapeHtml(item.quantity || 0)}" />
      </div>
      <div class="field">
        <label>Estimasi Berat Stock (kg)</label>
        <input id="editItemWeight" type="number" min="0" step="0.01" value="${escapeHtml(item.estimatedPrice || 0)}" />
      </div>
      <div class="field">
        <label>Link Produk</label>
        <input id="editItemLink" value="${escapeHtml(item.productLink || "")}" placeholder="https://..." />
      </div>
      <div class="field">
        <label>Nomor Resi</label>
        <input id="editItemNomorResi" value="${escapeHtml(item.nomorResi || "")}" placeholder="Nomor resi / tracking number" />
      </div>
      ${isAdmin ? `
        <div class="field">
          <label>Status Barang</label>
          <select id="editItemStatus">
            ${Object.entries(statusLabels).map(([value, label]) => `
              <option value="${value}" ${item.status === value ? "selected" : ""}>${label}</option>
            `).join("")}
          </select>
        </div>
      ` : `
        <div class="field">
          <label>Status Barang</label>
          <input value="${escapeHtml(statusLabels[item.status] || item.status || "-")}" disabled />
        </div>
      `}
    </div>

    <div class="field">
      <label>Catatan</label>
      <textarea id="editItemNotes">${escapeHtml(item.notes || "")}</textarea>
    </div>

    <div class="edit-warning">
      <strong>Important:</strong> Jika barang sudah masuk batch Kirim Barang, perubahan stock akan memengaruhi sisa stock di Warehouse Page.
    </div>

    <div class="edit-actions">
      <button class="btn btn-accent" onclick="window.saveEditedItem('${itemId}')">Simpan Perubahan</button>
      <button class="btn btn-danger" onclick="window.deleteItem('${itemId}')">Hapus Barang</button>
    </div>
  `);
}

async function saveEditedItem(itemId) {
  const item = db.items?.[itemId];
  if (!item) {
    toast("Barang tidak ditemukan.");
    return;
  }

  const canEdit = currentUser?.role === "admin" || item.userId === currentUser?.id;
  if (!canEdit) {
    toast("Kamu tidak punya akses untuk edit barang ini.");
    return;
  }

  const itemName = $("editItemName").value.trim();
  const category = $("editItemCategory").value.trim();
  const quantity = Number($("editItemQuantity").value || 0);
  const estimatedPrice = Number($("editItemWeight").value || 0);
  const productLink = $("editItemLink").value.trim();
  const nomorResi = $("editItemNomorResi")?.value.trim() || "";
  const notes = $("editItemNotes").value.trim();
  const status = currentUser?.role === "admin"
    ? $("editItemStatus").value
    : item.status;

  if (!itemName) {
    toast("Nama barang wajib diisi.");
    return;
  }

  if (quantity < 0 || estimatedPrice < 0) {
    toast("Quantity dan berat tidak boleh negatif.");
    return;
  }

  await update(ref(database, `items/${itemId}`), {
    itemName,
    category,
    quantity,
    estimatedPrice: Number(estimatedPrice.toFixed(2)),
    productLink,
    nomorResi,
    notes,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser?.id || ""
  });

  closeModal();
  toast("Stock / barang berhasil diperbarui.");
}



function getHousingSettings() {
  const settings = db.housing?.settings || {};
  return {
    roomName: settings.roomName || "BKK DROP Housing Room",
    roomCount: 1,
    location: settings.location || "Bangkok",
    description: settings.description || "One-room housing slot for BKK DROP customers.",
    status: settings.status || "open"
  };
}

function dateRangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && startB < endA;
}

function getHousingConflicts(startDate, endDate, excludeBookingId = "") {
  return idToArray(db.housingBookings || {}).filter((booking) => {
    if (booking.id === excludeBookingId) return false;
    if (!["pending", "pending_conflict", "approved"].includes(booking.status)) return false;
    return dateRangesOverlap(startDate, endDate, booking.checkIn, booking.checkOut);
  });
}

function getMyHousingBookings() {
  return idToArray(db.housingBookings || {}).filter((booking) => booking.userId === currentUser?.id);
}

function openHousingBookingModal() {
  const settings = getHousingSettings();

  if (settings.status === "closed") {
    toast("Housing booking sedang ditutup oleh admin.");
    return;
  }

  showModal("Booking Housing BKK DROP", `
    <div class="housing-modal-hero">
      <strong>${escapeHtml(settings.roomName)}</strong>
      <p>Lokasi: ${escapeHtml(settings.location)} • Room available: 1</p>
    </div>

    <div class="grid grid-2">
      <div class="field"><label>Check-in</label><input id="housingCheckIn" type="date" /></div>
      <div class="field"><label>Check-out</label><input id="housingCheckOut" type="date" /></div>
      <div class="field"><label>Jumlah Tamu</label><input id="housingGuests" type="number" min="1" value="1" /></div>
      <div class="field">
        <label>Purpose</label>
        <select id="housingPurpose">
          <option value="jastip_trip">Jastip Trip</option>
          <option value="warehouse_visit">Warehouse Visit</option>
          <option value="short_stay">Short Stay</option>
          <option value="other">Other</option>
        </select>
      </div>
    </div>

    <div class="field">
      <label>Catatan</label>
      <textarea id="housingNotes" placeholder="Jam kedatangan, kebutuhan khusus, atau catatan lain..."></textarea>
    </div>

    <div class="notice notice-warning">
      Karena room hanya 1, booking dengan tanggal overlap akan ditandai sebagai konflik. Admin akan mengkonfirmasi slot yang tersedia.
    </div>

    <button type="button" class="btn btn-accent btn-full" onclick="window.createHousingBooking()">Request Booking Housing</button>
  `);
}

async function createHousingBooking() {
  try {
    const checkIn = $("housingCheckIn")?.value || "";
    const checkOut = $("housingCheckOut")?.value || "";
    const guests = Number($("housingGuests")?.value || 1);
    const purpose = $("housingPurpose")?.value || "other";
    const notes = $("housingNotes")?.value.trim() || "";

    if (!currentUser?.id) {
      toast("User belum login.");
      return;
    }

    if (!checkIn || !checkOut) {
      toast("Check-in dan check-out wajib diisi.");
      return;
    }

    if (checkOut <= checkIn) {
      toast("Check-out harus setelah check-in.");
      return;
    }

    const conflicts = getHousingConflicts(checkIn, checkOut);
    const bookingRef = push(ref(database, "housingBookings"));

    await set(bookingRef, {
      userId: currentUser.id,
      customerName: currentUser.name || "",
      checkIn,
      checkOut,
      guests,
      purpose,
      notes,
      status: conflicts.length ? "pending_conflict" : "pending",
      conflictCount: conflicts.length,
      createdAt: new Date().toISOString()
    });

    closeModal();
    customerPage = "housing";
    renderApp();
    toast(conflicts.length ? "Request terkirim, tetapi ada potensi konflik tanggal." : "Request booking housing berhasil dikirim.");
  } catch (error) {
    console.error(error);
    toast("Gagal membuat booking housing. Cek Firebase rules atau console.");
  }
}

function openEditHousingSettingsModal() {
  const settings = getHousingSettings();

  showModal("Housing Settings", `
    <div class="grid grid-2">
      <div class="field"><label>Nama Room</label><input id="housingRoomName" value="${escapeHtml(settings.roomName)}" /></div>
      <div class="field"><label>Lokasi</label><input id="housingLocation" value="${escapeHtml(settings.location)}" /></div>
      <div class="field"><label>Jumlah Room</label><input value="1" disabled /></div>
      <div class="field">
        <label>Status Booking</label>
        <select id="housingStatus">
          <option value="open" ${settings.status === "open" ? "selected" : ""}>Open</option>
          <option value="closed" ${settings.status === "closed" ? "selected" : ""}>Closed</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Deskripsi</label><textarea id="housingDescription">${escapeHtml(settings.description)}</textarea></div>
    <button type="button" class="btn btn-accent btn-full" onclick="window.saveHousingSettings()">Simpan Housing Settings</button>
  `);
}

async function saveHousingSettings() {
  try {
    const roomName = $("housingRoomName")?.value.trim() || "BKK DROP Housing Room";
    const location = $("housingLocation")?.value.trim() || "Bangkok";
    const description = $("housingDescription")?.value.trim() || "";
    const status = $("housingStatus")?.value || "open";

    await update(ref(database, "housing/settings"), {
      roomName,
      location,
      roomCount: 1,
      description,
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.id || "admin"
    });

    closeModal();
    adminPage = "housing";
    renderApp();
    toast("Housing settings diperbarui.");
  } catch (error) {
    console.error(error);
    toast("Gagal menyimpan housing settings. Cek Firebase rules atau console.");
  }
}

async function updateHousingBookingStatus(bookingId, status) {
  try {
    const booking = db.housingBookings?.[bookingId];
    if (!booking) {
      toast("Booking tidak ditemukan.");
      return;
    }

    if (status === "approved") {
      const conflicts = getHousingConflicts(booking.checkIn, booking.checkOut, bookingId)
        .filter((conflict) => conflict.status === "approved");

      if (conflicts.length) {
        toast("Tidak bisa approve. Ada booking approved yang overlap.");
        return;
      }
    }

    await update(ref(database, `housingBookings/${bookingId}`), {
      status,
      reviewedAt: new Date().toISOString(),
      reviewedBy: currentUser?.id || "admin"
    });

    toast("Status housing booking diperbarui.");
  } catch (error) {
    console.error(error);
    toast("Gagal update status housing.");
  }
}

async function deleteHousingBooking(bookingId) {
  if (!confirm("Hapus booking housing ini?")) return;

  try {
    await remove(ref(database, `housingBookings/${bookingId}`));
    toast("Booking housing dihapus.");
  } catch (error) {
    console.error(error);
    toast("Gagal hapus booking housing.");
  }
}

function exportHousingBookingsCSV() {
  const bookings = idToArray(db.housingBookings || {});
  const headers = ["Customer", "Check-in", "Check-out", "Guests", "Purpose", "Status", "Notes"];
  const rows = bookings.map((booking) => [
    booking.customerName || db.users?.[booking.userId]?.name || "",
    booking.checkIn || "",
    booking.checkOut || "",
    booking.guests || "",
    booking.purpose || "",
    booking.status || "",
    booking.notes || ""
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "bkk-drop-housing-bookings.csv";
  link.click();
  URL.revokeObjectURL(url);
}


function calculateInvoiceSubtotal(invoice) {
  const items = Object.values(invoice.items || {});
  return items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unitPrice || 0)), 0);
}

function calculateInvoiceTotal(invoice) {
  const subtotal = calculateInvoiceSubtotal(invoice);
  const discount = Number(invoice.discount || 0);
  const extraFee = Number(invoice.extraFee || 0);
  return Math.max(0, subtotal - discount + extraFee);
}

function getMyInvoices() {
  return idToArray(db.invoices || {}).filter((invoice) => invoice.userId === currentUser?.id);
}

function formatCurrency(value = 0, currency = "THB") {
  const number = Number(value || 0);
  return `${number.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}

function getInvoiceStatusLabel(status) {
  const labels = {
    draft: "Draft",
    sent: "Belum Dibayar",
    payment_submitted: "Menunggu Verifikasi",
    paid: "Paid",
    cancelled: "Cancelled"
  };
  return labels[status] || status || "Draft";
}

function openCreateInvoiceModal() {
  const customers = idToArray(db.users || {}).filter((user) => user.role === "customer");
  const customerOptions = customers.map((user) => `
    <option value="${user.id}">${escapeHtml(user.name || user.username || user.id)}</option>
  `).join("");

  showModal("Buat Invoice / Billing", `
    <div class="grid grid-2">
      <div class="field">
        <label>Customer</label>
        <select id="invoiceCustomer">${customerOptions || `<option value="">Belum ada customer</option>`}</select>
      </div>
      <div class="field">
        <label>Currency</label>
        <select id="invoiceCurrency">
          <option value="THB">THB</option>
          <option value="IDR">IDR</option>
        </select>
      </div>
      <div class="field">
        <label>Due Date</label>
        <input id="invoiceDueDate" type="date" />
      </div>
      <div class="field">
        <label>Status</label>
        <select id="invoiceStatus">
          <option value="sent">Belum Dibayar</option>
          <option value="draft">Draft</option>
          <option value="paid">Paid</option>
        </select>
      </div>
    </div>

    <div class="billing-line-editor">
      <h3>Invoice Items</h3>
      <div id="invoiceLineItems"></div>
      <button type="button" class="btn btn-blue" onclick="window.addInvoiceLineInput()">+ Add Line Item</button>
    </div>

    <div class="grid grid-2">
      <div class="field">
        <label>Discount</label>
        <input id="invoiceDiscount" type="number" min="0" step="0.01" value="0" />
      </div>
      <div class="field">
        <label>Extra Fee</label>
        <input id="invoiceExtraFee" type="number" min="0" step="0.01" value="0" />
      </div>
    </div>

    <div class="field">
      <label>Catatan Invoice</label>
      <textarea id="invoiceNotes" placeholder="Payment instruction, bank account, notes..."></textarea>
    </div>

    <button type="button" class="btn btn-accent btn-full" onclick="window.createInvoiceFromForm()">Create Invoice</button>
  `);

  window.addInvoiceLineInput("Warehouse / Jastip Service", 1, 0);
}

function addInvoiceLineInput(description = "", qty = 1, unitPrice = 0) {
  const container = $("invoiceLineItems");
  if (!container) return;

  const rowId = `line_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const row = document.createElement("div");
  row.className = "invoice-line-input";
  row.dataset.rowId = rowId;
  row.innerHTML = `
    <div class="field">
      <label>Description</label>
      <input class="invoiceLineDescription" value="${escapeHtml(description)}" placeholder="Service / item description" />
    </div>
    <div class="field">
      <label>Qty</label>
      <input class="invoiceLineQty" type="number" min="0" step="0.01" value="${escapeHtml(qty)}" />
    </div>
    <div class="field">
      <label>Unit Price</label>
      <input class="invoiceLineUnitPrice" type="number" min="0" step="0.01" value="${escapeHtml(unitPrice)}" />
    </div>
    <button type="button" class="btn btn-danger" onclick="this.closest('.invoice-line-input').remove()">Remove</button>
  `;
  container.appendChild(row);
}

function collectInvoiceLineItems() {
  const rows = Array.from(document.querySelectorAll(".invoice-line-input"));
  const items = {};
  rows.forEach((row, index) => {
    const description = row.querySelector(".invoiceLineDescription")?.value.trim() || "";
    const qty = Number(row.querySelector(".invoiceLineQty")?.value || 0);
    const unitPrice = Number(row.querySelector(".invoiceLineUnitPrice")?.value || 0);

    if (description && qty > 0) {
      items[`line_${index + 1}`] = {
        description,
        qty,
        unitPrice,
        amount: Number((qty * unitPrice).toFixed(2))
      };
    }
  });
  return items;
}

async function createInvoiceFromForm() {
  try {
    const userId = $("invoiceCustomer")?.value || "";
    const user = db.users?.[userId] || {};
    const currency = $("invoiceCurrency")?.value || "THB";
    const dueDate = $("invoiceDueDate")?.value || "";
    const status = $("invoiceStatus")?.value || "sent";
    const discount = Number($("invoiceDiscount")?.value || 0);
    const extraFee = Number($("invoiceExtraFee")?.value || 0);
    const notes = $("invoiceNotes")?.value.trim() || "";
    const items = collectInvoiceLineItems();

    if (!userId) {
      toast("Pilih customer dulu.");
      return;
    }

    if (!Object.keys(items).length) {
      toast("Minimal 1 invoice item wajib diisi.");
      return;
    }

    const invoiceRef = push(ref(database, "invoices"));
    const invoiceNumber = `BKK-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    const subtotal = Object.values(items).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const total = Math.max(0, subtotal - discount + extraFee);

    await set(invoiceRef, {
      invoiceNumber,
      userId,
      customerName: user.name || user.username || "",
      currency,
      dueDate,
      status,
      items,
      discount,
      extraFee,
      subtotal: Number(subtotal.toFixed(2)),
      total: Number(total.toFixed(2)),
      notes,
      paymentProofs: {},
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.id || "admin"
    });

    closeModal();
    adminPage = "billing";
    renderApp();
    toast("Invoice berhasil dibuat.");
  } catch (error) {
    console.error(error);
    toast("Gagal membuat invoice. Cek Firebase rules atau console.");
  }
}

function openInvoiceDetailModal(invoiceId) {
  const invoice = db.invoices?.[invoiceId];
  if (!invoice) {
    toast("Invoice tidak ditemukan.");
    return;
  }

  const isAdmin = currentUser?.role === "admin";
  const lineItems = Object.values(invoice.items || {});
  const proofs = Object.entries(invoice.paymentProofs || {});

  showModal(`Invoice ${escapeHtml(invoice.invoiceNumber || "")}`, `
    <div class="invoice-detail-head">
      <div>
        <div class="stat-label">Customer</div>
        <strong>${escapeHtml(invoice.customerName || db.users?.[invoice.userId]?.name || "-")}</strong>
      </div>
      <div>
        <div class="stat-label">Status</div>
        <strong>${escapeHtml(getInvoiceStatusLabel(invoice.status))}</strong>
      </div>
      <div>
        <div class="stat-label">Due Date</div>
        <strong>${escapeHtml(invoice.dueDate || "-")}</strong>
      </div>
      <div>
        <div class="stat-label">Total</div>
        <strong>${escapeHtml(formatCurrency(calculateInvoiceTotal(invoice), invoice.currency))}</strong>
      </div>
    </div>

    <div class="invoice-lines">
      ${lineItems.map((item) => `
        <div class="invoice-line-view">
          <div>
            <strong>${escapeHtml(item.description || "-")}</strong>
            <div class="muted small">Qty ${escapeHtml(item.qty || 0)} × ${escapeHtml(formatCurrency(item.unitPrice || 0, invoice.currency))}</div>
          </div>
          <strong>${escapeHtml(formatCurrency(item.amount || 0, invoice.currency))}</strong>
        </div>
      `).join("")}
    </div>

    <div class="invoice-total-box">
      <div><span>Subtotal</span><strong>${escapeHtml(formatCurrency(calculateInvoiceSubtotal(invoice), invoice.currency))}</strong></div>
      <div><span>Discount</span><strong>${escapeHtml(formatCurrency(invoice.discount || 0, invoice.currency))}</strong></div>
      <div><span>Extra Fee</span><strong>${escapeHtml(formatCurrency(invoice.extraFee || 0, invoice.currency))}</strong></div>
      <div class="grand-total"><span>Total</span><strong>${escapeHtml(formatCurrency(calculateInvoiceTotal(invoice), invoice.currency))}</strong></div>
    </div>

    ${invoice.notes ? `<div class="invoice-notes">${escapeHtml(invoice.notes)}</div>` : ""}

    <div class="payment-proof-section">
      <div class="card-row">
        <h3>Payment Proof</h3>
        ${!isAdmin ? `
          <label class="btn btn-blue">
            Upload Bukti Bayar
            <input type="file" accept="image/*" style="display:none" onchange="window.handleInvoicePaymentProofUpload('${invoiceId}', this)" />
          </label>
        ` : ""}
      </div>
      <div class="admin-photo-grid">
        ${proofs.length ? proofs.map(([proofId, proof]) => `
          <div class="admin-photo-card">
            <img src="${escapeHtml(proof.url)}" alt="Payment proof" />
            <div class="admin-photo-meta">
              <span>${escapeHtml(formatBytes(proof.compressedSize || proof.originalSize || 0))}</span>
              ${isAdmin ? `<button class="btn btn-danger" onclick="window.deleteInvoicePaymentProof('${invoiceId}', '${proofId}')">Hapus Bukti</button>` : ""}
            </div>
          </div>
        `).join("") : `<div class="empty">Belum ada bukti bayar.</div>`}
      </div>
    </div>

    ${isAdmin ? `
      <div class="invoice-admin-actions">
        <button class="btn btn-blue" onclick="window.updateInvoiceStatus('${invoiceId}', 'sent')">Set Belum Dibayar</button>
        <button class="btn btn-green" onclick="window.updateInvoiceStatus('${invoiceId}', 'paid')">Mark Paid</button>
        <button class="btn btn-danger" onclick="window.updateInvoiceStatus('${invoiceId}', 'cancelled')">Cancel</button>
        <button class="btn btn-danger soft-danger" onclick="window.deleteInvoice('${invoiceId}')">Delete Invoice</button>
      </div>
    ` : ""}
  `);
}

async function handleInvoicePaymentProofUpload(invoiceId, inputElement) {
  const file = inputElement.files?.[0];
  if (!file) return;

  const invoice = db.invoices?.[invoiceId];
  if (!invoice || invoice.userId !== currentUser?.id) {
    toast("Invoice tidak valid untuk user ini.");
    return;
  }

  try {
    toast("Mengupload bukti bayar...");
    const uploaded = await uploadImageToCloudinary(file, currentUser.id, `invoice_${invoiceId}`);
    const proofRef = push(ref(database, `invoices/${invoiceId}/paymentProofs`));

    await set(proofRef, {
      ...uploaded,
      source: "payment_proof",
      uploadedBy: currentUser.id,
      uploadedAt: new Date().toISOString()
    });

    await update(ref(database, `invoices/${invoiceId}`), {
      status: "payment_submitted",
      paymentSubmittedAt: new Date().toISOString()
    });

    toast("Bukti bayar berhasil diupload.");
    closeModal();
    openInvoiceDetailModal(invoiceId);
  } catch (error) {
    console.error(error);
    toast(error.message || "Upload bukti bayar gagal.");
  } finally {
    inputElement.value = "";
  }
}

async function updateInvoiceStatus(invoiceId, status) {
  try {
    await update(ref(database, `invoices/${invoiceId}`), {
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.id || "admin"
    });
    toast("Status invoice diperbarui.");
    closeModal();
    renderApp();
  } catch (error) {
    console.error(error);
    toast("Gagal update invoice.");
  }
}

async function deleteInvoicePaymentProof(invoiceId, proofId) {
  if (!confirm("Hapus bukti bayar ini?")) return;
  await remove(ref(database, `invoices/${invoiceId}/paymentProofs/${proofId}`));
  toast("Bukti bayar dihapus.");
  closeModal();
  openInvoiceDetailModal(invoiceId);
}

async function deleteInvoice(invoiceId) {
  if (!confirm("Hapus invoice ini?")) return;
  await remove(ref(database, `invoices/${invoiceId}`));
  closeModal();
  renderApp();
  toast("Invoice dihapus.");
}

function exportInvoicesCSV() {
  const invoices = idToArray(db.invoices || {});
  const headers = ["Invoice", "Customer", "Status", "Due Date", "Currency", "Subtotal", "Discount", "Extra Fee", "Total"];
  const rows = invoices.map((invoice) => [
    invoice.invoiceNumber || "",
    invoice.customerName || "",
    getInvoiceStatusLabel(invoice.status),
    invoice.dueDate || "",
    invoice.currency || "THB",
    calculateInvoiceSubtotal(invoice),
    invoice.discount || 0,
    invoice.extraFee || 0,
    calculateInvoiceTotal(invoice)
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "bkk-drop-invoices.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function exportItemsToCSV(items, filename = "bkk-drop-item-list.csv") {
  const headers = ["Customer", "Slot", "Nama Barang", "Kategori", "Jumlah", "Estimasi Berat (kg)", "Status", "Link Produk", "Catatan", "Jumlah Foto"];
  const rows = items.map((item) => {
    const user = db.users[item.userId] || {};
    const slot = db.slots[item.slotId] || {};
    return [
      user.name || "",
      slot.title || "",
      item.itemName || "",
      item.category || "",
      item.quantity || "",
      item.estimatedPrice || "",
      statusLabels[item.status] || item.status || "",
      item.productLink || "",
      item.notes || "",
      Object.keys(item.images || {}).length
    ];
  });

  const csvContent = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getApprovedSlotIds(userId) {
  return idToArray(db.bookings)
    .filter((b) => b.userId === userId && b.status === "approved")
    .map((b) => b.slotId);
}

function getSlotUsedWeight(slotId) {
  return idToArray(db.items)
    .filter((item) => item.slotId === slotId && item.status !== "cancelled")
    .reduce((sum, item) => sum + Number(item.estimatedPrice || 0), 0);
}

function renderApp() {
  if (!currentUser) return;

  $("loginSection").classList.add("hidden");
  $("dashboardSection").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("customerViewBtn").classList.toggle("hidden", currentUser.role !== "admin");
  $("adminViewBtn").classList.toggle("hidden", currentUser.role !== "admin");
  $("addItemBtn").classList.toggle("hidden", currentView === "admin" || customerPage !== "warehouse");
  $("exportMyItemsBtn").textContent = currentView === "admin" ? "Export Semua Data" : "Export Data";

  if (currentView === "admin") {
    const titles = {
      warehouse: "Warehouse Page",
      kirim: "Kirim Barang",
      housing: "Housing",
      billing: "Billing"
    };
    $("dashboardTitle").textContent = titles[adminPage] || "Admin Panel";
    $("dashboardSubtitle").textContent = "Kelola BKK DROP dari satu dashboard admin.";
  } else {
    const titles = {
      warehouse: `Halo, ${currentUser.name}`,
      kirim: "Kirim Barang",
      housing: "Housing",
      billing: "Billing"
    };
    $("dashboardTitle").textContent = titles[customerPage] || `Halo, ${currentUser.name}`;
    $("dashboardSubtitle").textContent = "Kelola warehouse, pengiriman, housing, dan billing kamu.";
  }

  renderStats();
  renderTabs();

  if (currentView === "admin") {
    $("adminPanel").classList.remove("hidden");
    $("customerPanel").classList.add("hidden");

    if (adminPage === "kirim") {
      renderKirimBarangPanel();
    } else if (adminPage === "housing") {
      renderAdminHousingPanel();
    } else if (adminPage === "billing") {
      renderAdminBillingPanel();
    } else {
      renderAdminPanel();
    }
  } else {
    $("customerPanel").classList.remove("hidden");
    $("adminPanel").classList.add("hidden");

    if (customerPage === "kirim") {
      renderCustomerKirimBarangPanel();
    } else if (customerPage === "housing") {
      renderCustomerHousingPanel();
    } else if (customerPage === "billing") {
      renderCustomerBillingPanel();
    } else {
      renderCustomerPanel();
    }
  }
}

function renderStats() {
  const allItems = idToArray(db.items);
  const myItems = allItems.filter((item) => item.userId === currentUser.id);
  const pendingBookings = idToArray(db.bookings).filter((b) => b.status === "pending").length;
  const openSlots = idToArray(db.slots).filter((s) => s.status === "open").length;

  const stats = currentView === "admin"
    ? [["Total Customer", idToArray(db.users).filter((u) => u.role === "customer").length], ["Pending Booking", pendingBookings], ["Total Barang", allItems.length]]
    : [["Slot Terbuka", openSlots], ["Barang Saya", myItems.length], ["Foto Tersimpan", myItems.reduce((sum, item) => sum + Object.keys(item.images || {}).length, 0)]];

  $("statsGrid").innerHTML = stats.map(([label, value]) => `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
    </div>
  `).join("");
}

function renderTabs() {
  const ribbon = $("mainMenuRibbon");
  const tabs = $("tabs");

  if (tabs) {
    tabs.innerHTML = "";
    tabs.classList.add("hidden");
  }

  if (!ribbon) return;

  ribbon.classList.remove("hidden");

  if (currentView === "admin") {
    ribbon.innerHTML = `
      <div class="menu-scroll">
        <button class="menu-pill ${adminPage === "warehouse" ? "active" : ""}" onclick="window.setAdminPage('warehouse')">Warehouse</button>
        <button class="menu-pill ${adminPage === "kirim" ? "active" : ""}" onclick="window.setAdminPage('kirim')">Kirim Barang</button>
        <button class="menu-pill ${adminPage === "housing" ? "active" : ""}" onclick="window.setAdminPage('housing')">Housing</button>
        <button class="menu-pill ${adminPage === "billing" ? "active" : ""}" onclick="window.setAdminPage('billing')">Billing</button>
        <button class="menu-pill action" onclick="window.openCreateUserModal()">+ Customer</button>
        <button class="menu-pill action" onclick="window.openCreateSlotModal()">+ Slot</button>
        <button class="menu-pill action" onclick="window.openCreateShipmentModal()">+ Batch</button>
      </div>
    `;
  } else {
    ribbon.innerHTML = `
      <div class="menu-scroll">
        <button class="menu-pill ${customerPage === "warehouse" ? "active" : ""}" onclick="window.setCustomerPage('warehouse')">Warehouse</button>
        <button class="menu-pill ${customerPage === "kirim" ? "active" : ""}" onclick="window.setCustomerPage('kirim')">Kirim Barang</button>
        <button class="menu-pill ${customerPage === "housing" ? "active" : ""}" onclick="window.setCustomerPage('housing')">Housing</button>
        <button class="menu-pill ${customerPage === "billing" ? "active" : ""}" onclick="window.setCustomerPage('billing')">Billing</button>
        <button class="menu-pill action" onclick="window.scrollToSlotList()">Slot</button>
      </div>
    `;
  }
}

function renderCustomerPanel() {
  const allMyItems = idToArray(db.items).filter((item) => item.userId === currentUser.id);
  const slots = idToArray(db.slots);
  const bookings = idToArray(db.bookings).filter((b) => b.userId === currentUser.id);

  const search = inventorySearch.trim().toLowerCase();

  const myItems = allMyItems.filter((item) => {
    const haystack = [
      item.itemName,
      item.category,
      item.notes,
      item.estimatedPrice,
      db.slots[item.slotId]?.title,
      statusLabels[item.status] || item.status
    ].join(" ").toLowerCase();

    const matchSearch = !search || haystack.includes(search);
    const matchStatus = inventoryStatusFilter === "all" || item.status === inventoryStatusFilter;

    return matchSearch && matchStatus;
  });

  const totalQty = allMyItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalWeight = allMyItems.reduce((sum, item) => sum + Number(item.estimatedPrice || 0), 0);
  const totalPhotos = allMyItems.reduce((sum, item) => sum + Object.keys(item.images || {}).length, 0);

  $("customerPanel").innerHTML = `
    <div class="card warehouse-card">
      <div class="warehouse-header">
        <div>
          <h2>Gudang Saya</h2>
          <p class="muted">Inventory ringkas untuk banyak barang. Gunakan search dan filter agar lebih cepat.</p>
        </div>
        <div class="warehouse-mini-stats">
          <div><strong>${allMyItems.length}</strong><span>Item</span></div>
          <div><strong>${totalQty}</strong><span>Qty</span></div>
          <div><strong>${formatWeight(totalWeight)} kg</strong><span>Berat</span></div>
          <div><strong>${totalPhotos}</strong><span>Foto</span></div>
        </div>
      </div>

      <div class="inventory-toolbar">
        <div class="field toolbar-field">
          <label>Cari Barang</label>
          <input id="inventorySearchInput" value="${escapeHtml(inventorySearch)}" placeholder="Cari nama, kategori, catatan, berat..." />
        </div>
        <div class="field toolbar-field">
          <label>Status</label>
          <select id="inventoryStatusFilter">
            <option value="all" ${inventoryStatusFilter === "all" ? "selected" : ""}>Semua Status</option>
            ${Object.entries(statusLabels).map(([value, label]) => `
              <option value="${value}" ${inventoryStatusFilter === value ? "selected" : ""}>${label}</option>
            `).join("")}
          </select>
        </div>
      </div>

      <div class="inventory-result-note">
        Menampilkan <strong>${myItems.length}</strong> dari <strong>${allMyItems.length}</strong> barang.
      </div>

      <div class="inventory-list">
        ${myItems.length ? myItems.map(renderItemCard).join("") : `<div class="empty">Tidak ada barang yang cocok dengan filter.</div>`}
      </div>
    </div>

    <div class="card" id="slotListCard">
      <h2>Slot Tersedia</h2>
      <p class="muted">Pilih slot warehouse yang masih dibuka oleh admin.</p>
      <div class="grid grid-2" style="margin-top: 14px;">
        ${slots.length ? slots.map((slot) => renderSlotCard(slot, bookings)).join("") : `<div class="empty">Belum ada slot tersedia.</div>`}
      </div>
    </div>
  `;

  const searchInput = document.getElementById("inventorySearchInput");
  const statusFilter = document.getElementById("inventoryStatusFilter");

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      inventorySearch = event.target.value;
      renderCustomerPanel();
    });
    searchInput.focus({ preventScroll: true });
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  if (statusFilter) {
    statusFilter.addEventListener("change", (event) => {
      inventoryStatusFilter = event.target.value;
      renderCustomerPanel();
    });
  }
}

function renderSlotCard(slot, myBookings = []) {
  const usedWeight = getSlotUsedWeight(slot.id);
  const maxWeight = Number(slot.maxWeightKg || slot.maxCustomers || 0);
  const percent = maxWeight ? Math.min(100, Math.round((usedWeight / maxWeight) * 100)) : 0;
  const existing = myBookings.find((b) => b.slotId === slot.id && b.status !== "cancelled");
  const isFull = maxWeight > 0 && usedWeight >= maxWeight;
  const isOpen = slot.status === "open" && !isFull;

  return `
    <div class="slot-card">
      <div class="card-row">
        <strong>${escapeHtml(slot.title)}</strong>
        <span class="pill ${isOpen ? "open" : "closed"}">${isOpen ? "Dibuka" : "Penuh/Tutup"}</span>
      </div>
      <div class="muted">${escapeHtml(slot.description || "")}</div>
      <div>
        <div class="card-row small"><strong>Kapasitas Berat</strong><span>${formatWeight(usedWeight)}/${formatWeight(maxWeight)} kg</span></div>
        <div class="progress"><span style="width:${percent}%"></span></div>
      </div>
      ${existing ? `<span class="pill ${existing.status}">${bookingLabels[existing.status] || existing.status}</span>` :
      `<button class="btn btn-accent" ${isOpen ? "" : "disabled"} onclick="window.requestSlot('${slot.id}')">Amankan Slot</button>`}
    </div>
  `;
}

function renderItemCard(item) {
  const images = Object.entries(item.images || {});
  const receivedImages = images.filter(([id, image]) => image.source === "admin_received");
  const customerImages = images.filter(([id, image]) => image.source !== "admin_received");
  const resiImages = Object.entries(item.resiImages || {});
  const slotName = db.slots[item.slotId]?.title || "No slot";
  const statusText = statusLabels[item.status] || item.status;
  const firstImage = receivedImages[0]?.[1]?.url || images[0]?.[1]?.url || "";
  const isPhotoVerified = item.photoVerificationStatus === "verified";

  return `
    <div class="inventory-row">
      <div class="inventory-thumb ${firstImage ? "" : "empty-thumb"}">
        ${firstImage ? `<img src="${escapeHtml(firstImage)}" alt="Product image" />` : `<span>No<br>Photo</span>`}
      </div>

      <div class="inventory-main">
        <div class="inventory-topline">
          <div>
            <strong class="inventory-name">${escapeHtml(item.itemName)}</strong>
            <div class="inventory-sub">${escapeHtml(slotName)}</div>
          </div>
          <div class="status-stack"><span class="pill status-pill">${escapeHtml(statusText)}</span>${isPhotoVerified ? `<span class="pill verified-pill">Foto Terverifikasi</span>` : `<span class="pill pending-photo-pill">Foto Belum Verified</span>`}</div>
        </div>

        <div class="inventory-meta">
          <div><span>Kategori</span><strong>${escapeHtml(item.category || "-")}</strong></div>
          <div><span>Qty</span><strong>${escapeHtml(item.quantity || 0)}</strong></div>
          <div><span>Estimasi Berat</span><strong>${escapeHtml(formatWeight(item.estimatedPrice))} kg</strong></div>
          <div><span>Foto</span><strong>${images.length}/8</strong></div>
          <div><span>Resi</span><strong>${resiImages.length}</strong></div>
        </div>

        ${item.nomorResi ? `<div class="inventory-note"><strong>Nomor Resi:</strong> ${escapeHtml(item.nomorResi)}</div>` : ""}
        ${item.notes ? `<div class="inventory-note">${escapeHtml(item.notes)}</div>` : ""}
        ${item.productLink ? `<a class="inventory-link" href="${escapeHtml(item.productLink)}" target="_blank">Buka link produk</a>` : ""}

        ${resiImages.length ? `
          <div class="resi-photo-section">
            <div class="received-photo-title">Foto Barang</div>
            <div class="image-strip">
              ${resiImages.map(([resiId, resi]) => `
                <div class="mini-image resi-mini">
                  <img src="${escapeHtml(resi.url)}" alt="Receipt image" />
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        ${receivedImages.length ? `
          <div class="received-photo-section">
            <div class="received-photo-title">Foto Barang Diterima Admin</div>
            <div class="image-strip">
              ${receivedImages.map(([imageId, image]) => `
                <div class="mini-image received-mini">
                  <img src="${escapeHtml(image.url)}" alt="Received product image" />
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        ${customerImages.length ? `
          <div class="customer-photo-section">
            <div class="received-photo-title">Foto Referensi Customer</div>
            <div class="image-strip">
              ${customerImages.slice(0, 6).map(([imageId, image]) => `
                <div class="mini-image">
                  <img src="${escapeHtml(image.url)}" alt="Product image" />
                  <button onclick="window.deleteImageRecord('${item.id}', '${imageId}')">×</button>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>

      <div class="inventory-actions">
        <button class="btn btn-soft" onclick="window.openEditItemModal('${item.id}')">Edit</button>
        <label class="btn btn-blue">
          Upload
          <input type="file" accept="image/*" style="display:none" onchange="window.handleImageUpload('${item.id}', this)" />
        </label>
        ${firstImage ? `<button class="btn btn-danger soft-danger" onclick="window.deleteImageRecord('${item.id}', '${images[0][0]}')">Hapus Foto</button>` : ""}
        <button class="btn btn-danger" onclick="window.deleteItem('${item.id}')">Hapus</button>
      </div>
    </div>
  `;
}


function openCustomerKirimRequestModal() {
  const shipments = getOpenShipments();
  const myWarehouseItems = getCustomerWarehouseAvailableItems(currentUser.id);

  const shipmentOptions = shipments.map((shipment) => {
    const usedWeight = getShipmentUsedWeight(shipment.id);
    const maxWeight = Number(shipment.maxWeightKg || 0);
    const remaining = Math.max(0, maxWeight - usedWeight);
    return `<option value="${shipment.id}">${escapeHtml(shipment.title || "Kirim Barang")} — sisa ${formatWeight(remaining)} kg</option>`;
  }).join("");

  const warehouseOptions = myWarehouseItems.map((item) => {
    return `<option value="${item.id}">${escapeHtml(item.itemName)} — Qty ${escapeHtml(item.quantity || 0)} — ${formatWeight(item.estimatedPrice)} kg</option>`;
  }).join("");

  if (!shipments.length) {
    toast("Belum ada batch Kirim Barang yang tersedia.");
    return;
  }

  showModal("Request Kirim Barang ke Indonesia", `
    <div class="notice notice-warning">Pilih barang yang ingin kamu kirim ke Indonesia. Admin akan melihat request ini di halaman Kirim Barang.</div>

    <div class="field">
      <label>Batch Kirim</label>
      <select id="customerShipmentId">${shipmentOptions}</select>
    </div>

    <div class="field">
      <label>Sumber Barang</label>
      <select id="customerShipmentSource" onchange="window.toggleCustomerShipmentSourceForm()">
        <option value="warehouse">Dari Stock Warehouse Saya</option>
        <option value="non_warehouse">Non Warehouse</option>
      </select>
    </div>

    <div id="customerWarehouseShipmentFields">
      <div class="field">
        <label>Pilih Barang dari Warehouse Saya</label>
        <select id="customerWarehouseItem">
          ${warehouseOptions || `<option value="">Tidak ada stock warehouse tersedia</option>`}
        </select>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Qty Dikirim</label><input id="customerWarehouseQty" type="number" min="1" value="1" /></div>
        <div class="field"><label>Berat Dikirim (kg)</label><input id="customerWarehouseWeight" type="number" min="0.01" step="0.01" value="0.1" /></div>
      </div>
      <p class="muted small">Jika request disimpan, qty dan berat akan langsung dikurangi dari Warehouse Page agar tidak double booking.</p>
    </div>

    <div id="customerNonWarehouseShipmentFields" class="hidden">
      <div class="grid grid-2">
        <div class="field"><label>Nama Barang</label><input id="customerNonWarehouseName" placeholder="Nama barang" /></div>
        <div class="field"><label>Qty</label><input id="customerNonWarehouseQty" type="number" min="1" value="1" /></div>
        <div class="field"><label>Berat (kg)</label><input id="customerNonWarehouseWeight" type="number" min="0.01" step="0.01" value="0.1" /></div>
      </div>
    </div>

    <div class="field"><label>Catatan untuk Admin</label><textarea id="customerShipmentNotes" placeholder="Catatan pengiriman..."></textarea></div>
    <button class="btn btn-accent btn-full" onclick="window.addCustomerShipmentRequest()">Request Kirim ke Indonesia</button>
  `);
}

function toggleCustomerShipmentSourceForm() {
  const source = $("customerShipmentSource")?.value || "warehouse";
  $("customerWarehouseShipmentFields")?.classList.toggle("hidden", source !== "warehouse");
  $("customerNonWarehouseShipmentFields")?.classList.toggle("hidden", source !== "non_warehouse");
}

async function addCustomerShipmentRequest() {
  const shipmentId = $("customerShipmentId").value;
  const shipment = db.shipments?.[shipmentId];
  const source = $("customerShipmentSource").value;

  if (!shipment) {
    toast("Batch Kirim Barang tidak ditemukan.");
    return;
  }

  const usedWeight = getShipmentUsedWeight(shipmentId);
  const maxWeight = Number(shipment.maxWeightKg || 0);
  let shipmentData = null;

  if (source === "warehouse") {
    const itemId = $("customerWarehouseItem").value;
    const qtyToSend = Number($("customerWarehouseQty").value || 0);
    const weightToSend = Number($("customerWarehouseWeight").value || 0);
    const item = db.items?.[itemId];

    if (!itemId || !item || item.userId !== currentUser.id) {
      toast("Pilih barang warehouse kamu dulu.");
      return;
    }

    const currentQty = Number(item.quantity || 0);
    const currentWeight = Number(item.estimatedPrice || 0);

    if (qtyToSend <= 0 || weightToSend <= 0) {
      toast("Qty dan berat harus lebih dari 0.");
      return;
    }

    if (qtyToSend > currentQty) {
      toast(`Qty melebihi stock warehouse. Stock tersedia: ${currentQty}.`);
      return;
    }

    if (weightToSend > currentWeight) {
      toast(`Berat melebihi stock warehouse. Berat tersedia: ${formatWeight(currentWeight)} kg.`);
      return;
    }

    if (maxWeight > 0 && usedWeight + weightToSend > maxWeight) {
      toast(`Melebihi kapasitas batch. Sisa kapasitas: ${formatWeight(Math.max(0, maxWeight - usedWeight))} kg.`);
      return;
    }

    shipmentData = {
      shipmentId,
      source: "warehouse",
      requestBy: "customer",
      requestStatus: "requested",
      itemId,
      userId: currentUser.id,
      ownerName: currentUser.name || "",
      itemName: item.itemName || "",
      quantity: qtyToSend,
      weightKg: weightToSend,
      notes: $("customerShipmentNotes").value.trim(),
      destination: "Indonesia",
      shipmentStatus: shipment.status || "planning",
      createdAt: new Date().toISOString()
    };

    const remainingQty = Math.max(0, currentQty - qtyToSend);
    const remainingWeight = Math.max(0, currentWeight - weightToSend);

    await update(ref(database, `items/${itemId}`), {
      quantity: remainingQty,
      estimatedPrice: Number(remainingWeight.toFixed(2)),
      status: remainingQty <= 0 || remainingWeight <= 0 ? "shipped_indonesia" : item.status,
      lastShipmentId: shipmentId,
      updatedAt: new Date().toISOString()
    });

  } else {
    const itemName = $("customerNonWarehouseName").value.trim();
    const qty = Number($("customerNonWarehouseQty").value || 0);
    const weightKg = Number($("customerNonWarehouseWeight").value || 0);

    if (!itemName || qty <= 0 || weightKg <= 0) {
      toast("Lengkapi data non warehouse.");
      return;
    }

    if (maxWeight > 0 && usedWeight + weightKg > maxWeight) {
      toast(`Melebihi kapasitas batch. Sisa kapasitas: ${formatWeight(Math.max(0, maxWeight - usedWeight))} kg.`);
      return;
    }

    shipmentData = {
      shipmentId,
      source: "non_warehouse",
      requestBy: "customer",
      requestStatus: "requested",
      itemId: "",
      userId: currentUser.id,
      ownerName: currentUser.name || "",
      itemName,
      quantity: qty,
      weightKg,
      notes: $("customerShipmentNotes").value.trim(),
      destination: "Indonesia",
      shipmentStatus: shipment.status || "planning",
      createdAt: new Date().toISOString()
    };
  }

  const shipmentItemRef = push(ref(database, "shipmentItems"));
  await set(shipmentItemRef, shipmentData);

  closeModal();
  customerPage = "kirim";
  renderApp();
  toast("Request Kirim Barang berhasil dikirim ke admin.");
}

async function updateShipmentItemRequestStatus(shipmentItemId, requestStatus) {
  const shipmentItem = db.shipmentItems?.[shipmentItemId];
  if (!shipmentItem) {
    toast("Item pengiriman tidak ditemukan.");
    return;
  }

  await update(ref(database, `shipmentItems/${shipmentItemId}`), {
    requestStatus,
    reviewedBy: currentUser?.id || "admin",
    reviewedAt: new Date().toISOString()
  });

  toast("Status request diperbarui.");
}

function renderCustomerKirimBarangPanel() {
  const myShipmentItems = getCustomerShipmentItems(currentUser.id);
  const shipments = getOpenShipments();

  $("customerPanel").innerHTML = `
    <div class="card">
      <div class="card-row">
        <div>
          <h2>Kirim Barang</h2>
          <p class="muted">Pilih barang dari stock warehouse kamu atau tambah barang non-warehouse untuk dikirim ke Indonesia.</p>
        </div>
        <button class="btn btn-accent" onclick="window.openCustomerKirimRequestModal()">+ Request Kirim Barang</button>
      </div>
      <div class="notice notice-warning" style="margin-top: 14px;">
        Batch tersedia: ${shipments.length}. Destination: Indonesia.
      </div>
      <div class="shipment-items" style="margin-top: 14px;">
        ${myShipmentItems.length ? myShipmentItems.map((item) => {
          const shipment = db.shipments?.[item.shipmentId] || {};
          return `
            <div class="shipment-item-row">
              <div>
                <strong>${escapeHtml(item.itemName)}</strong>
                <div class="muted small">Batch: ${escapeHtml(shipment.title || "-")}</div>
                <div class="muted small">Tanggal Terbang: ${escapeHtml(shipment.flightDate || "Belum diatur")} • Destination: Indonesia</div>
                <div class="muted small">Sumber: ${item.source === "warehouse" ? "Dari Warehouse" : "Non Warehouse"}</div>
                ${item.notes ? `<div class="shipment-note">${escapeHtml(item.notes)}</div>` : ""}
              </div>
              <div class="shipment-item-meta">
                <span>Qty ${escapeHtml(item.quantity || 0)}</span>
                <span>${formatWeight(item.weightKg)} kg</span>
                <span>${escapeHtml(item.requestStatus || "requested")}</span>
                <span>${escapeHtml(shipment.status || "planning")}</span>
              </div>
            </div>
          `;
        }).join("") : `<div class="empty">Belum ada request Kirim Barang. Klik “+ Request Kirim Barang”.</div>`}
      </div>
    </div>
  `;
}

function renderKirimBarangPanel() {
  const shipments = idToArray(db.shipments || {});
  const shipmentItems = idToArray(db.shipmentItems || {});

  $("adminPanel").innerHTML = `
    <div class="card kirim-hero">
      <div class="card-row">
        <div>
          <h2>Kirim Barang</h2>
          <p class="muted">Destination: Indonesia. Atur tanggal terbang, kapasitas berat, dan isi barang dari warehouse atau non warehouse.</p>
        </div>
        <button class="btn btn-accent" onclick="window.openCreateShipmentModal()">+ Buat Batch Kirim</button>
      </div>
    </div>

    <div class="grid">
      ${shipments.length ? shipments.map((shipment) => {
        const usedWeight = getShipmentUsedWeight(shipment.id);
        const maxWeight = Number(shipment.maxWeightKg || 0);
        const percent = maxWeight ? Math.min(100, Math.round((usedWeight / maxWeight) * 100)) : 0;
        const items = shipmentItems.filter((item) => item.shipmentId === shipment.id);

        return `
          <div class="card shipment-card">
            <div class="shipment-head">
              <div>
                <h3>${escapeHtml(shipment.title || "Kirim Barang ke Indonesia")}</h3>
                <p class="muted">Destination: Indonesia • Tanggal: ${escapeHtml(shipment.flightDate || "Belum diatur")} • Status: ${escapeHtml(shipment.status || "planning")}</p>
              </div>
              <div class="shipment-actions">
                <button class="btn btn-blue" onclick="window.openEditShipmentModal('${shipment.id}')">Edit Batch</button>
                <button class="btn btn-accent" onclick="window.openAddShipmentItemModal('${shipment.id}')">+ Tambah Barang</button>
                <button class="btn btn-soft" onclick="window.exportShipmentCSV('${shipment.id}')">Export</button>
              </div>
            </div>

            <div class="shipment-capacity">
              <div class="card-row small">
                <strong>Kapasitas Terbang</strong>
                <span>${formatWeight(usedWeight)} / ${formatWeight(maxWeight)} kg</span>
              </div>
              <div class="progress"><span style="width:${percent}%"></span></div>
            </div>

            <div class="shipment-items">
              ${items.length ? items.map((item) => `
                <div class="shipment-item-row">
                  <div>
                    <strong>${escapeHtml(item.itemName)}</strong>
                    <div class="muted small">${escapeHtml(item.ownerName || "-")} • ${item.source === "warehouse" ? "Dari Warehouse" : "Non Warehouse"}</div>
                    ${item.notes ? `<div class="shipment-note">${escapeHtml(item.notes)}</div>` : ""}
                  </div>
                  <div class="shipment-item-meta">
                    <span>Qty ${escapeHtml(item.quantity || 0)}</span>
                    <span>${formatWeight(item.weightKg)} kg</span>
                    <span>${escapeHtml(item.requestStatus || (item.requestBy === "customer" ? "requested" : "admin_added"))}</span>
                    ${item.requestBy === "customer" ? `<button class="btn btn-green" onclick="window.updateShipmentItemRequestStatus('${item.id}', 'approved')">Approve</button><button class="btn btn-danger" onclick="window.updateShipmentItemRequestStatus('${item.id}', 'rejected')">Reject</button>` : ""}
                    <button class="btn btn-danger" onclick="window.deleteShipmentItem('${item.id}')">Hapus</button>
                  </div>
                </div>
              `).join("") : `<div class="empty">Belum ada barang dalam batch ini.</div>`}
            </div>
          </div>
        `;
      }).join("") : `<div class="empty">Belum ada batch Kirim Barang. Klik “+ Buat Batch Kirim”.</div>`}
    </div>
  `;
}


function renderCustomerHousingPanel() {
  const settings = getHousingSettings();
  const myBookings = getMyHousingBookings();

  $("customerPanel").innerHTML = `
    <div class="card housing-hero">
      <div class="card-row">
        <div>
          <h2>Housing Booking</h2>
          <p class="muted">${escapeHtml(settings.description || "Book the BKK DROP housing room in Bangkok.")}</p>
        </div>
        <button class="btn btn-accent" onclick="window.openHousingBookingModal()">+ Booking Housing</button>
      </div>

      <div class="housing-room-card">
        <div><div class="stat-label">Room</div><strong>${escapeHtml(settings.roomName || "BKK DROP Housing Room")}</strong></div>
        <div><div class="stat-label">Location</div><strong>${escapeHtml(settings.location || "Bangkok")}</strong></div>
        <div><div class="stat-label">Room Available</div><strong>1</strong></div>
        <div><div class="stat-label">Status</div><strong>${settings.status === "closed" ? "Closed" : "Open"}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>My Housing Bookings</h2>
      <div class="housing-booking-list" style="margin-top: 14px;">
        ${myBookings.length ? myBookings.map((booking) => `
          <div class="housing-booking-row">
            <div>
              <strong>${escapeHtml(booking.checkIn)} → ${escapeHtml(booking.checkOut)}</strong>
              <div class="muted small">Guests: ${escapeHtml(booking.guests || 1)} • Purpose: ${escapeHtml(booking.purpose || "-")}</div>
              ${booking.notes ? `<div class="shipment-note">${escapeHtml(booking.notes)}</div>` : ""}
            </div>
            <div class="housing-status-stack">
              <span class="pill ${booking.status === "approved" ? "approved" : "pending"}">${escapeHtml(booking.status || "pending")}</span>
            </div>
          </div>
        `).join("") : `<div class="empty">Belum ada booking housing. Klik “+ Booking Housing”.</div>`}
      </div>
    </div>
  `;
}

function renderAdminHousingPanel() {
  const settings = getHousingSettings();
  const bookings = idToArray(db.housingBookings || {}).sort((a, b) => String(a.checkIn || "").localeCompare(String(b.checkIn || "")));

  $("adminPanel").innerHTML = `
    <div class="card housing-hero">
      <div class="card-row">
        <div>
          <h2>Housing Management</h2>
          <p class="muted">BKK DROP menyediakan housing 1 room. Admin mengatur status room dan approve/reject booking customer.</p>
        </div>
        <div class="housing-admin-actions">
          <button class="btn btn-blue" onclick="window.openEditHousingSettingsModal()">Housing Settings</button>
          <button class="btn btn-soft" onclick="window.exportHousingBookingsCSV()">Export</button>
        </div>
      </div>

      <div class="housing-room-card">
        <div><div class="stat-label">Room</div><strong>${escapeHtml(settings.roomName || "BKK DROP Housing Room")}</strong></div>
        <div><div class="stat-label">Location</div><strong>${escapeHtml(settings.location || "Bangkok")}</strong></div>
        <div><div class="stat-label">Room Available</div><strong>1</strong></div>
        <div><div class="stat-label">Status</div><strong>${settings.status === "closed" ? "Closed" : "Open"}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Housing Booking Requests</h2>
      <div class="housing-booking-list" style="margin-top: 14px;">
        ${bookings.length ? bookings.map((booking) => {
          const conflicts = getHousingConflicts(booking.checkIn, booking.checkOut, booking.id);
          const user = db.users?.[booking.userId] || {};
          return `
            <div class="housing-booking-row">
              <div>
                <strong>${escapeHtml(booking.checkIn)} → ${escapeHtml(booking.checkOut)}</strong>
                <div class="muted small">${escapeHtml(booking.customerName || user.name || "-")} • Guests: ${escapeHtml(booking.guests || 1)} • Purpose: ${escapeHtml(booking.purpose || "-")}</div>
                ${conflicts.length ? `<div class="conflict-warning">Potential conflict: ${conflicts.length} overlapping request/booking</div>` : ""}
                ${booking.notes ? `<div class="shipment-note">${escapeHtml(booking.notes)}</div>` : ""}
              </div>
              <div class="housing-admin-booking-actions">
                <span class="pill ${booking.status === "approved" ? "approved" : "pending"}">${escapeHtml(booking.status || "pending")}</span>
                <button class="btn btn-green" onclick="window.updateHousingBookingStatus('${booking.id}', 'approved')">Approve</button>
                <button class="btn btn-danger" onclick="window.updateHousingBookingStatus('${booking.id}', 'rejected')">Reject</button>
                <button class="btn btn-danger soft-danger" onclick="window.deleteHousingBooking('${booking.id}')">Delete</button>
              </div>
            </div>
          `;
        }).join("") : `<div class="empty">Belum ada request booking housing.</div>`}
      </div>
    </div>
  `;
}


function renderCustomerBillingPanel() {
  const invoices = getMyInvoices().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  $("customerPanel").innerHTML = `
    <div class="card billing-hero">
      <div>
        <h2>Billing / Invoice</h2>
        <p class="muted">Lihat tagihan BKK DROP kamu, upload bukti bayar, dan pantau status pembayaran.</p>
      </div>
    </div>

    <div class="invoice-list">
      ${invoices.length ? invoices.map((invoice) => `
        <div class="invoice-card">
          <div>
            <div class="invoice-number">${escapeHtml(invoice.invoiceNumber || "-")}</div>
            <div class="muted small">Due: ${escapeHtml(invoice.dueDate || "-")} • Status: ${escapeHtml(getInvoiceStatusLabel(invoice.status))}</div>
          </div>
          <div class="invoice-card-total">${escapeHtml(formatCurrency(calculateInvoiceTotal(invoice), invoice.currency))}</div>
          <button class="btn btn-blue" onclick="window.openInvoiceDetailModal('${invoice.id}')">View / Pay</button>
        </div>
      `).join("") : `<div class="empty">Belum ada invoice untuk akun kamu.</div>`}
    </div>
  `;
}

function renderAdminBillingPanel() {
  const invoices = idToArray(db.invoices || {}).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const totalUnpaid = invoices
    .filter((invoice) => ["sent", "payment_submitted"].includes(invoice.status))
    .reduce((sum, invoice) => sum + calculateInvoiceTotal(invoice), 0);
  const paidCount = invoices.filter((invoice) => invoice.status === "paid").length;

  $("adminPanel").innerHTML = `
    <div class="card billing-hero">
      <div class="card-row">
        <div>
          <h2>Billing / Invoice</h2>
          <p class="muted">Buat invoice customer, cek bukti bayar, dan update status pembayaran.</p>
        </div>
        <div class="billing-actions">
          <button class="btn btn-accent" onclick="window.openCreateInvoiceModal()">+ Create Invoice</button>
          <button class="btn btn-soft" onclick="window.exportInvoicesCSV()">Export</button>
        </div>
      </div>

      <div class="billing-summary">
        <div><span>Total Invoice</span><strong>${invoices.length}</strong></div>
        <div><span>Paid</span><strong>${paidCount}</strong></div>
        <div><span>Outstanding</span><strong>${formatCurrency(totalUnpaid, "THB")}</strong></div>
      </div>
    </div>

    <div class="invoice-list">
      ${invoices.length ? invoices.map((invoice) => `
        <div class="invoice-card admin-invoice-card">
          <div>
            <div class="invoice-number">${escapeHtml(invoice.invoiceNumber || "-")}</div>
            <div class="muted small">${escapeHtml(invoice.customerName || "-")} • Due: ${escapeHtml(invoice.dueDate || "-")}</div>
            <span class="pill ${invoice.status === "paid" ? "approved" : "pending"}">${escapeHtml(getInvoiceStatusLabel(invoice.status))}</span>
          </div>
          <div class="invoice-card-total">${escapeHtml(formatCurrency(calculateInvoiceTotal(invoice), invoice.currency))}</div>
          <button class="btn btn-blue" onclick="window.openInvoiceDetailModal('${invoice.id}')">Manage</button>
        </div>
      `).join("") : `<div class="empty">Belum ada invoice. Klik “+ Create Invoice”.</div>`}
    </div>
  `;
}

function renderAdminPanel() {
  const users = idToArray(db.users);
  const slots = idToArray(db.slots);
  const bookings = idToArray(db.bookings);
  const items = idToArray(db.items);

  $("adminPanel").innerHTML = `
    <div class="card">
      <div class="card-row">
        <div><h2>Booking Slot</h2><p class="muted">Approve atau reject permintaan slot customer.</p></div>
        <button class="btn btn-accent" onclick="window.openCreateSlotModal()">+ Slot Baru</button>
      </div>
      <div class="table-wrap" style="margin-top: 14px;">
        <table>
          <thead><tr><th>Customer</th><th>Slot</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${bookings.map((b) => `
              <tr>
                <td>${escapeHtml(db.users[b.userId]?.name || "-")}</td>
                <td>${escapeHtml(db.slots[b.slotId]?.title || "-")}</td>
                <td><span class="pill ${b.status}">${escapeHtml(bookingLabels[b.status] || b.status)}</span></td>
                <td>
                  <button class="btn btn-green" onclick="window.updateBookingStatus('${b.id}', 'approved')">Approve</button>
                  <button class="btn btn-danger" onclick="window.updateBookingStatus('${b.id}', 'rejected')">Reject</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="4">Belum ada booking.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-row">
        <div><h2>Warehouse Items</h2><p class="muted">Pantau semua barang dari semua customer.</p></div>
        <button class="btn btn-blue" onclick="window.exportAllItems()">Export Semua</button>
      </div>
      <div class="table-wrap" style="margin-top: 14px;">
        <table>
          <thead><tr><th>Customer</th><th>Barang</th><th>Qty</th><th>Status</th><th>Resi</th><th>Foto</th><th>Verifikasi</th><th>Manage</th></tr></thead>
          <tbody>
            ${items.map((item) => `
              <tr>
                <td>${escapeHtml(db.users[item.userId]?.name || "-")}</td>
                <td>${escapeHtml(item.itemName)}</td>
                <td>${escapeHtml(item.quantity || 0)}</td>
                <td>${escapeHtml(statusLabels[item.status] || item.status)}</td>
                <td>
                  <div class="admin-photo-cell">
                    ${Object.values(item.resiImages || {})[0]?.url ? `<img src="${escapeHtml(Object.values(item.resiImages || {})[0].url)}" alt="resi" />` : `<span class="no-photo-dot">No foto</span>`}
                    <span>${item.nomorResi ? escapeHtml(item.nomorResi) : `${Object.keys(item.resiImages || {}).length} foto`}</span>
                  </div>
                </td>
                <td>
                  <div class="admin-photo-cell">
                    ${Object.values(item.images || {})[0]?.url ? `<img src="${escapeHtml(Object.values(item.images || {})[0].url)}" alt="photo" />` : `<span class="no-photo-dot">No photo</span>`}
                    <span>${Object.keys(item.images || {}).length} foto</span>
                  </div>
                </td>
                <td>
                  <div class="verify-cell">
                    ${item.photoVerificationStatus === "verified" ? `<span class="pill verified-pill">Verified</span>` : `<span class="pill pending-photo-pill">Pending</span>`}
                    <button class="btn btn-blue" onclick="window.openAdminPhotoReview('${item.id}')">Review</button>
                  </div>
                </td>
                <td>
                  <div class="admin-stock-actions">
                    <button class="btn btn-soft" onclick="window.openEditItemModal('${item.id}')">Edit</button>
                    <button class="btn btn-danger" onclick="window.deleteItem('${item.id}')">Delete</button>
                  </div>
                  <select onchange="window.updateItemStatus('${item.id}', this.value)">
                    ${Object.entries(statusLabels).map(([value, label]) => `
                      <option value="${value}" ${item.status === value ? "selected" : ""}>${label}</option>
                    `).join("")}
                  </select>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="8">Belum ada barang.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-row">
          <div><h2>Customer Accounts</h2><p class="muted">Dummy account untuk customer.</p></div>
          <button class="btn btn-accent" onclick="window.openCreateUserModal()">+ Akun</button>
        </div>
        <div class="grid" style="margin-top: 14px;">
          ${users.map((user) => `
            <div class="user-card">
              <div class="card-row"><strong>${escapeHtml(user.name)}</strong><span class="pill ${user.role}">${escapeHtml(user.role)}</span></div>
              <div class="muted small">Username: ${escapeHtml(user.username)} • WA: ${escapeHtml(user.whatsapp || "-")}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <h2>Slots</h2>
        <p class="muted">Daftar slot warehouse aktif dan nonaktif.</p>
        <div class="grid" style="margin-top: 14px;">
          ${slots.map((slot) => renderSlotCard(slot, [])).join("") || `<div class="empty">Belum ada slot.</div>`}
        </div>
      </div>
    </div>
  `;
}

function openAddItemModal() {
  const approvedSlotIds = getApprovedSlotIds(currentUser.id);
  const slotOptions = approvedSlotIds.map((slotId) => {
    const slot = db.slots[slotId];
    if (!slot) return "";
    const usedWeight = getSlotUsedWeight(slotId);
    const maxWeight = Number(slot.maxWeightKg || slot.maxCustomers || 0);
    const remaining = Math.max(0, maxWeight - usedWeight);
    return `<option value="${slotId}">${escapeHtml(slot.title)} — sisa ${formatWeight(remaining)} kg</option>`;
  }).join("");

  if (!approvedSlotIds.length) {
    toast("Kamu perlu memiliki slot yang sudah disetujui admin dulu.");
    return;
  }

  showModal("Tambah Barang", `
    <div class="grid grid-2">
      <div class="field"><label>Nama Barang</label><input id="itemName" placeholder="Contoh: Mistine Sunscreen" /></div>
      <div class="field"><label>Slot</label><select id="itemSlot">${slotOptions}</select></div>
      <div class="field"><label>Kategori</label><input id="itemCategory" placeholder="Skincare, snack, fashion..." /></div>
      <div class="field"><label>Jumlah</label><input id="itemQuantity" type="number" min="1" value="1" /></div>
      <div class="field"><label>Estimasi Berat (kg)</label><input id="itemPrice" type="number" min="0" step="0.01" value="0" /></div>
      <div class="field"><label>Link Produk</label><input id="itemLink" placeholder="https://..." /></div>
      <div class="field"><label>Nomor Resi</label><input id="itemNomorResi" placeholder="Contoh: SPXTH123456789 / Flash / DHL..." /></div>
      <div class="field">
        <label>Upload Foto Barang</label>
        <div class="resi-upload-field">
          <input id="itemResiPhoto" type="file" accept="image/*" />
          <p class="muted small">Upload foto barang sebagai referensi agar admin bisa mengenali barang saat masuk warehouse.</p>
        </div>
      </div>
    </div>
    <div class="field"><label>Catatan</label><textarea id="itemNotes" placeholder="Warna, ukuran, catatan khusus..."></textarea></div>
    <button class="btn btn-accent btn-full" onclick="window.addItemFromForm()">Simpan Barang</button>
  `);
}

function openCreateUserModal() {
  showModal("Buat Akun Customer", `
    <div class="grid grid-2">
      <div class="field"><label>Nama</label><input id="newUserName" placeholder="Nama customer" /></div>
      <div class="field"><label>WhatsApp</label><input id="newWhatsapp" placeholder="08xxxx" /></div>
      <div class="field"><label>Username</label><input id="newUsername" placeholder="username" /></div>
      <div class="field"><label>Password</label><input id="newPassword" placeholder="password" /></div>
      <div class="field"><label>Role</label><select id="newRole"><option value="customer">Customer</option><option value="admin">Admin</option></select></div>
    </div>
    <button class="btn btn-accent btn-full" onclick="window.createUserFromForm()">Buat Akun</button>
  `);
}

function openCreateSlotModal() {
  showModal("Buat Slot Baru", `
    <div class="field"><label>Judul Slot</label><input id="newSlotTitle" placeholder="Warehouse Slot June 2026" /></div>
    <div class="field"><label>Deskripsi</label><textarea id="newSlotDesc" placeholder="Detail slot..."></textarea></div>
    <div class="grid grid-3">
      <div class="field"><label>Max Weight (kg)</label><input id="newSlotMaxWeight" type="number" min="0.01" step="0.01" value="20" /></div>
      <div class="field"><label>Max Item</label><input id="newSlotMaxItems" type="number" min="1" value="200" /></div>
      <div class="field"><label>Status</label><select id="newSlotStatus"><option value="open">Open</option><option value="closed">Closed</option></select></div>
    </div>
    <p class="muted small">Max Weight adalah total berat barang yang bisa diamankan dalam slot ini. Berat dihitung dari Estimasi Berat setiap item customer.</p>
    <button class="btn btn-accent btn-full" onclick="window.createSlotFromForm()">Buat Slot</button>
  `);
}

async function start() {
  try {
    if (isFirebaseConfigPlaceholder()) {
      setConnectionStatus("error", "config.js masih placeholder. Paste Firebase config dulu.");
      return;
    }

    app = initializeApp(firebaseConfig);
    database = getDatabase(app);

    await seedDemoDataIfEmpty();

    onValue(
      ref(database),
      (snapshot) => {
        dbLoaded = true;
        dbError = null;

        db = snapshot.val() || {};
        db.users = db.users || {};
        db.slots = db.slots || {};
        db.bookings = db.bookings || {};
        db.items = db.items || {};
        db.shipments = db.shipments || {};
        db.shipmentItems = db.shipmentItems || {};
        db.housingBookings = db.housingBookings || {};
        db.housing = db.housing || {};
        db.invoices = db.invoices || {};

        const userCount = Object.keys(db.users).length;
        setConnectionStatus("success", `Firebase connected. Users loaded: ${userCount}`);

        if (!currentUser) restoreSession();
        if (currentUser && db.users[currentUser.id]) {
          currentUser = { id: currentUser.id, ...db.users[currentUser.id] };
          renderApp();
        }
      },
      (error) => {
        dbLoaded = false;
        dbError = error.message || "Database permission denied";
        console.error("Firebase read error:", error);
        setConnectionStatus("error", "Firebase read failed: " + dbError);
      }
    );
  } catch (error) {
    console.error(error);
    setConnectionStatus("error", "Firebase init failed. Check config.js and Realtime Database.");
  }
}

window.exportHousingBookingsCSV = exportHousingBookingsCSV;
window.deleteHousingBooking = deleteHousingBooking;
window.updateHousingBookingStatus = updateHousingBookingStatus;
window.saveHousingSettings = saveHousingSettings;
window.openEditHousingSettingsModal = openEditHousingSettingsModal;
window.createHousingBooking = createHousingBooking;
window.openHousingBookingModal = openHousingBookingModal;
window.exportInvoicesCSV = exportInvoicesCSV;
window.deleteInvoice = deleteInvoice;
window.deleteInvoicePaymentProof = deleteInvoicePaymentProof;
window.updateInvoiceStatus = updateInvoiceStatus;
window.handleInvoicePaymentProofUpload = handleInvoicePaymentProofUpload;
window.openInvoiceDetailModal = openInvoiceDetailModal;
window.createInvoiceFromForm = createInvoiceFromForm;
window.addInvoiceLineInput = addInvoiceLineInput;
window.openCreateInvoiceModal = openCreateInvoiceModal;
window.setCustomerPage = setCustomerPage;
window.setAdminPage = setAdminPage;
window.openCustomerKirimRequestModal = openCustomerKirimRequestModal;
window.toggleCustomerShipmentSourceForm = toggleCustomerShipmentSourceForm;
window.addCustomerShipmentRequest = addCustomerShipmentRequest;
window.updateShipmentItemRequestStatus = updateShipmentItemRequestStatus;
window.openCreateShipmentModal = openCreateShipmentModal;
window.createShipmentFromForm = createShipmentFromForm;
window.openEditShipmentModal = openEditShipmentModal;
window.updateShipmentFromForm = updateShipmentFromForm;
window.openAddShipmentItemModal = openAddShipmentItemModal;
window.toggleShipmentSourceForm = toggleShipmentSourceForm;
window.addItemToShipment = addItemToShipment;
window.deleteShipmentItem = deleteShipmentItem;
window.exportShipmentCSV = exportShipmentCSV;
window.requestSlot = requestSlot;
window.handleImageUpload = handleImageUpload;
window.deleteResiRecord = deleteResiRecord;
window.deleteImageRecord = deleteImageRecord;
window.openEditItemModal = openEditItemModal;
window.saveEditedItem = saveEditedItem;
window.deleteItem = deleteItem;
window.addItemFromForm = addItemFromForm;
window.openCreateUserModal = openCreateUserModal;
window.openCreateSlotModal = openCreateSlotModal;
window.createUserFromForm = createUserFromForm;
window.createSlotFromForm = createSlotFromForm;
window.updateBookingStatus = updateBookingStatus;
window.updateItemStatus = updateItemStatus;
window.triggerAdminReceivedPhotoUpload = triggerAdminReceivedPhotoUpload;
window.verifyItemPhoto = verifyItemPhoto;
window.unverifyItemPhoto = unverifyItemPhoto;
window.openAdminPhotoReview = openAdminPhotoReview;
window.exportAllItems = () => exportItemsToCSV(idToArray(db.items), "bkk-drop-all-items.csv");
window.scrollToSlotList = () => document.getElementById("slotListCard")?.scrollIntoView({ behavior: "smooth" });

$("loginBtn").addEventListener("click", login);
$("logoutBtn").addEventListener("click", logout);
$("modalCloseBtn").addEventListener("click", closeModal);
$("modalBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "modalBackdrop") closeModal();
});
$("addItemBtn").addEventListener("click", openAddItemModal);
$("exportMyItemsBtn").addEventListener("click", () => {
  if (!currentUser) return;
  const items = currentView === "admin"
    ? idToArray(db.items)
    : idToArray(db.items).filter((item) => item.userId === currentUser.id);
  exportItemsToCSV(items, currentView === "admin" ? "bkk-drop-all-items.csv" : "bkk-drop-my-items.csv");
});
$("customerViewBtn").addEventListener("click", () => {
  currentView = "customer";
  customerPage = "warehouse";
  renderApp();
});
$("adminViewBtn").addEventListener("click", () => {
  currentView = "admin";
  adminPage = "warehouse";
  renderApp();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !$("loginSection").classList.contains("hidden")) login();
  if (e.key === "Escape") closeModal();
});

start();
