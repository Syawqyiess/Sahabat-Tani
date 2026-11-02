// Google Maps JavaScript API — hanya dimuat bila browser key tersedia.
// Peta menampilkan lahan milik akun yang masuk saja (data disiapkan server).
(function () {
  'use strict';
  var el = document.getElementById('map');
  if (!el) return;
  var lands = JSON.parse(el.dataset.lands || '[]');
  var center = JSON.parse(el.dataset.center);
  var selected = Number(el.dataset.selected) || null;
  var detail = document.getElementById('map-detail');

  function fail(msg) {
    el.innerHTML = '<div class="map-placeholder"><p><strong>Peta tidak dapat dimuat.</strong> ' + msg + '</p></div>';
  }

  // Galat autentikasi key (key salah, domain tidak diizinkan, billing belum aktif).
  window.gm_authFailure = function () {
    fail('Google Maps menolak API key (periksa pembatasan domain, API yang diaktifkan, dan billing). Hubungi admin.');
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function infoHtml(l) {
    return '<div class="map-info"><strong>' + esc(l.name) + '</strong>' +
      (l.demo ? '<br><span class="badge badge-demo">Lahan Demo — Bukan Batas Lahan Asli</span>' : '<br><span class="badge badge-real">Data asli</span>') +
      '<br>Luas: ' + (l.area != null ? esc(l.area) + ' ha' : 'Belum diisi') +
      (l.variety ? '<br>Varietas: ' + esc(l.variety) : '') +
      (l.status ? '<br>Status: ' + esc(l.status) : '') +
      '<br><a href="/lahan/' + l.id + '">Lihat detail lahan</a></div>';
  }

  window.__initSahabatMap = function () {
    var g = window.google.maps;
    el.innerHTML = '';
    var map = new g.Map(el, {
      center: { lat: center.lat, lng: center.lng }, zoom: 15,
      mapTypeId: 'hybrid',
      mapTypeControl: true,
      mapTypeControlOptions: { mapTypeIds: ['roadmap', 'satellite', 'hybrid'] },
      streetViewControl: false, fullscreenControl: true, gestureHandling: 'cooperative',
    });
    var info = new g.InfoWindow();
    var bounds = new g.LatLngBounds();
    var byId = {};

    lands.forEach(function (l) {
      var item = { land: l, bounds: new g.LatLngBounds() };
      var color = l.demo ? '#c47f17' : '#1e5631';
      if (l.polygon && l.polygon.length >= 3) {
        var path = l.polygon.map(function (p) { return { lat: p[0], lng: p[1] }; });
        item.poly = new g.Polygon({
          paths: path, map: map, strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: l.demo ? 0.18 : 0.28, strokeOpacity: 0.9,
        });
        path.forEach(function (p) { item.bounds.extend(p); });
        item.poly.addListener('click', function () { focus(l.id, false); });
      }
      if (l.lat != null && l.lng != null) {
        var pos = { lat: l.lat, lng: l.lng };
        item.marker = new g.Marker({ position: pos, map: map, title: l.name + (l.demo ? ' (Demo)' : ''), label: { text: l.demo ? 'D' : 'L', color: '#fff', fontWeight: '700' } });
        item.marker.addListener('click', function () { focus(l.id, false); });
        item.bounds.extend(pos);
        item.anchor = pos;
      }
      if (!item.bounds.isEmpty()) { bounds.extend(item.bounds.getNorthEast()); bounds.extend(item.bounds.getSouthWest()); }
      byId[l.id] = item;
    });

    // Sorot lahan terpilih: garis lebih tebal & isi lebih pekat; lainnya diredupkan.
    function highlight(id) {
      Object.keys(byId).forEach(function (k) {
        var it = byId[k], on = Number(k) === id, any = !!id;
        if (it.poly) it.poly.setOptions({ strokeWeight: on ? 4 : 2, fillOpacity: on ? 0.45 : (any ? 0.12 : (it.land.demo ? 0.18 : 0.28)), zIndex: on ? 2 : 1 });
        if (it.marker) it.marker.setZIndex(on ? 999 : 1);
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
      if (!it || it.bounds.isEmpty()) return;
      if (move !== false) {
        map.fitBounds(it.bounds, 60);
        g.event.addListenerOnce(map, 'idle', function () { if (map.getZoom() > 18) map.setZoom(18); });
      }
      info.setContent(infoHtml(it.land)); info.setPosition(it.anchor || it.bounds.getCenter()); info.open({ map: map });
      if (detail) { detail.innerHTML = infoHtml(it.land); detail.hidden = false; }
      highlight(id);
    }

    if (selected && byId[selected]) focus(selected);
    else if (!bounds.isEmpty()) { map.fitBounds(bounds, 60); g.event.addListenerOnce(map, 'idle', function () { if (map.getZoom() > 17) map.setZoom(17); }); }

    document.querySelectorAll('[data-focus-land]').forEach(function (b) {
      b.addEventListener('click', function () {
        focus(Number(b.dataset.focusLand));
        // Di ponsel peta berada di atas daftar: gulir agar lahan terlihat.
        if (window.matchMedia('(max-width: 1023px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  var s = document.createElement('script');
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(el.dataset.key) + '&callback=__initSahabatMap&loading=async&language=id&region=ID&v=weekly';
  s.async = true;
  s.onerror = function () { fail('Periksa koneksi internet Anda.'); };
  document.head.appendChild(s);
})();
