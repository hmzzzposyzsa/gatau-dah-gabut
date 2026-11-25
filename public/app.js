(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var root = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  // basis API: kosong = same-origin (proxy Cloudflare Pages / bot sendiri). Isi <meta name="api-base"> bila memanggil API bot langsung (butuh CORS).
  var apiBase = String((typeof document.querySelector === "function" && (document.querySelector('meta[name="api-base"]') || {}).content) || "").replace(/\/+$/, "");
  var state = { me: null, tab: "home", bc: "status", admin: null, adm: { form: {} }, drafts: ["", "", ""], dirty: [false, false, false], amount: "", dep: null, hist: null, skew: 0, depTimer: null, loading: false };

  // ---------- util
  function rp(n) { var v = Math.round(Number(n) || 0); return (v < 0 ? "-" : "") + "Rp" + Math.abs(v).toLocaleString("id-ID"); }
  function fmt(ts) { return new Date(ts).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function nowMs() { return Date.now() + state.skew; }
  function dur(ms) {
    if (ms <= 0) return "0 menit";
    var d = Math.floor(ms / 86400000), hr = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    if (d) return d + " hari " + hr + " jam";
    if (hr) return hr + " jam " + m + " menit";
    return m + " menit " + s + " dtk";
  }
  // pembuat elemen: semua teks lewat textContent (aman dari XSS)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v === false || v == null) return;
      if (k === "class") el.className = v;
      else if (k === "value") el.value = v;
      else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  var toastTimer = null;
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = "show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ""; }, 2800);
  }
  function haptic(type) { try { tg.HapticFeedback.notificationOccurred(type); } catch (e) {} }
  function confirmBox(msg) {
    return new Promise(function (resolve) { if (tg && tg.showConfirm) tg.showConfirm(msg, resolve); else resolve(window.confirm(msg)); });
  }
  function api(action, body) {
    return fetch(apiBase + "/api/app/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": tg ? tg.initData : "" },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok || !j.ok) { var e = new Error(j.error || "Terjadi kesalahan"); e.status = res.status; throw e; }
        return j;
      });
    });
  }
  // jalankan aksi sambil menonaktifkan tombol (cegah klik ganda)
  function act(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    Promise.resolve().then(fn).catch(function (e) { haptic("error"); toast(e.message, "bad"); }).then(function () { btn.disabled = false; });
  }
  function typing() { var a = document.activeElement; return a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT"); }
  function Btn(label, cls, fn) {
    var b = h("button", { class: "btn " + (cls || ""), type: "button" }, label);
    b.addEventListener("click", function () { act(b, fn); });
    return b;
  }
  function Card(cls, title) {
    var c = h("div", { class: "card " + (cls || "") });
    if (title) c.appendChild(h("h2", null, title));
    for (var i = 2; i < arguments.length; i++) add(c, arguments[i]);
    return c;
  }
  function kv(k, v) { return h("div", { class: "kv" }, h("span", null, k), h("span", null, v)); }
  function badge(text, cls) { return h("span", { class: "badge " + (cls || "") }, text); }
  function cd(end) { var s = h("b", { class: "cd" }); s.dataset.end = end; s.textContent = dur(end - nowMs()); return s; }
  function field(label, input) { return h("div", { class: "field" }, h("span", { class: "lbl" }, label), input); }
  function reload() { return load().catch(function () {}); }

  // ---------- data
  function load(silent) {
    return api("me").then(function (j) {
      state.me = j;
      state.skew = j.now - Date.now();
      var r = j.rental;
      for (var i = 0; i < 3; i++) if (!state.dirty[i]) state.drafts[i] = (r && r.texts[i]) || "";
      if (j.pending && !state.dep) {
        return api("dep.get", { orderId: j.pending.orderId }).then(function (d) { state.dep = d.deposit; watchDeposit(); }).catch(function () {});
      }
    }).then(function () { if (!(silent && typing())) render(); }).catch(function (e) {
      if (e.status === 401) fatal("Buka halaman ini lewat bot Telegram."); else if (!silent) toast(e.message, "bad");
    });
  }
  function fatal(msg) { root.textContent = ""; root.appendChild(h("div", { class: "center" }, msg)); }
  function launch(id) {
    return api("launch", { id: id }).then(function () {
      haptic("success"); toast("Dibuka di chat bot ✔", "ok");
      setTimeout(function () { try { tg.close(); } catch (e) {} }, 700);
    });
  }

  // ---------- kepala
  function topbar() {
    var m = state.me;
    return h("div", null,
      h("div", { class: "top" }, h("div", { class: "logo" }, "Jasa Sebar"), h("div", { class: "pill" }, rp(m.saldo))),
      h("div", { class: "who" }, "Halo, " + m.user.name + (m.flags.owner ? " 👑" : "")));
  }

  // ---------- BERANDA
  function toggleBtn(r) {
    return Btn(r.running ? "⏹ Stop BC" : "▶️ Mulai BC", r.running ? "p" : "g", function () {
      return api(r.running ? "bc.stop" : "bc.start").then(function () { haptic("success"); toast(r.running ? "BC dihentikan" : "BC dimulai", "ok"); return reload(); });
    });
  }
  function viewHome() {
    var m = state.me, r = m.rental, u = m.ubot;
    var wrap = h("div", null);
    wrap.appendChild(Card("y", "Saldo", h("div", { class: "big" }, rp(m.saldo)),
      h("div", { class: "btns" }, Btn("Deposit", "w", function () { go("saldo"); }), Btn("Sewa BC", "g", function () { go("bc", "sewa"); }))));
    if (r) {
      wrap.appendChild(Card("g", "Sewa BC aktif",
        h("div", { class: "row" }, h("span", { class: "lbl" }, "Sisa waktu"), badge(r.running ? "BC berjalan" : "BC berhenti", r.running ? "ok" : "warn")),
        h("div", { class: "big" }, cd(r.end)),
        h("p", { class: "muted" }, (r.plan === "premium" ? "Premium" : "Standar") + " • " + r.groups + " grup tujuan • " + r.stats.sent + " terkirim"),
        h("div", { class: "btns" }, toggleBtn(r), Btn("Detail", "w", function () { go("bc", "status"); }))));
    } else {
      wrap.appendChild(Card("", "Belum ada sewa", h("p", null, "Sewa 1 akun sebar untuk 7 hari atau 1 bulan. Promosi dikirim otomatis ke ratusan grup."), h("div", { class: "btns" }, Btn("Sewa Sekarang", "g", function () { go("bc", "sewa"); }))));
    }
    if (u && (u.hasSession || u.online)) {
      wrap.appendChild(Card("b", "Ubot Anda", h("div", { class: "row" }, h("span", { class: "lbl" }, u.paket || "Ubot"), badge(u.online ? "Online" : "Offline", u.online ? "ok" : "bad")),
        h("p", null, u.forever ? "Masa aktif: selamanya" : u.expiresAt ? "Aktif sampai " + fmt(u.expiresAt) : "Masa aktif: -"),
        h("div", { class: "btns" }, Btn("Kelola Ubot", "w", function () { go("ubot"); }))));
    } else {
      wrap.appendChild(Card("b", "Punya userbot sendiri?", h("p", null, "Buat ubot dari akun Telegram Anda: nomor, kode, lalu 2FA (dilanjutkan di chat bot)."), h("div", { class: "btns" }, Btn("Buat Ubot", "w", function () { return launch("ubot.create"); }), Btn("Menu Lainnya", "w", function () { go("menu"); }))));
    }
    if (m.flags.owner) wrap.appendChild(Card("v", "Admin", h("p", null, "Kelola akun stok, grup, sewa aktif, saldo pengguna, dan pengaturan."), h("div", { class: "btns" }, Btn("Buka Panel Admin", "w", function () { admGo("home"); }))));
    return wrap;
  }

  // ---------- BC: status / teks / sewa
  function viewStatus() {
    var m = state.me, r = m.rental, c = m.cfg;
    if (!r) return Card("", "Belum ada sewa aktif", h("p", null, "Sewa dulu untuk mulai promosi otomatis."), h("div", { class: "btns" }, Btn("Lihat Paket", "g", function () { go("bc", "sewa"); })));
    var note = [];
    if (r.pausedNoAcc) note.push(h("p", null, badge("Menunggu akun pengganti dari admin", "warn")));
    if (r.cooldownUntil) note.push(h("p", null, badge("Akun istirahat sementara (batas Telegram)", "warn")));
    return h("div", null,
      Card("g", "Sewa Aktif", h("div", { class: "lbl" }, "Sisa masa sewa"), h("div", { class: "big" }, cd(r.end)),
        h("p", { class: "muted" }, "Paket " + (r.plan === "premium" ? "Premium" : "Standar") + " • berakhir " + fmt(r.end)), note, h("div", { class: "btns" }, toggleBtn(r))),
      Card("", "Statistik",
        h("div", { class: "grid2" },
          h("div", { class: "stat" }, h("b", null, String(r.round)), "Putaran"), h("div", { class: "stat" }, h("b", null, String(r.groups)), "Grup tujuan"),
          h("div", { class: "stat" }, h("b", { class: "pos" }, String(r.stats.sent)), "Terkirim"), h("div", { class: "stat" }, h("b", { class: "neg" }, String(r.stats.fail)), "Gagal")),
        r.last ? h("p", { class: "muted" }, "Putaran terakhir #" + r.last.round + ": " + r.last.sent + " terkirim, " + r.last.fail + " gagal (" + fmt(r.last.at) + ")") : null,
        r.running && r.nextRoundAt ? h("p", { class: "muted" }, "Putaran berikutnya dalam ", cd(r.nextRoundAt)) : null,
        h("p", { class: "muted" }, "Delay " + c.delay + " dtk antar grup • jeda " + c.jeda + " menit per putaran")));
  }
  function viewTeks() {
    var m = state.me, r = m.rental, c = m.cfg;
    if (!r) return Card("", "Teks Promosi", h("p", null, "Anda perlu sewa aktif untuk mengisi teks."), h("div", { class: "btns" }, Btn("Lihat Paket", "g", function () { go("bc", "sewa"); })));
    var wrap = h("div", null, Card("y", "Teks Promosi", h("p", null, "Dikirim bergantian tiap putaran. Jika hanya 1 teks, hanya itu yang dikirim. Perubahan berlaku mulai putaran berikutnya."),
      r.plan === "standar" ? h("p", { class: "muted" }, "Paket Standar menambahkan otomatis di bawah teks: " + c.watermark) : null));
    for (var i = 0; i < c.maxTeks; i++) (function (i) {
      var counter = h("div", { class: "counter" }, state.drafts[i].length + "/" + c.maxLen);
      var ta = h("textarea", { maxlength: c.maxLen, placeholder: "Tulis teks promosi " + (i + 1) + "…", value: state.drafts[i] });
      ta.addEventListener("input", function () { state.drafts[i] = ta.value; state.dirty[i] = true; counter.textContent = ta.value.length + "/" + c.maxLen; });
      var save = Btn("Simpan", "g", function () {
        return api("txt.set", { i: i, text: ta.value }).then(function () { state.dirty[i] = false; haptic("success"); toast("Teks " + (i + 1) + " disimpan", "ok"); return reload(); });
      });
      var del = Btn("Hapus", "w", function () {
        return confirmBox("Hapus teks " + (i + 1) + "?").then(function (ok) {
          if (!ok) return;
          return api("txt.del", { i: i }).then(function () { state.dirty[i] = false; state.drafts[i] = ""; toast("Teks dihapus", "ok"); return reload(); });
        });
      });
      wrap.appendChild(Card("", "Teks " + (i + 1) + (r.texts[i] ? " ✅" : ""), ta, counter, h("div", { class: "btns" }, save, del)));
    })(i);
    return wrap;
  }
  function buy(plan, days) {
    var price = state.me.plans[plan][days];
    var label = (plan === "premium" ? "Premium" : "Standar") + " " + (days === 7 ? "7 hari" : "1 bulan");
    return confirmBox("Sewa " + label + " seharga " + rp(price) + " dari saldo?").then(function (ok) {
      if (!ok) return;
      return api("rent.buy", { plan: plan, days: days }).then(function (j) {
        haptic("success"); toast(j.isNew ? "Sewa aktif! Isi teks promosi." : "Masa sewa diperpanjang", "ok");
        return load().then(function () { go("bc", j.isNew ? "teks" : "status"); });
      });
    });
  }
  function viewSewa() {
    var m = state.me;
    var wrap = h("div", null, Card("y", "Sewa BC", kv("Saldo", rp(m.saldo)), kv("Akun tersedia", m.stok > 0 ? String(m.stok) : "Penuh"),
      m.rental ? h("p", { class: "muted" }, "Anda sudah punya sewa aktif. Pembelian menambah masa sewa.") : null));
    [["standar", "Standar", "Lebih murah. Ada watermark di bawah teks.", ""], ["premium", "Premium", "Tanpa watermark.", "prem"]].forEach(function (p) {
      wrap.appendChild(h("div", { class: "plan " + p[3] }, h("h3", null, p[1]), h("div", { class: "muted" }, p[2]),
        h("div", { class: "btns" }, Btn("7 hari — " + rp(m.plans[p[0]][7]), "w", function () { return buy(p[0], 7); }), Btn("1 bulan — " + rp(m.plans[p[0]][30]), "g", function () { return buy(p[0], 30); }))));
    });
    if (m.saldo < Math.min(m.plans.standar[7], m.plans.standar[30])) wrap.appendChild(Btn("Saldo kurang — Deposit", "p", function () { go("saldo"); }));
    return wrap;
  }
  var SUBS = [["status", "Status"], ["teks", "Teks"], ["sewa", "Sewa"]];
  function viewBC() {
    var seg = h("div", { class: "seg" });
    SUBS.forEach(function (s) { seg.appendChild(h("button", { class: state.bc === s[0] ? "on" : "", type: "button", onclick: function () { go("bc", s[0]); } }, s[1])); });
    return h("div", null, seg, state.bc === "teks" ? viewTeks() : state.bc === "sewa" ? viewSewa() : viewStatus());
  }

  // ---------- SALDO / deposit
  function stopWatch() { if (state.depTimer) { clearInterval(state.depTimer); state.depTimer = null; } }
  function depDone(status) {
    stopWatch(); state.dep = null; state.hist = null;
    var paid = status === "paid";
    toast(paid ? "Deposit diterima! 🎉" : "Tagihan " + (status === "expired" ? "kedaluwarsa" : "dibatalkan"), paid ? "ok" : "bad");
    haptic(paid ? "success" : "warning");
    return reload();
  }
  function watchDeposit() {
    stopWatch();
    state.depTimer = setInterval(function () {
      if (!state.dep) return stopWatch();
      api("dep.status", { orderId: state.dep.orderId }).then(function (j) { if (j.status !== "pending") return depDone(j.status); }).catch(function () {});
    }, 4000);
  }
  function copyText(t) { try { navigator.clipboard.writeText(String(t)).then(function () { toast("Disalin", "ok"); }); } catch (e) { toast(String(t)); } }
  function depositCard() {
    var d = state.dep;
    return Card("b", "Tagihan Deposit",
      d.qr ? h("img", { class: "qr", alt: "QRIS", src: d.qr }) : h("p", null, "Gambar QR tidak tersedia, hubungi admin."),
      h("div", { class: "lbl" }, "Bayar TEPAT (sudah termasuk kode unik)"), h("div", { class: "big" }, rp(d.finalAmount)),
      h("div", { class: "btns" }, Btn("Salin nominal", "w", function () { copyText(d.finalAmount); })),
      h("p", { class: "muted" }, "Order " + d.orderId + (d.expiresAt ? " • berlaku sampai " + fmt(d.expiresAt) : "")),
      h("div", { class: "btns" },
        Btn("🔄 Cek Status", "g", function () { return api("dep.status", { orderId: d.orderId }).then(function (j) { if (j.status === "pending") { toast("Belum ada pembayaran"); return; } return depDone(j.status); }); }),
        Btn("Batalkan", "w", function () { return confirmBox("Batalkan tagihan ini?").then(function (ok) { if (!ok) return; return api("dep.cancel", { orderId: d.orderId }).then(function () { return depDone("canceled"); }); }); })),
      h("p", { class: "muted" }, "Saldo masuk otomatis setelah pembayaran berhasil."));
  }
  function viewSaldo() {
    var m = state.me, c = m.cfg;
    var wrap = h("div", null, Card("y", "Saldo Anda", h("div", { class: "big" }, rp(m.saldo))));
    if (state.dep) wrap.appendChild(depositCard());
    else {
      var input = h("input", { type: "number", inputmode: "numeric", placeholder: "Nominal lain (min " + rp(c.minDeposit) + ")", value: state.amount });
      input.addEventListener("input", function () { state.amount = input.value; });
      var chips = h("div", { class: "chips" });
      c.presets.forEach(function (n) {
        var ch = h("div", { class: "chip" + (String(state.amount) === String(n) ? " on" : "") }, rp(n));
        ch.addEventListener("click", function () { state.amount = String(n); render(); });
        chips.appendChild(ch);
      });
      wrap.appendChild(Card("", "Deposit", c.pg ? null : h("p", null, badge("Pembayaran belum aktif", "warn")), chips, input,
        h("div", { class: "btns" }, Btn("Buat QRIS", "g", function () { return api("dep.create", { amount: Number(state.amount) }).then(function (j) { state.dep = j.deposit; haptic("success"); watchDeposit(); render(); }); }))));
    }
    var list = h("div", { class: "list" }, h("div", { class: "muted" }, "Memuat…"));
    wrap.appendChild(Card("", "Riwayat Saldo", list));
    var fill = function (items) {
      list.textContent = "";
      if (!items.length) { list.appendChild(h("div", { class: "muted" }, "Belum ada riwayat.")); return; }
      items.forEach(function (x) { list.appendChild(h("div", { class: "it" }, h("span", null, fmt(x.t) + " • " + x.type), h("span", { class: x.amount >= 0 ? "pos" : "neg" }, (x.amount >= 0 ? "+" : "") + rp(x.amount)))); });
    };
    if (state.hist) fill(state.hist); else api("hist").then(function (j) { state.hist = j.items; fill(j.items); }).catch(function () { list.textContent = "Gagal memuat riwayat."; });
    return wrap;
  }

  // ---------- UBOT
  function viewUbot() {
    var m = state.me, u = m.ubot;
    var wrap = h("div", null);
    if (u && (u.hasSession || u.online)) {
      wrap.appendChild(Card("b", "Ubot Anda", kv("Status", badge(u.online ? "Online" : "Offline", u.online ? "ok" : "bad")), kv("Paket", u.paket || "-"),
        kv("Akun", u.account ? (u.account.name || "") + (u.account.username ? " @" + u.account.username : "") : "-"),
        kv("Masa aktif", u.forever ? "Selamanya" : u.expiresAt ? fmt(u.expiresAt) : "-"),
        u.expiresAt && !u.forever ? h("p", { class: "muted" }, "Sisa ", cd(u.expiresAt)) : null,
        h("div", { class: "btns" }, Btn("Stop Ubot", "p", function () {
          return confirmBox("Hentikan userbot dan hapus sesi login dari server?").then(function (ok) { if (!ok) return; return api("ubot.stop").then(function () { haptic("success"); toast("Userbot dihentikan", "ok"); return reload(); }); });
        }))));
    } else {
      wrap.appendChild(Card("b", "Belum ada ubot", h("p", null, "Buat userbot dari akun Telegram Anda. Login (nomor, kode, 2FA) dilanjutkan di chat bot."), h("div", { class: "btns" }, Btn("Buat Ubot", "g", function () { return launch("ubot.create"); }))));
    }
    var tiles = h("div", { class: "tiles" });
    [["profil", "Profil Saya", "Data akun & paket"], ["role.beli", "Beli Role", "Pilih paket"], ["role.up", "Up Role", "Naikkan role"], ["ubot.buysc", "Beli SC", "Source code"], ["ubot.preview", "Tampilan Ubot", "Pratinjau menu"], ["panduan", "Panduan", "Cara memakai"]].forEach(function (t) {
      tiles.appendChild(tile(t[0], t[1], t[2]));
    });
    wrap.appendChild(h("div", { class: "sec lbl" }, "Fitur ubot (dibuka di chat bot)"));
    wrap.appendChild(tiles);
    return wrap;
  }
  function tile(id, label, note) {
    var b = h("button", { class: "btn tile w", type: "button" }, h("b", null, label), h("small", null, note || ""));
    b.addEventListener("click", function () { act(b, function () { return launch(id); }); });
    return b;
  }

  // ---------- MENU (semua fitur bot)
  function viewMenu() {
    var m = state.me;
    var wrap = h("div", null, Card("y", "Semua Fitur Bot", h("p", null, "Fitur di bawah dibuka di chat bot (aplikasi akan menutup otomatis). Sewa BC, Saldo, dan Ubot ada langsung di aplikasi ini.")));
    if (m.flags.owner) wrap.appendChild(Btn("Panel Admin (di aplikasi)", "v", function () { admGo("home"); }));
    var groups = [];
    m.menu.forEach(function (it) { if (groups.indexOf(it.group) < 0) groups.push(it.group); });
    groups.forEach(function (g) {
      wrap.appendChild(h("div", { class: "sec lbl" }, g));
      var tiles = h("div", { class: "tiles" });
      m.menu.filter(function (it) { return it.group === g; }).forEach(function (it) { tiles.appendChild(tile(it.id, it.label, it.note)); });
      wrap.appendChild(tiles);
    });
    return wrap;
  }

  // ---------- ADMIN
  function admGo(page) {
    state.admin = page; state.loading = true; render(); window.scrollTo(0, 0);
    admLoad(page).then(function () { state.loading = false; render(); }).catch(function (e) { state.loading = false; toast(e.message, "bad"); render(); });
  }
  function admLoad(page) {
    var A = state.adm;
    if (page === "home") return api("adm.overview").then(function (j) { A.ov = j; });
    if (page === "acc") return api("adm.acc.list").then(function (j) { A.accs = j; });
    if (page === "grp") return api("adm.groups.get").then(function (j) { A.grp = j; });
    if (page === "rent") return api("adm.rent.list").then(function (j) { A.rents = j.items; });
    if (page === "set") return api("adm.settings.get").then(function (j) { A.set = j; });
    if (page === "cmd") return api("adm.cmds").then(function (j) { A.cmds = j.sections; });
    return Promise.resolve();
  }
  function admRefresh() { return admLoad(state.admin).then(render); }
  function admBack() { if (state.admin && state.admin !== "home") admGo("home"); else { state.admin = null; render(); } }
  var STATUS_CLS = { siap: "ok", disewa: "b", pemanasan: "warn", baru: "", rusak: "bad" };
  var ADM_TITLE = { home: "Panel Admin", acc: "Akun Stok", grp: "Daftar Grup", rent: "Sewa Aktif", user: "Pengguna & Saldo", set: "Pengaturan", cmd: "Daftar Perintah", own: "Panel Owner Bot" };

  function admHome() {
    var o = state.adm.ov;
    if (!o) return Card("", "Memuat…");
    var wrap = h("div", null, Card("v", "Ringkasan",
      h("div", { class: "grid2" },
        h("div", { class: "stat" }, h("b", null, String(o.stock.siap)), "Akun siap"), h("div", { class: "stat" }, h("b", null, String(o.stock.disewa)), "Disewa"),
        h("div", { class: "stat" }, h("b", null, String(o.stock.pemanasan)), "Pemanasan"), h("div", { class: "stat" }, h("b", null, String(o.stock.rusak)), "Rusak"),
        h("div", { class: "stat" }, h("b", null, String(o.rentals)), "Sewa aktif"), h("div", { class: "stat" }, h("b", null, String(o.groups)), "Grup master")),
      kv("Deposit pending", String(o.depositsPending)), kv("Pengguna", String(o.users)), kv("PG", badge(o.pg ? "Terkonfigurasi" : "Belum diisi", o.pg ? "ok" : "bad")), kv("Cek limit", "tiap " + o.cek + " menit")));
    var tiles = h("div", { class: "tiles" });
    [["acc", "Akun Stok", "Join, siap, hapus"], ["grp", "Daftar Grup", "Unggah file txt"], ["rent", "Sewa Aktif", "Hentikan / tambah hari"], ["user", "Pengguna", "Saldo & blokir"], ["set", "Pengaturan", "Harga, delay, kata"], ["cmd", "Perintah", "Daftar command"]].forEach(function (t) {
      var b = h("button", { class: "btn tile w", type: "button" }, h("b", null, t[1]), h("small", null, t[2]));
      b.addEventListener("click", function () { admGo(t[0]); });
      tiles.appendChild(b);
    });
    wrap.appendChild(tiles);
    wrap.appendChild(h("div", { class: "sec lbl" }, "Aksi cepat"));
    wrap.appendChild(h("div", { class: "btns" },
      Btn("Tambah Akun", "g", function () { return api("adm.acc.add").then(function () { haptic("success"); toast("Lanjutkan login di chat bot", "ok"); setTimeout(function () { try { tg.close(); } catch (e) {} }, 700); }); }),
      Btn("Cek Limit", "o", function () { return api("adm.limit.run").then(function () { toast("Cek limit dimulai (hasil dikirim ke chat)", "ok"); }); }),
      Btn("Join Semua Akun", "b", function () { return api("adm.joinall").then(function (j) { toast("Join dimulai di " + j.started + " akun", "ok"); return admRefresh(); }); })));
    wrap.appendChild(h("div", { class: "btns" }, Btn("Panel Owner Bot", "v", function () { admGo("own"); })));
    return wrap;
  }
  function admAcc() {
    var d = state.adm.accs;
    if (!d) return Card("", "Memuat…");
    var wrap = h("div", null);
    if (!d.items.length) wrap.appendChild(Card("", "Belum ada akun", h("p", null, "Tambah akun lewat tombol di Panel Admin (login dilanjutkan di chat bot).")));
    d.items.forEach(function (a) {
      var op = function (name, confirmMsg) {
        return function () {
          var go1 = function () { return api("adm.acc.act", { id: a.id, op: name }).then(function () { haptic("success"); return admRefresh(); }); };
          return confirmMsg ? confirmBox(confirmMsg).then(function (ok) { if (ok) return go1(); }) : go1();
        };
      };
      wrap.appendChild(Card("", a.id + " " + (a.username ? "@" + a.username : a.name || ""),
        h("div", { class: "row" }, badge(a.status, STATUS_CLS[a.status] || ""), badge(a.joining ? "join berjalan" : "join berhenti", a.joining ? "ok" : "")),
        kv("Grup siap", a.ok + "/" + d.total), kv("Bermasalah", String(a.bad)), kv("Join hari ini", String(a.joinedToday)),
        a.rentalId ? kv("Sewa", a.rentalId) : null,
        a.lastCheck ? kv("Cek limit", a.lastCheck.status === "ok" ? "bebas ✅" : a.lastCheck.status === "limited" ? "LIMIT ⛔" : "tidak jelas") : null,
        a.cooldown ? kv("Istirahat", dur(a.cooldown - nowMs())) : null, a.dead ? kv("Catatan", a.dead) : null,
        h("div", { class: "btns" }, Btn("Mulai Join", "g", op("join")), Btn("Stop Join", "w", op("stopjoin"))),
        h("div", { class: "btns" }, Btn("Tandai Siap", "b", op("ready")), Btn("Reset Grup", "w", op("reset"))),
        h("div", { class: "btns" }, Btn("Hapus Akun", "p", op("del", "Hapus akun " + a.id + "? Sesi login dicabut dari Telegram.")))));
    });
    return wrap;
  }
  function admGrp() {
    var g = state.adm.grp;
    if (!g) return Card("", "Memuat…");
    var file = h("input", { type: "file", accept: ".txt,text/plain" });
    var up = Btn("Unggah & Ganti Daftar", "g", function () {
      var f = file.files && file.files[0];
      if (!f) throw new Error("Pilih file .txt dulu.");
      if (f.size > 280 * 1024) throw new Error("File terlalu besar (maks 280 KB).");
      return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(String(r.result)); }; r.onerror = function () { reject(new Error("Gagal membaca file")); }; r.readAsText(f); })
        .then(function (text) { return api("adm.groups.upload", { text: text }); })
        .then(function (j) { haptic("success"); toast("Tersimpan: " + j.count + " grup (duplikat " + j.dup + ", tidak valid " + j.bad + ")", "ok"); return admRefresh(); });
    });
    var sample = h("div", { class: "cmd" }, (g.sample || []).join("\n") || "(kosong)");
    return h("div", null,
      Card("v", "Daftar Grup", kv("Total", String(g.count)), kv("Username", String(g.user)), kv("Link undangan", String(g.invite))),
      Card("", "Unggah file txt", h("p", { class: "muted" }, "Satu link/username per baris. Daftar lama akan diganti. Setelah itu tekan Join Semua Akun di Panel Admin."), field("File .txt", file), h("div", { class: "btns" }, up)),
      Card("", "Contoh isi (25 teratas)", sample));
  }
  function admRent() {
    var rs = state.adm.rents;
    if (!rs) return Card("", "Memuat…");
    var wrap = h("div", null);
    if (!rs.length) wrap.appendChild(Card("", "Tidak ada sewa aktif"));
    rs.forEach(function (r) {
      var days = h("input", { type: "number", inputmode: "numeric", placeholder: "Hari", value: "" });
      wrap.appendChild(Card("", r.id + " • " + r.user,
        h("div", { class: "row" }, badge(r.plan, r.plan === "premium" ? "b" : ""), badge(r.running ? "BC berjalan" : "BC berhenti", r.running ? "ok" : "warn")),
        kv("ID pengguna", r.userId), kv("Akun", r.accountId), kv("Sisa", cd(r.end)), kv("Putaran", String(r.round)), kv("Terkirim / gagal", r.sent + " / " + r.fail), kv("Teks", String(r.texts)),
        r.pausedNoAcc ? h("p", null, badge("Menunggu akun pengganti", "warn")) : null,
        field("Tambah hari (kompensasi)", days),
        h("div", { class: "btns" }, Btn("Tambah Hari", "g", function () { return api("adm.rent.act", { id: r.id, op: "days", days: Number(days.value) }).then(function () { haptic("success"); toast("Masa sewa ditambah", "ok"); return admRefresh(); }); }),
          Btn("Hentikan Sewa", "p", function () { return confirmBox("Hentikan sewa " + r.id + " sekarang (tanpa refund)?").then(function (ok) { if (!ok) return; return api("adm.rent.act", { id: r.id, op: "end" }).then(function () { toast("Sewa dihentikan", "ok"); return admRefresh(); }); }); }))));
    });
    return wrap;
  }
  function admUser() {
    var A = state.adm, f = A.form;
    var idIn = h("input", { type: "text", inputmode: "numeric", placeholder: "ID Telegram pengguna", value: f.uid || "" });
    idIn.addEventListener("input", function () { f.uid = idIn.value.trim(); });
    var wrap = h("div", null, Card("v", "Cari Pengguna", idIn, h("div", { class: "btns" }, Btn("Cari", "g", function () { return api("adm.user.get", { id: f.uid }).then(function (j) { A.user = j; render(); }); }))));
    var u = A.user;
    if (u) {
      var amt = h("input", { type: "number", inputmode: "numeric", placeholder: "Jumlah (negatif = kurangi)", value: f.amt || "" });
      var note = h("input", { type: "text", placeholder: "Catatan (opsional)", value: f.note || "" });
      amt.addEventListener("input", function () { f.amt = amt.value; }); note.addEventListener("input", function () { f.note = note.value; });
      wrap.appendChild(Card("", u.name + " (" + u.id + ")",
        kv("Saldo", rp(u.saldo)), kv("Status", badge(u.banned ? "Diblokir" : "Normal", u.banned ? "bad" : "ok")),
        u.rental ? kv("Sewa", u.rental.id + " • " + u.rental.plan + " • sisa " + dur(u.rental.end - nowMs())) : kv("Sewa", "tidak ada"),
        field("Ubah saldo", amt), field("Catatan", note),
        h("div", { class: "btns" }, Btn("Terapkan Saldo", "g", function () { return api("adm.user.saldo", { id: u.id, amount: Number(f.amt), note: f.note || "" }).then(function (j) { f.amt = ""; haptic("success"); toast("Saldo sekarang " + rp(j.saldo), "ok"); return api("adm.user.get", { id: u.id }).then(function (x) { A.user = x; render(); }); }); }),
          Btn(u.banned ? "Buka Blokir" : "Blokir", u.banned ? "b" : "p", function () { return confirmBox((u.banned ? "Buka blokir " : "Blokir ") + u.id + "?").then(function (ok) { if (!ok) return; return api("adm.user.ban", { id: u.id, ban: !u.banned }).then(function () { return api("adm.user.get", { id: u.id }).then(function (x) { A.user = x; render(); }); }); }); }))));
      var list = h("div", { class: "list" });
      (u.ledger || []).forEach(function (x) { list.appendChild(h("div", { class: "it" }, h("span", null, fmt(x.t) + " • " + x.type), h("span", { class: x.amount >= 0 ? "pos" : "neg" }, (x.amount >= 0 ? "+" : "") + rp(x.amount)))); });
      if (!(u.ledger || []).length) list.appendChild(h("div", { class: "muted" }, "Belum ada riwayat."));
      wrap.appendChild(Card("", "Riwayat 10 terakhir", list));
    }
    return wrap;
  }
  function admSet() {
    var s = state.adm.set, A = state.adm;
    if (!s) return Card("", "Memuat…");
    var save = function (key, input, okMsg) { return function () { return api("adm.settings.set", { key: key, value: input.value }).then(function () { haptic("success"); toast(okMsg || "Tersimpan", "ok"); return admRefresh(); }); }; };
    var wrap = h("div", null);
    var hargaCard = Card("y", "Harga Sewa");
    [["standar7", "Standar 7 hari"], ["standar30", "Standar 1 bulan"], ["premium7", "Premium 7 hari"], ["premium30", "Premium 1 bulan"]].forEach(function (p) {
      var inp = h("input", { type: "number", inputmode: "numeric", value: String(s.harga[p[0]]) });
      hargaCard.appendChild(field(p[1], inp)); hargaCard.appendChild(h("div", { class: "btns" }, Btn("Simpan", "w", save("harga." + p[0], inp, "Harga disimpan"))));
    });
    wrap.appendChild(hargaCard);
    var numCard = Card("", "Delay & Batas");
    Object.keys(s.num).forEach(function (k) {
      var inp = h("input", { type: "number", inputmode: "numeric", value: String(s.num[k]) });
      numCard.appendChild(field(s.labels[k] + " (min " + s.mins[k] + ")", inp)); numCard.appendChild(h("div", { class: "btns" }, Btn("Simpan", "w", save(k, inp))));
    });
    wrap.appendChild(numCard);
    var wm = h("input", { type: "text", value: s.watermark });
    wrap.appendChild(Card("", "Watermark Paket Standar", wm, h("div", { class: "btns" }, Btn("Simpan", "g", save("watermark", wm)))));
    var chips = h("div", { class: "chips" });
    (s.kata || []).forEach(function (w) {
      var ch = h("div", { class: "chip" }, w + " ✕");
      ch.addEventListener("click", function () { confirmBox("Hapus kata \"" + w + "\"?").then(function (ok) { if (ok) api("adm.settings.set", { key: "kata.del", value: w }).then(admRefresh).catch(function (e) { toast(e.message, "bad"); }); }); });
      chips.appendChild(ch);
    });
    var nw = h("input", { type: "text", placeholder: "Kata baru", value: A.form.kata || "" });
    nw.addEventListener("input", function () { A.form.kata = nw.value; });
    wrap.appendChild(Card("", "Kata Terlarang", h("p", { class: "muted" }, "Teks promosi yang memuat kata ini ditolak."), chips, nw, h("div", { class: "btns" }, Btn("Tambah Kata", "g", function () { return api("adm.settings.set", { key: "kata.add", value: nw.value }).then(function () { A.form.kata = ""; return admRefresh(); }); }))));
    return wrap;
  }
  function admCmd() {
    var c = state.adm.cmds;
    if (!c) return Card("", "Memuat…");
    var wrap = h("div", null);
    c.forEach(function (sec) {
      var list = h("div", { class: "list" });
      sec.items.forEach(function (it) { list.appendChild(h("div", { class: "it" }, h("div", null, h("div", { class: "cmd" }, it.c), h("div", { class: "muted" }, it.d)))); });
      wrap.appendChild(Card("", sec.title, list));
    });
    return wrap;
  }
  function admOwner() {
    var wrap = h("div", null, Card("v", "Panel Owner Bot", h("p", null, "Fitur owner yang berjalan di chat bot. Aplikasi menutup otomatis setelah menu dibuka.")));
    var tiles = h("div", { class: "tiles" });
    state.me.menu.filter(function (it) { return it.group === "PANEL OWNER"; }).forEach(function (it) { tiles.appendChild(tile(it.id, it.label, it.note)); });
    wrap.appendChild(tiles);
    return wrap;
  }
  function viewAdmin() {
    var p = state.admin;
    var body = p === "acc" ? admAcc() : p === "grp" ? admGrp() : p === "rent" ? admRent() : p === "user" ? admUser() : p === "set" ? admSet() : p === "cmd" ? admCmd() : p === "own" ? admOwner() : admHome();
    return h("div", null, h("div", { class: "back" }, Btn("← " + (p === "home" ? "Keluar dari Admin" : "Panel Admin"), "w", function () { admBack(); })), h("h2", null, ADM_TITLE[p] || "Admin"), state.loading ? Card("", "Memuat…") : body);
  }

  // ---------- kerangka
  var TABS = [["home", "🏠", "Beranda"], ["bc", "📣", "BC"], ["saldo", "💰", "Saldo"], ["ubot", "🤖", "Ubot"], ["menu", "☰", "Menu"]];
  function go(t, sub) { state.admin = null; state.tab = t; if (sub) state.bc = sub; if (t === "saldo") state.hist = null; render(); window.scrollTo(0, 0); }
  function render() {
    if (!state.me) return;
    var body = state.admin ? viewAdmin() : state.tab === "bc" ? viewBC() : state.tab === "saldo" ? viewSaldo() : state.tab === "ubot" ? viewUbot() : state.tab === "menu" ? viewMenu() : viewHome();
    var nav = h("div", { class: "nav" });
    TABS.forEach(function (t) { nav.appendChild(h("button", { class: !state.admin && state.tab === t[0] ? "on" : "", type: "button", onclick: function () { go(t[0]); } }, h("b", null, t[1]), t[2])); });
    root.textContent = "";
    root.appendChild(topbar());
    root.appendChild(body);
    root.appendChild(nav);
    try { if (state.admin) tg.BackButton.show(); else tg.BackButton.hide(); } catch (e) {}
  }
  function tick() {
    var els = document.querySelectorAll(".cd");
    for (var i = 0; i < els.length; i++) els[i].textContent = dur(Number(els[i].dataset.end) - nowMs());
  }
  function theme() { try { document.body.classList.toggle("dark", tg.colorScheme === "dark"); } catch (e) {} }

  // ---------- mulai
  if (!tg || !tg.initData) { fatal("Buka halaman ini lewat bot Telegram (tombol “Buka Mini App”)."); return; }
  try { tg.ready(); tg.expand(); theme(); tg.onEvent("themeChanged", theme); tg.BackButton.onClick(admBack); } catch (e) {}
  load();
  setInterval(tick, 1000);
  setInterval(function () { if (!document.hidden && !state.loading) load(true); }, 15000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(true); });
})();
