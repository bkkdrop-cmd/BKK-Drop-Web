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
let inventorySearch = "";
let inventoryStatusFilter = "all";
let dbLoaded = false;
let dbError = null;

let db = {
  users: {},
  slots: {},
  bookings: {},
  items: {}
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
      maxCustomers: 20,
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

async function addItemFromForm() {
  const itemName = $("itemName").value.trim();
  const slotId = $("itemSlot").value;
  const category = $("itemCategory").value.trim();
  const quantity = Number($("itemQuantity").value || 1);
  const estimatedPrice = Number($("itemPrice").value || 0);
  const productLink = $("itemLink").value.trim();
  const notes = $("itemNotes").value.trim();

  if (!itemName || !slotId) {
    toast("Nama barang dan slot wajib diisi.");
    return;
  }

  const itemRef = push(ref(database, "items"));
  await set(itemRef, {
    userId: currentUser.id,
    slotId,
    itemName,
    category,
    quantity,
    estimatedPrice,
    productLink,
    notes,
    status: "waiting_to_arrive",
    images: {},
    createdAt: new Date().toISOString()
  });

  closeModal();
  toast("Barang berhasil ditambahkan.");
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
  const maxCustomers = Number($("newSlotMaxCustomers").value || 0);
  const maxItems = Number($("newSlotMaxItems").value || 0);
  const status = $("newSlotStatus").value;

  if (!title || !maxCustomers) {
    toast("Judul slot dan kuota customer wajib diisi.");
    return;
  }

  const slotRef = push(ref(database, "slots"));
  await set(slotRef, {
    title, description, maxCustomers, maxItems, status,
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

function getSlotUsedCustomers(slotId) {
  return idToArray(db.bookings).filter((b) => b.slotId === slotId && b.status === "approved").length;
}

function renderApp() {
  if (!currentUser) return;

  $("loginSection").classList.add("hidden");
  $("dashboardSection").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("customerViewBtn").classList.toggle("hidden", currentUser.role !== "admin");
  $("adminViewBtn").classList.toggle("hidden", currentUser.role !== "admin");
  $("addItemBtn").classList.toggle("hidden", currentView === "admin");
  $("exportMyItemsBtn").textContent = currentView === "admin" ? "Export Semua Data" : "Export Data";

  $("dashboardTitle").textContent = currentView === "admin" ? "Admin Panel" : `Halo, ${currentUser.name}`;
  $("dashboardSubtitle").textContent = currentView === "admin"
    ? "Kelola customer, slot, booking, dan warehouse BKK DROP."
    : "Amankan slot, tambah barang, upload foto, dan pantau status warehouse.";

  renderStats();
  renderTabs();

  if (currentView === "admin") {
    $("adminPanel").classList.remove("hidden");
    $("customerPanel").classList.add("hidden");
    renderAdminPanel();
  } else {
    $("customerPanel").classList.remove("hidden");
    $("adminPanel").classList.add("hidden");
    renderCustomerPanel();
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
  if (currentView === "admin") {
    $("tabs").innerHTML = `
      <button class="tab active">Overview Admin</button>
      <button class="tab" onclick="window.openCreateUserModal()">+ Akun Customer</button>
      <button class="tab" onclick="window.openCreateSlotModal()">+ Slot Baru</button>
    `;
  } else {
    $("tabs").innerHTML = `
      <button class="tab active">Gudang Saya</button>
      <button class="tab" onclick="window.scrollToSlotList()">Slot Tersedia</button>
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
  const totalValue = allMyItems.reduce((sum, item) => sum + Number(item.estimatedPrice || 0), 0);
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
          <div><strong>${totalValue}</strong><span>THB</span></div>
          <div><strong>${totalPhotos}</strong><span>Foto</span></div>
        </div>
      </div>

      <div class="inventory-toolbar">
        <div class="field toolbar-field">
          <label>Cari Barang</label>
          <input id="inventorySearchInput" value="${escapeHtml(inventorySearch)}" placeholder="Cari nama, kategori, catatan..." />
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
  const usedCustomers = getSlotUsedCustomers(slot.id);
  const percent = slot.maxCustomers ? Math.min(100, Math.round((usedCustomers / slot.maxCustomers) * 100)) : 0;
  const existing = myBookings.find((b) => b.slotId === slot.id && b.status !== "cancelled");
  const isFull = usedCustomers >= Number(slot.maxCustomers || 0);
  const isOpen = slot.status === "open" && !isFull;

  return `
    <div class="slot-card">
      <div class="card-row">
        <strong>${escapeHtml(slot.title)}</strong>
        <span class="pill ${isOpen ? "open" : "closed"}">${isOpen ? "Dibuka" : "Penuh/Tutup"}</span>
      </div>
      <div class="muted">${escapeHtml(slot.description || "")}</div>
      <div>
        <div class="card-row small"><strong>Kuota Customer</strong><span>${usedCustomers}/${slot.maxCustomers || 0}</span></div>
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
          <div><span>Estimasi Berat</span><strong>${escapeHtml(item.estimatedPrice || 0)} kg</strong></div>
          <div><span>Foto</span><strong>${images.length}/8</strong></div>
        </div>

        ${item.notes ? `<div class="inventory-note">${escapeHtml(item.notes)}</div>` : ""}
        ${item.productLink ? `<a class="inventory-link" href="${escapeHtml(item.productLink)}" target="_blank">Buka link produk</a>` : ""}

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
          <thead><tr><th>Customer</th><th>Barang</th><th>Qty</th><th>Status</th><th>Foto</th><th>Verifikasi</th><th>Update</th></tr></thead>
          <tbody>
            ${items.map((item) => `
              <tr>
                <td>${escapeHtml(db.users[item.userId]?.name || "-")}</td>
                <td>${escapeHtml(item.itemName)}</td>
                <td>${escapeHtml(item.quantity || 0)}</td>
                <td>${escapeHtml(statusLabels[item.status] || item.status)}</td>
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
                  <select onchange="window.updateItemStatus('${item.id}', this.value)">
                    ${Object.entries(statusLabels).map(([value, label]) => `
                      <option value="${value}" ${item.status === value ? "selected" : ""}>${label}</option>
                    `).join("")}
                  </select>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="7">Belum ada barang.</td></tr>`}
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
    return `<option value="${slotId}">${escapeHtml(slot.title)}</option>`;
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
      <div class="field"><label>Estimasi Berat (THB)</label><input id="itemPrice" type="number" min="0" step="0.01" value="0" /></div>
      <div class="field"><label>Link Produk</label><input id="itemLink" placeholder="https://..." /></div>
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
      <div class="field"><label>Max Customer</label><input id="newSlotMaxCustomers" type="number" min="1" value="20" /></div>
      <div class="field"><label>Max Item</label><input id="newSlotMaxItems" type="number" min="1" value="200" /></div>
      <div class="field"><label>Status</label><select id="newSlotStatus"><option value="open">Open</option><option value="closed">Closed</option></select></div>
    </div>
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

window.requestSlot = requestSlot;
window.handleImageUpload = handleImageUpload;
window.deleteImageRecord = deleteImageRecord;
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
  renderApp();
});
$("adminViewBtn").addEventListener("click", () => {
  currentView = "admin";
  renderApp();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !$("loginSection").classList.contains("hidden")) login();
  if (e.key === "Escape") closeModal();
});

start();
