// Peta lahan dengan Leaflet (pustaka peta terbuka, tanpa API key).
// Hanya menampilkan lahan milik akun yang masuk (data disiapkan server).
(function () {
  'use strict';
  var el = document.getElementById('map');
  if (!el || !window.L) return;
  var L = window.L;
  var lands = JSON.parse(el.dataset.lands || '[]');
  var center = JSON.parse(el.dataset.center);
  var selected = Number(el.dataset.selected) || null;
  var detail = document.getElementById('map-detail');
  var msg = el.parentElement.querySelector('[data-map-msg]');
  el.innerHTML = '';

  var COLOR_REAL = '#1e5631';
  var COLOR_DEMO = '#c47f17';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Popup ringkas: nama, luas, fase/umur, jenis tanaman, tombol detail. Penanda demo hanya bila data bercampur.
  function infoHtml(l) {
    return '<div class="map-info"><strong>' + esc(l.name) + '</strong>' +
      (l.allDemo ? '' : (l.demo ? ' <span class="badge badge-demo">Demo</span>' : ' <span class="badge badge-real">Data asli</span>')) +
      '<dl><dt>Luas</dt><dd>' + (l.area ? esc(l.area) : 'Belum diisi') + '</dd>' +
      '<dt>Fase &amp; umur</dt><dd>' + esc(l.age) + (l.ageEstimated ? ' <small>(perkiraan)</small>' : '') + '</dd>' +
      '<dt>Tanaman</dt><dd>' + (l.crop ? esc(l.crop) : 'Belum diisi') + '</dd></dl>' +
      '<a class="btn btn-sm" href="/lahan/' + l.id + '">Lihat Detail</a></div>';
  }

  // Lapisan dasar: peta jalan OpenStreetMap dan citra satelit Esri (keduanya wajib atribusi).
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  });
  var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Citra &copy; Esri, Maxar, Earthstar Geographics',
  });

  var map = L.map(el, {
    center: [center.lat, center.lng],
    zoom: 15,
    layers: [satellite],
    scrollWheelZoom: false, // agar halaman tetap mudah digulir; aktif setelah peta diklik
    tap: true,
  });
  L.control.layers({ 'Satelit': satellite, 'Peta jalan': osm }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  map.on('click', function () { map.scrollWheelZoom.enable(); });
  el.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });
  setTimeout(function () { map.invalidateSize(); }, 200);
  window.addEventListener('resize', function () { map.invalidateSize(); });

  // Beri tahu bila ubin peta gagal dimuat (mis. koneksi terputus) — bukan menampilkan peta kosong diam-diam.
  var tileErrors = 0;
  function onTileError() {
    tileErrors++;
    if (tileErrors === 3 && msg) { msg.textContent = 'Sebagian gambar peta gagal dimuat. Periksa koneksi internet, atau coba ganti ke “Peta jalan”.'; msg.hidden = false; }
  }
  osm.on('tileerror', onTileError);
  satellite.on('tileerror', onTileError);

  var bounds = L.latLngBounds([]);
  var byId = {};

  lands.forEach(function (l) {
    var color = l.demo ? COLOR_DEMO : COLOR_REAL;
    var item = { land: l, bounds: L.latLngBounds([]) };
    if (l.polygon && l.polygon.length >= 3) {
      item.poly = L.polygon(l.polygon, {
        color: color, weight: 2, fillColor: color, fillOpacity: l.demo ? 0.18 : 0.3,
        dashArray: l.demo ? '6 6' : null, // lahan demo bergaris putus-putus: pembeda selain warna
      }).addTo(map);
      item.poly.on('click', function () { focus(l.id, false); });
      item.bounds.extend(item.poly.getBounds());
    }
    if (l.lat != null && l.lng != null) {
      var icon = L.divIcon({
        className: '',
        html: '<span class="lmark ' + (l.demo ? 'lmark-demo' : 'lmark-real') + '" aria-hidden="true">' + (l.demo ? 'D' : 'L') + '</span>',
        iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14],
      });
      item.marker = L.marker([l.lat, l.lng], { icon: icon, title: l.name + (l.demo ? ' (Lahan demo)' : ''), alt: l.name, keyboard: true }).addTo(map);
      item.marker.on('click', function () { focus(l.id, false); });
      item.bounds.extend([l.lat, l.lng]);
      item.anchor = L.latLng(l.lat, l.lng);
    }
    if (item.bounds.isValid()) bounds.extend(item.bounds);
    byId[l.id] = item;
  });

  // Sorot lahan terpilih: garis lebih tebal & isi lebih pekat; lahan lain diredupkan.
  function highlight(id) {
    Object.keys(byId).forEach(function (k) {
      var it = byId[k], on = Number(k) === id;
      if (it.poly) {
        it.poly.setStyle({ weight: on ? 4 : 2, fillOpacity: on ? 0.45 : (id ? 0.1 : (it.land.demo ? 0.18 : 0.3)) });
        if (on) it.poly.bringToFront();
      }
      if (it.marker) it.marker.setZIndexOffset(on ? 1000 : 0);
    });
    document.querySelectorAll('[data-land-item]').forEach(function (li) {
      var on = Number(li.dataset.landItem) === id;
      li.classList.toggle('is-selected', on);
      var b = li.querySelector('[data-focus-land]');
      if (b) b.setAttribute('aria-pressed', String(on));
    });
  }

  function focus(id, move) {
    var it = byId[id];
    if (!it || !it.bounds.isValid()) return;
    if (move !== false) map.fitBounds(it.bounds, { padding: [40, 40], maxZoom: 18 });
    L.popup({ maxWidth: 230, autoPanPadding: [24, 24], className: 'land-popup' }).setLatLng(it.anchor || it.bounds.getCenter()).setContent(infoHtml(it.land)).openOn(map);
    if (detail) { detail.innerHTML = infoHtml(it.land); detail.hidden = false; }
    highlight(id);
    // Klik di peta → kartu terkait terlihat di panel kiri (tanpa menggeser halaman).
    if (move === false) {
      var li = document.querySelector('[data-land-item="' + id + '"]');
      var list = li && li.parentElement;
      if (li && list && list.scrollHeight > list.clientHeight) list.scrollTo({ top: li.offsetTop - list.offsetTop - 8, behavior: 'smooth' });
    }
  }

  if (selected && byId[selected]) focus(selected);
  else if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });

  // Seluruh kartu dapat dipilih (selain tautan/tombolnya sendiri).
  document.querySelectorAll('[data-land-item].is-pickable').forEach(function (li) {
    li.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      focus(Number(li.dataset.landItem));
    });
  });
  document.querySelectorAll('[data-focus-land]').forEach(function (b) {
    b.addEventListener('click', function () {
      focus(Number(b.dataset.focusLand));
      // Di ponsel peta ada di atas daftar: gulir agar lahan terlihat.
      if (window.matchMedia('(max-width: 1023px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Peta di dalam kontainer yang ukurannya berubah (mis. layout responsif) perlu dihitung ulang.
  if (window.ResizeObserver) new ResizeObserver(function () { map.invalidateSize(); }).observe(el);
})();
