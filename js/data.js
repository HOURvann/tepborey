/* ════════════════════════════════════════════
   js/data.js  —  Tepborey Firestore Layer v10
   ════════════════════════════════════════════

   Member document structure:
   {
     name        : string
     village     : string
     monkCount   : number   ← ចំនួនព្រះសង្ឃ (replaces phone)
     status      : "pending" | "ready" | "partial" | "picked"
                   pending  = ចុះឈ្មោះ, រង់ចាំ
                   ready    = បានលេខ, ត្រៀម
                   partial  = ចាប់ 1+ ហើយ ប៉ុន្តែមិនទាន់គ្រប់
                   picked   = ចាប់ FULL គ្រប់អង្គហើយ
     picksDone   : number   ← ចំនួនចាប់ហើយ (0 … monkCount)
     picks       : Array<{monkPhone, pickedAt}> ← history
     queueNumber : number | null
     date        : string
     timestamp   : Timestamp
     qrVerified      : bool (for QR scan lock)
     qrVerifiedAt    : Timestamp
     qrVerifiedDevice: string
   }
════════════════════════════════════════════ */

const DB = {

  /* ─────────────────────────────────────────
     1. MEMBERS
  ───────────────────────────────────────── */
  async getMembers() {
    const snap = await db.collection("members").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  listenToMembers(callback) {
    return db.collection("members")
      .orderBy("timestamp", "desc")
      .onSnapshot(snap => {
        callback(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
  },

  /**
   * addMember — monkCount replaces phone
   * @param {string} name
   * @param {string} village
   * @param {number} monkCount  — ចំនួនព្រះសង្ឃ (1, 2, 3 …)
   */
  async addMember(name, village, monkCount) {
    return await db.collection("members").add({
      name,
      village,
      monkCount : parseInt(monkCount) || 1,
      status    : "pending",
      picksDone : 0,
      picks     : [],           // [{monkPhone, pickedAt}]
      queueNumber: null,
      date      : new Date().toISOString().slice(0, 10),
      timestamp : firebase.firestore.FieldValue.serverTimestamp(),
      qrVerified      : false,
      qrVerifiedAt    : null,
      qrVerifiedDevice: null,
    });
  },

  /**
   * generateMemberNumbers — batch assign queueNumber to pending members
   * Sorted by timestamp ascending (first registered = smallest number)
   */
  async generateMemberNumbers() {
    const snap = await db.collection("members")
      .where("status", "==", "pending")
      .get();

    if (snap.empty) return 0;

    // Client-side sort by timestamp
    const docs = snap.docs.sort((a, b) => {
      const tA = a.data().timestamp?.toMillis?.() || 0;
      const tB = b.data().timestamp?.toMillis?.() || 0;
      return tA - tB;
    });

    const batch = db.batch();
    let count = 1;
    docs.forEach(doc => {
      batch.update(db.collection("members").doc(doc.id), {
        queueNumber: count++,
        status     : "ready",
      });
    });
    await batch.commit();
    await this.toggleLock(true);
    return count - 1;
  },

  /* ─────────────────────────────────────────
     2. MONK PICK — multi-pick support
     ─────────────────────────────────────────
     Picks from status="ready" OR status="partial"
     (partial = needs more monks but already has 1+)

     After pick:
       picksDone += 1
       picks.push({monkPhone, pickedAt})
       if picksDone >= monkCount → status = "picked"  (full)
       else                      → status = "partial" (needs more)
  ───────────────────────────────────────── */
  async monkPick(monkPhone) {
    // Query ready first, then partial
    const snapReady = await db.collection("members")
      .where("status", "==", "ready")
      .get();

    const snapPartial = await db.collection("members")
      .where("status", "==", "partial")
      .get();

    const allDocs = [...snapReady.docs, ...snapPartial.docs];
    if (!allDocs.length) return null;

    // Pick random
    const picked = allDocs[Math.floor(Math.random() * allDocs.length)];
    const data   = picked.data();
    const ref    = db.collection("members").doc(picked.id);

    const newPicksDone = (data.picksDone || 0) + 1;
    const monkCount    = data.monkCount || 1;
    const newStatus    = newPicksDone >= monkCount ? "picked" : "partial";

    const pickEntry = {
      monkPhone,
      pickedAt: new Date().toISOString(),
    };

    await ref.update({
      picksDone: newPicksDone,
      picks    : firebase.firestore.FieldValue.arrayUnion(pickEntry),
      status   : newStatus,
    });

    // Return fresh data
    const fresh = await ref.get();
    return { id: picked.id, ...fresh.data() };
  },

  /* ─────────────────────────────────────────
     3. QR TOKEN SYSTEM
  ───────────────────────────────────────── */
  TOKEN_VALID_MS: 8000,

  async publishQRToken(token) {
    return await db.collection("system").doc("qrToken").set({
      token,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async validateQRToken(token) {
    if (!token) return false;
    const doc = await db.collection("system").doc("qrToken").get();
    if (!doc.exists) return false;
    const data = doc.data();
    if (data.token !== token) return false;
    const createdAt = data.createdAt?.toDate?.();
    if (!createdAt) return false;
    return (Date.now() - createdAt.getTime()) <= this.TOKEN_VALID_MS;
  },

  /* ─────────────────────────────────────────
     4. DEVICE SESSION
  ───────────────────────────────────────── */
  getDeviceId() {
    let id = localStorage.getItem("tepborey_device_id");
    if (!id) {
      id = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("tepborey_device_id", id);
    }
    return id;
  },

  async getDeviceSession() {
    const deviceId = this.getDeviceId();
    const cached = localStorage.getItem("tepborey_session");
    if (cached) { try { return JSON.parse(cached); } catch (_) {} }
    const doc = await db.collection("sessions").doc(deviceId).get();
    if (doc.exists) {
      const data = doc.data();
      localStorage.setItem("tepborey_session", JSON.stringify(data));
      return data;
    }
    return null;
  },

  async saveDeviceSession(sessionData) {
    const deviceId = this.getDeviceId();
    await db.collection("sessions").doc(deviceId).set({
      ...sessionData,
      savedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    localStorage.setItem("tepborey_session", JSON.stringify({
      ...sessionData, savedAt: new Date().toISOString()
    }));
  },

  async clearDeviceSession() {
    const deviceId = this.getDeviceId();
    localStorage.removeItem("tepborey_session");
    try { await db.collection("sessions").doc(deviceId).delete(); } catch (_) {}
  },

  /* ─────────────────────────────────────────
     5. ACTIVITIES
  ───────────────────────────────────────── */
  listenToActivities(callback) {
    return db.collection("activities")
      .orderBy("date", "desc")
      .onSnapshot(snap => {
        callback(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
  },

  async addActivity(data) {
    return await db.collection("activities").add(data);
  },

  /* ─────────────────────────────────────────
     6. SETTINGS & LOCK
  ───────────────────────────────────────── */
  async saveSettings(settings) {
    return await db.collection("system").doc("settings").set(settings);
  },

  async getSettings() {
    const doc = await db.collection("system").doc("settings").get();
    return doc.exists ? doc.data() : {
      templeName: "វត្តទេពបុរី", maxDonors: 150, masterPin: "1234"
    };
  },

  async toggleLock(val) {
    return await db.collection("system").doc("lock").set({ isLocked: val });
  },

  listenToLock(callback) {
    return db.collection("system").doc("lock").onSnapshot(doc => {
      callback(doc.exists ? doc.data().isLocked : false);
    });
  },

  /* ─────────────────────────────────────────
     7. QR VERIFY — one-time scan per member
  ───────────────────────────────────────── */
  async markQRScanned(memberId) {
    const ref  = db.collection("members").doc(memberId);
    const snap = await ref.get();
    if (!snap.exists) return { notFound: true };
    const data = snap.data();

    if (data.qrVerified) {
      return {
        alreadyVerified : true,
        verifiedAt      : data.qrVerifiedAt?.toDate?.() || null,
        verifiedDevice  : data.qrVerifiedDevice || "—",
        member          : { id: memberId, ...data },
      };
    }

    const deviceId = this.getDeviceId();
    await ref.update({
      qrVerified      : true,
      qrVerifiedAt    : firebase.firestore.FieldValue.serverTimestamp(),
      qrVerifiedDevice: deviceId,
    });
    const updated = await ref.get();
    return {
      alreadyVerified : false,
      verifiedAt      : updated.data().qrVerifiedAt?.toDate?.() || new Date(),
      verifiedDevice  : deviceId,
      member          : { id: memberId, ...updated.data() },
    };
  },
};

/* ════════════════════════════════════════════
   SHARED HELPERS
════════════════════════════════════════════ */
function showToast(msg, type = "success") {
  const el = document.getElementById("globalToast");
  if (!el) return;
  const icons = { success:"fa-circle-check", danger:"fa-circle-xmark", warning:"fa-triangle-exclamation" };
  el.className = `toast align-items-center text-white border-0 show bg-${type}`;
  document.getElementById("toastIcon").className = `fa-solid ${icons[type]||icons.success} me-2`;
  document.getElementById("toastMsg").textContent = msg;
  setTimeout(() => el.classList.remove("show"), 2800);
}

function statusBadge(status) {
  const map = {
    picked : ["bg-success-subtle text-success-emphasis", "ចាប់ FULL"],
    partial: ["bg-warning-subtle text-warning-emphasis", "ចាប់មួយចំណែក"],
    ready  : ["bg-info-subtle text-info-emphasis",       "មានលេខ"],
    pending: ["bg-secondary-subtle text-secondary-emphasis","រង់ចាំ"],
  };
  const [cls, label] = map[status] || map.pending;
  return `<span class="badge rounded-pill fw-semibold px-3 py-2 ${cls}" style="font-size:11px">${label}</span>`;
}
