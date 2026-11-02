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

  // Pilihan lokasi kualitas udara langsung memuat ulang tanpa tombol tambahan.
  document.querySelectorAll('[data-autosubmit-select]').forEach(function (sel) {
    sel.addEventListener('change', function () { sel.form.requestSubmit ? sel.form.requestSubmit() : sel.form.submit(); });
  });
})();
