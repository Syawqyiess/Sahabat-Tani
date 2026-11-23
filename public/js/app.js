// Perilaku umum: cegah klik ganda, konfirmasi, potongan HTML, lokasi perangkat, toast, lembar menu.
(function () {
  'use strict';

  // ---------- Formulir: cegah pengiriman ganda ----------
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.hasAttribute('data-confirm') && !window.confirm(form.getAttribute('data-confirm'))) {
      e.preventDefault();
      return;
    }
    if (e.defaultPrevented || form.dataset.js === 'custom') return;
    if (form.dataset.submitting === '1') { e.preventDefault(); return; }
    form.dataset.submitting = '1';
    var btn = e.submitter || form.querySelector('[type=submit]');
    if (btn) {
      if (btn.name) {
        var h = document.createElement('input');
        h.type = 'hidden'; h.name = btn.name; h.value = btn.value;
        form.appendChild(h);
      }
      if (btn.dataset.busy) {
        btn.innerHTML = '<span class="spinner" aria-hidden="true" style="width:18px;height:18px;border-width:2.5px"></span> ' + btn.dataset.busy;
      }
      btn.setAttribute('aria-disabled', 'true');
      setTimeout(function () { btn.disabled = true; }, 0);
    }
  });
  // Kembali via tombol "back" (bfcache): aktifkan lagi formulir.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    document.querySelectorAll('form[data-submitting]').forEach(function (f) { delete f.dataset.submitting; });
    document.querySelectorAll('button[disabled][aria-disabled]').forEach(function (b) { b.disabled = false; b.removeAttribute('aria-disabled'); });
  });

  // ---------- Kartu Kalender Tanam (Dashboard): selalu tanggal & data terbaru ----------
  // Muat ulang bila: kembali lewat tombol back (bfcache), melewati tengah malam (Asia/Jakarta),
  // atau tab dibuka lagi setelah tanggal berganti.
  var calCard = document.querySelector('[data-cal-today]');
  if (calCard) {
    var jakartaToday = function () {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return null; }
    };
    var staleCheck = function () {
      var t = jakartaToday();
      if (t && t !== calCard.getAttribute('data-cal-today')) window.location.reload();
    };
    window.addEventListener('pageshow', function (e) { if (e.persisted) window.location.reload(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) staleCheck(); });
    setInterval(staleCheck, 60000);
  }

  // ---------- Foto profil gagal dimuat → avatar inisial ----------
  document.querySelectorAll('img.avatar-mini').forEach(function (img) {
    function swap() {
      var span = document.createElement('span');
      span.className = img.className;
      span.setAttribute('aria-hidden', 'true');
      var btn = img.closest('[aria-label]');
      var label = btn ? btn.getAttribute('aria-label').replace(/^Menu akun\s*/, '') : '';
      span.textContent = (label.trim()[0] || '?').toUpperCase();
      img.replaceWith(span);
    }
    if (img.complete && img.naturalWidth === 0) swap(); else img.addEventListener('error', swap, { once: true });
  });
  document.querySelectorAll('img.avatar-lg').forEach(function (img) {
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; img.parentNode.classList.add('avatar-broken'); }, { once: true });
  });

  // ---------- Toast ----------
  function dismiss(t) {
    if (!t || t.classList.contains('is-leaving')) return;
    t.classList.add('is-leaving');
    setTimeout(function () { t.remove(); }, 220);
  }
  document.querySelectorAll('[data-toast]').forEach(function (t) {
    t.querySelector('[data-toast-close]').addEventListener('click', function () { dismiss(t); });
    // Pesan berhasil hilang sendiri; pesan galat tetap sampai ditutup.
    if (t.dataset.toast !== 'error') setTimeout(function () { dismiss(t); }, 6000);
  });

  // ---------- Appbar: garis bawah saat digulir ----------
  var bar = document.querySelector('[data-appbar]');
  if (bar) {
    var onScroll = function () { bar.classList.toggle('is-scrolled', window.scrollY > 4); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Lembar menu: fokus, Esc, kembali fokus ----------
  var lastTrigger = null;
  function openSheet(id, trigger) {
    var s = document.getElementById(id);
    if (!s) return;
    lastTrigger = trigger || document.activeElement;
    s.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    var first = s.querySelector('.sheet-panel a[href]:not([data-sheet-close]), .sheet-panel button');
    setTimeout(function () { (first || s.querySelector('.sheet-panel')).focus(); }, 50);
  }
  function closeSheet(s) {
    s.classList.remove('is-open');
    document.body.style.overflow = '';
    if (location.hash === '#' + s.id) history.replaceState(null, '', location.pathname + location.search);
    if (lastTrigger) lastTrigger.focus();
  }
  document.querySelectorAll('[data-sheet-open]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); openSheet(a.dataset.sheetOpen, a); });
  });
  document.querySelectorAll('.sheet').forEach(function (s) {
    s.querySelectorAll('[data-sheet-close]').forEach(function (c) {
      c.addEventListener('click', function (e) { e.preventDefault(); closeSheet(s); });
    });
    s.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSheet(s); return; }
      if (e.key !== 'Tab') return;
      var f = s.querySelectorAll('.sheet-panel a[href], .sheet-panel button');
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
  });
  if (location.hash === '#menu-lainnya') openSheet('menu-lainnya');

  // ---------- Potongan HTML (mis. kualitas udara di dashboard) ----------
  function loadFragment(el) {
    fetch(el.getAttribute('data-fragment'), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
      .then(function (html) { el.innerHTML = html; el.classList.add('results-fade'); bindRetry(el); })
      .catch(function () {
        el.innerHTML = '<div class="state state-inline state-error"><p>Gagal memuat. Periksa koneksi. <button type="button" class="link-btn" data-fragment-retry>Coba lagi</button></p></div>';
        bindRetry(el);
      });
  }
  function bindRetry(el) {
    var b = el.querySelector('[data-fragment-retry]');
    if (b) b.addEventListener('click', function (e) { e.preventDefault(); loadFragment(el); });
  }
  document.querySelectorAll('[data-fragment]').forEach(loadFragment);

  // ---------- Lokasi perangkat ----------
  function geoError(err) {
    if (!err) return 'Perangkat tidak mendukung lokasi.';
    if (err.code === 1) return 'Izin lokasi ditolak. Aktifkan izin lokasi di pengaturan browser, atau pilih lahan.';
    if (err.code === 3) return 'Lokasi terlalu lama didapat. Coba lagi di tempat terbuka.';
    return 'Lokasi tidak dapat ditentukan.';
  }
  function getPosition(msgEl, cb) {
    if (!navigator.geolocation) { if (msgEl) msgEl.textContent = geoError(null); return; }
    if (msgEl) msgEl.textContent = 'Meminta lokasi perangkat…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (msgEl) msgEl.textContent = '';
      cb(pos.coords);
    }, function (err) { if (msgEl) msgEl.textContent = geoError(err); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  document.querySelectorAll('[data-geolocate]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var msg = btn.closest('form, section, div').querySelector('[data-geo-msg]');
      getPosition(msg, function (c) {
        location.href = btn.getAttribute('data-geolocate') + '?src=perangkat&lat=' + c.latitude.toFixed(4) + '&lng=' + c.longitude.toFixed(4);
      });
    });
  });
  document.querySelectorAll('[data-fill-coords]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var fs = btn.closest('fieldset');
      getPosition(fs.querySelector('[data-geo-msg]'), function (c) {
        fs.querySelector('[name=lat]').value = c.latitude.toFixed(6);
        fs.querySelector('[name=lng]').value = c.longitude.toFixed(6);
      });
    });
  });

  // Unggah foto profil langsung setelah dipilih.
  document.querySelectorAll('[data-autosubmit]').forEach(function (input) {
    input.addEventListener('change', function () { if (input.files.length) input.form.submit(); });
  });

  // Peta Windy: ganti lapisan tanpa memuat ulang halaman (tautan tetap berfungsi tanpa JS).
  document.querySelectorAll('[data-windy]').forEach(function (card) {
    var frame = card.querySelector('[data-windy-frame]');
    var box = frame.parentElement;
    frame.addEventListener('load', function () { box.classList.remove('is-loading'); });
    card.querySelectorAll('[data-windy-layer]').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        var u = new URL(frame.src);
        u.searchParams.set('overlay', chip.dataset.windyLayer);
        box.classList.add('is-loading');
        frame.src = u.toString();
        var open = card.querySelector('[data-windy-open]');
        if (open) open.href = u.toString();
        frame.title = 'Peta sebaran ' + chip.textContent.trim() + ' dari Windy';
        card.querySelectorAll('[data-windy-layer]').forEach(function (c) {
          var on = c === chip;
          c.classList.toggle('is-active', on);
          if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
        });
        history.replaceState(null, '', chip.getAttribute('href'));
      });
    });
  });

  // Pilihan lokasi kualitas udara langsung memuat ulang tanpa tombol tambahan.
  document.querySelectorAll('[data-autosubmit-select]').forEach(function (sel) {
    sel.addEventListener('change', function () { sel.form.requestSubmit ? sel.form.requestSubmit() : sel.form.submit(); });
  });

  // Foto lahan gagal dimuat → tampilkan placeholder jujur, bukan gambar rusak.
  function landImgFailed(img) {
    var box = img.closest('.land-photo');
    var empty = box && box.querySelector('[data-land-empty]');
    img.remove();
    if (empty) empty.hidden = false;
  }
  document.querySelectorAll('img[data-land-img]').forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) landImgFailed(img);
    else img.addEventListener('error', function () { landImgFailed(img); }, { once: true });
  });

  // Pratinjau foto lahan yang dipilih sebelum disimpan.
  document.querySelectorAll('[data-photo-input]').forEach(function (input) {
    var field = input.closest('.photo-field');
    var box = field.querySelector('[data-photo-preview]');
    var name = field.querySelector('[data-photo-name]');
    var url = null;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (url) { URL.revokeObjectURL(url); url = null; }
      if (!file) { name.textContent = ''; return; }
      name.textContent = 'Dipilih: ' + file.name + ' (' + Math.max(1, Math.round(file.size / 1024)) + ' KB). Simpan lahan untuk mengunggah.';
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) return;
      url = URL.createObjectURL(file);
      var img = document.createElement('img');
      img.src = url;
      img.alt = 'Pratinjau foto lahan yang dipilih';
      box.replaceChildren(img);
    });
  });

  // Laci daftar percakapan (layar sempit). Di layar lebar daftar sudah terlihat, tombol membuka halaman riwayat.
  var drawer = document.querySelector('[data-chat-drawer]');
  if (drawer) {
    var backdrop = document.querySelector('.chat-drawer-backdrop');
    var opener = null;
    var isDrawer = function () { return window.matchMedia('(max-width: 1099px)').matches; };
    var closeDrawer = function () {
      if (!drawer.classList.contains('is-open')) return;
      drawer.classList.remove('is-open');
      backdrop.hidden = true;
      if (opener) opener.setAttribute('aria-expanded', 'false');
      if (opener) opener.focus();
    };
    document.querySelectorAll('[data-drawer-open]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function (e) {
        if (!isDrawer()) return; // ikuti tautan ke halaman Riwayat Percakapan
        e.preventDefault();
        opener = btn;
        drawer.classList.add('is-open');
        backdrop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        var first = drawer.querySelector('.conv-list a.is-active') || drawer.querySelector('a, button');
        if (first) first.focus();
      });
    });
    document.querySelectorAll('[data-drawer-close]').forEach(function (el) { el.addEventListener('click', closeDrawer); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    window.addEventListener('resize', function () { if (!isDrawer()) closeDrawer(); });
  }

  // Ponsel: saat kolom pesan aktif (keyboard terbuka), nav bawah disembunyikan agar input tetap terlihat.
  document.querySelectorAll('.composer textarea').forEach(function (ta) {
    ta.addEventListener('focus', function () { document.body.classList.add('is-typing'); });
    ta.addEventListener('blur', function () { document.body.classList.remove('is-typing'); });
  });

  // Gambar berita gagal dimuat → ilustrasi kategori (sekali saja, tanpa loop error).
  function articleImgFailed(img) {
    var box = img.parentNode;
    var fb = box && box.querySelector('[data-article-fallback]');
    var credit = box && box.querySelector('.media-credit');
    img.remove();
    if (credit) credit.remove();
    if (fb) fb.hidden = false;
  }
  document.querySelectorAll('img[data-article-img]').forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) articleImgFailed(img);
    else img.addEventListener('error', function () { articleImgFailed(img); }, { once: true });
  });

  // ---------- Animasi saat terlihat ----------
  // [data-reveal] diberi .is-visible ketika masuk layar (sekali saja); angka [data-count] menghitung naik.
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(el) {
    var target = Number(el.getAttribute('data-count'));
    if (!isFinite(target) || reduceMotion) return;
    var dec = Number(el.getAttribute('data-count-dec') || 0);
    var fmtN = function (v) { return v.toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
    var start = null, dur = 900;
    el.textContent = fmtN(0);
    function step(t) {
      if (start === null) start = t;
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtN(Math.round(target * eased * Math.pow(10, dec)) / Math.pow(10, dec));
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmtN(target);
    }
    requestAnimationFrame(step);
  }
  function reveal(el) {
    if (el.classList.contains('is-visible')) return;
    el.classList.add('is-visible');
    el.querySelectorAll('[data-count]').forEach(countUp);
    el.dispatchEvent(new CustomEvent('reveal'));
  }
  window.sahabatReveal = function (root) {
    var items = (root || document).querySelectorAll('[data-reveal]:not(.is-visible)');
    if (reduceMotion || !('IntersectionObserver' in window)) { items.forEach(reveal); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { reveal(en.target); io.unobserve(en.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el) { io.observe(el); });
  };
  window.sahabatReveal();

  // Lihat/sembunyikan kata sandi. Saat formulir dikirim, kolom dikembalikan ke mode tersembunyi.
  document.querySelectorAll('[data-pw-toggle]').forEach(function (btn) {
    var input = document.getElementById(btn.getAttribute('aria-controls'));
    if (!input) return;
    function set(show) {
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      var label = show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.querySelector('.pw-ic-show').hidden = show;
      btn.querySelector('.pw-ic-hide').hidden = !show;
    }
    btn.addEventListener('click', function () {
      var pos = input.selectionStart;
      set(input.type === 'password');
      input.focus();
      try { input.setSelectionRange(pos, pos); } catch (e) { /* abaikan */ }
    });
    if (input.form) input.form.addEventListener('submit', function () { set(false); });
  });

  // ---------- Navbar: dropdown, laci, tombol mengambang ----------
  // Dibuka dengan klik; Escape/klik di luar menutup; hanya satu panel terbuka; panah atas/bawah berpindah antar tautan.
  var openPanel = null; // { btn, panel }
  function panelOf(btn) { return document.getElementById(btn.getAttribute('aria-controls')); }
  function closePanel(returnFocus) {
    if (!openPanel) return;
    var p = openPanel;
    openPanel = null;
    p.panel.hidden = true;
    p.btn.setAttribute('aria-expanded', 'false');
    if (p.onClose) p.onClose();
    if (returnFocus) p.btn.focus();
  }
  function openPanelFor(btn, onOpen, onClose) {
    var panel = panelOf(btn);
    if (!panel) return;
    if (openPanel && openPanel.btn === btn) { closePanel(false); return; }
    closePanel(false);
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openPanel = { btn: btn, panel: panel, onClose: onClose };
    if (onOpen) onOpen(panel);
  }
  function links(panel) { return Array.prototype.slice.call(panel.querySelectorAll('a[href], button:not([disabled])')); }

  document.querySelectorAll('[data-dd]').forEach(function (btn) {
    btn.addEventListener('click', function () { openPanelFor(btn); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!openPanel || openPanel.btn !== btn) openPanelFor(btn); var l = links(panelOf(btn)); if (l[0]) l[0].focus(); }
    });
  });
  var burger = document.querySelector('[data-nav-toggle]');
  if (burger) {
    burger.addEventListener('click', function () {
      openPanelFor(burger, function (panel) {
        burger.setAttribute('aria-label', 'Tutup menu navigasi');
        var active = panel.querySelector('.is-active') || links(panel)[0];
        if (active) active.focus();
      }, function () { burger.setAttribute('aria-label', 'Buka menu navigasi'); });
    });
  }
  var fabBtn = document.querySelector('[data-fab-toggle]');
  if (fabBtn) {
    var swap = function (open) {
      fabBtn.querySelector('.fab-open').hidden = open;
      fabBtn.querySelector('.fab-close').hidden = !open;
    };
    fabBtn.addEventListener('click', function () {
      openPanelFor(fabBtn, function (panel) { swap(true); var l = links(panel); if (l[0]) l[0].focus(); }, function () { swap(false); });
    });
  }
  document.addEventListener('click', function (e) {
    if (!openPanel) return;
    if (openPanel.panel.contains(e.target) || openPanel.btn.contains(e.target)) return;
    closePanel(false);
  });
  document.addEventListener('keydown', function (e) {
    if (!openPanel) return;
    if (e.key === 'Escape') { closePanel(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var l = links(openPanel.panel);
      var i = l.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      var n = e.key === 'ArrowDown' ? (i + 1) % l.length : (i - 1 + l.length) % l.length;
      l[n].focus();
    }
  });
  // Fokus keluar dari panel (Tab) → tutup tanpa mencuri fokus.
  document.addEventListener('focusin', function (e) {
    if (openPanel && !openPanel.panel.contains(e.target) && !openPanel.btn.contains(e.target)) closePanel(false);
  });
  window.addEventListener('resize', function () { if (openPanel && openPanel.btn === burger && window.innerWidth > 1180) closePanel(false); });

  // Baris filter kategori: tombol geser & tepi memudar hanya bila masih ada kategori di luar layar.
  document.querySelectorAll('nav.chips').forEach(function (row) {
    var wrap = document.createElement('div');
    wrap.className = 'chips-wrap';
    row.parentNode.insertBefore(wrap, row);
    wrap.appendChild(row);
    function btn(dir) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chips-nav chips-nav-' + dir;
      b.setAttribute('aria-label', dir === 'prev' ? 'Geser kategori ke kiri' : 'Geser kategori ke kanan');
      b.tabIndex = -1; // pengguna keyboard berpindah antar kategori dengan Tab
      b.innerHTML = dir === 'prev' ? '&#8249;' : '&#8250;';
      b.addEventListener('click', function () { row.scrollBy({ left: (dir === 'prev' ? -1 : 1) * row.clientWidth * 0.7 }); });
      wrap.appendChild(b);
    }
    btn('prev'); btn('next');
    function update() {
      wrap.classList.toggle('can-left', row.scrollLeft > 4);
      wrap.classList.toggle('can-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    }
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    var active = row.querySelector('.is-active');
    if (active && active.offsetLeft + active.offsetWidth > row.clientWidth) row.scrollLeft = active.offsetLeft - 48;
    update();
  });

  // Unggah foto profil dari halaman Profil: pratinjau & validasi tipe/ukuran sebelum dikirim.
  document.querySelectorAll('[data-photo-upload]').forEach(function (form) {
    var input = form.querySelector('[data-pf-input]');
    var prev = form.querySelector('[data-pf-preview]');
    var err = form.querySelector('[data-pf-error]');
    var url = null;
    var maxBytes = 8 * 1048576;
    function reset() { input.value = ''; prev.hidden = true; if (url) { URL.revokeObjectURL(url); url = null; } }
    input.addEventListener('change', function () {
      err.hidden = true;
      var f = input.files && input.files[0];
      if (!f) { reset(); return; }
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(f.type) === -1) { reset(); err.textContent = 'Format tidak didukung. Gunakan JPG, PNG, atau WEBP.'; err.hidden = false; return; }
      if (f.size > maxBytes) { reset(); err.textContent = 'Ukuran foto terlalu besar. Maksimal 8 MB.'; err.hidden = false; return; }
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(f);
      prev.querySelector('img').src = url;
      form.querySelector('[data-pf-name]').textContent = f.name + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)';
      prev.hidden = false;
    });
    form.querySelector('[data-pf-cancel]').addEventListener('click', reset);
  });

})();
