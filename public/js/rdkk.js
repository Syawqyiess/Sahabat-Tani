// Diagram RDKK milik website (SVG buatan sendiri, tanpa pustaka luar).
// Warna mengikuti entitas (jenis pupuk), bukan urutan: Urea = hijau, NPK = emas padi — tetap sama saat difilter.
// Palet divalidasi dengan pemeriksa CVD; karena emas < 3:1 terhadap putih, setiap batang diberi label angka
// dan tabel data tersedia. Tooltip muncul saat kursor/fokus keyboard berada di batang atau sel.
(function () {
  'use strict';
  var root = document.querySelector('[data-rdkk]');
  var json = root && root.querySelector('[data-rdkk-json]');
  if (!json) return;
  var data = JSON.parse(json.textContent);
  var COLORS = { UREA: '#2e7d32', NPK: '#c98a1b' };
  var FALLBACK = ['#2e7d32', '#c98a1b', '#3b6fb6', '#8a5a35'];
  var LABEL = { UREA: 'Urea', NPK: 'NPK' };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var INK = '#17251b', INK2 = '#3f4d44', INK3 = '#58665d', GRID = '#e3e9dc', SURFACE = '#ffffff';
  var selected = ''; // '' = semua jenis
  var tip = root.querySelector('[data-tip]');

  function color(j) { return COLORS[j] || FALLBACK[data.jenis.indexOf(j) % FALLBACK.length]; }
  function nama(s) { return LABEL[s] || s.charAt(0) + s.slice(1).toLowerCase(); }
  function fmt(n) { return Math.round(n).toLocaleString('id-ID'); }
  // Format ringkas untuk sumbu & label sempit: 25.000 → "25 rb", 23.599 → "23,6 rb".
  function short(n) { return n >= 1000 ? (n / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' rb' : fmt(n); }
  function el(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  // Animasi: batang tumbuh dari garis dasar dengan jeda bertahap; label muncul setelahnya.
  function anim(node, cls, delay) { node.setAttribute('class', ((node.getAttribute('class') || '') + ' rv ' + cls).trim()); node.style.setProperty('--rv-d', (delay || 0) + 'ms'); return node; }
  function visibleJenis() { return selected ? [selected] : data.jenis; }
  // Skala rapi: 0, 10.000, 20.000, … dengan ±4 garis bantu.
  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log10(v || 1)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p * 4 >= v) return steps[i] * p * 4;
    return 10 * p * 4;
  }
  // Batang dengan ujung data membulat 4px, pangkal di garis dasar tetap persegi.
  function barPath(x, y, w, h, dir) {
    var r = Math.min(4, (dir === 'h' ? h : w) / 2, dir === 'h' ? w : h);
    if (dir === 'h') return 'M' + x + ',' + y + 'h' + (w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'v' + (h - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + -r + ',' + r + 'h' + -(w - r) + 'z';
    return 'M' + x + ',' + (y + h) + 'v' + -(h - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + -r + 'h' + (w - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'v' + (h - r) + 'z';
  }

  // ---------- Tooltip ----------
  function showTip(evtTarget, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    var box = root.getBoundingClientRect();
    var t = evtTarget.getBoundingClientRect();
    var x = t.left + t.width / 2 - box.left;
    var y = t.top - box.top;
    tip.style.left = Math.max(8, Math.min(box.width - tip.offsetWidth - 8, x - tip.offsetWidth / 2)) + 'px';
    tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function hover(node, html, label) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', label);
    node.classList.add('rdkk-mark');
    node.addEventListener('pointerenter', function () { showTip(node, html); });
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', function () { showTip(node, html); });
    node.addEventListener('blur', hideTip);
  }
  function tipRow(j, v, extra) {
    return '<span class="rdkk-tip-row"><i style="background:' + color(j) + '"></i>' + nama(j) + '<b>' + fmt(v) + ' kg</b></span>' + (extra || '');
  }

  function legend() {
    root.querySelectorAll('[data-legend]').forEach(function (lg) {
      lg.innerHTML = visibleJenis().map(function (j) { return '<span><i style="background:' + color(j) + '"></i>' + nama(j) + '</span>'; }).join('');
    });
    root.querySelectorAll('[data-swatch]').forEach(function (s) { s.style.background = color(s.getAttribute('data-swatch')); });
  }

  // ---------- 1. Batang horizontal bertumpuk: kelompok tani × jenis ----------
  function chartKelompok(host) {
    var W = host.clientWidth, rowH = 44, gap = 26, padL = Math.min(118, W * 0.3), padR = W < 420 ? 64 : 74, top = 6;
    var groups = data.kelompok;
    var H = top + groups.length * (rowH + gap) + 26;
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    var totals = groups.map(function (g) {
      return visibleJenis().reduce(function (n, j) { var r = data.perKelompok.find(function (x) { return x.kelompok === g && x.jenis === j; }); return n + (r ? r.kg : 0); }, 0);
    });
    var max = niceMax(Math.max.apply(null, totals));
    var plotW = W - padL - padR;
    var sx = function (v) { return (v / max) * plotW; };
    var ticks = plotW < 260 ? 2 : 4;
    for (var t = 0; t <= ticks; t++) {
      var gx = padL + sx(max * t / ticks);
      svg.appendChild(el('line', { x1: gx, x2: gx, y1: top - 4, y2: H - 22, stroke: GRID, 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: gx, y: H - 6, 'text-anchor': t === 0 ? 'start' : 'middle', 'font-size': 11, fill: INK3 }, short(max * t / ticks)));
    }
    groups.forEach(function (g, i) {
      var y = top + i * (rowH + gap);
      svg.appendChild(el('text', { x: padL - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 650, fill: INK }, nama(g)));
      var x = padL;
      var segs = visibleJenis();
      var row = anim(el('g', {}), 'rv-grow-x', 250 + i * 110);
      row.style.transformOrigin = padL + 'px 0';
      svg.appendChild(row);
      segs.forEach(function (j, k) {
        var r = data.perKelompok.find(function (row) { return row.kelompok === g && row.jenis === j; });
        if (!r || !r.kg) return;
        var w = Math.max(1, sx(r.kg) - (k < segs.length - 1 ? 2 : 0)); // celah 2px antar segmen
        var last = k === segs.length - 1;
        var shape = last ? el('path', { d: barPath(x, y, w, rowH, 'h'), fill: color(j) }) : el('rect', { x: x, y: y, width: w, height: rowH, fill: color(j) });
        hover(shape, '<strong>' + nama(g) + '</strong>' + tipRow(j, r.kg, '<span class="rdkk-tip-sub">' + Math.round(r.kg / totals[i] * 100) + '% dari kelompok ini</span>'), nama(g) + ', ' + nama(j) + ': ' + fmt(r.kg) + ' kilogram');
        row.appendChild(shape);
        if (w > 64) svg.appendChild(anim(el('text', { x: x + w / 2, y: y + rowH / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#fff', 'pointer-events': 'none' }, fmt(r.kg)), 'rv-fade', 820 + i * 110));
        x += w + 2;
      });
      svg.appendChild(anim(el('text', { x: padL + sx(totals[i]) + 8, y: y + rowH / 2 + 4, 'font-size': 12, 'font-weight': 700, fill: INK2 }, (plotW < 260 ? short(totals[i]) : fmt(totals[i])) + ' kg'), 'rv-fade', 880 + i * 110));
    });
    host.replaceChildren(svg);
  }

  // ---------- 2. Batang vertikal berkelompok: musim × jenis ----------
  function chartMusim(host) {
    var W = host.clientWidth, H = 240, padL = 44, padR = 8, top = 22, bottom = 30;
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    var js = visibleJenis();
    var vals = data.perMusim.filter(function (r) { return js.indexOf(r.jenis) >= 0; }).map(function (r) { return r.kg; });
    var max = niceMax(Math.max.apply(null, vals));
    var plotH = H - top - bottom, plotW = W - padL - padR;
    var sy = function (v) { return (v / max) * plotH; };
    for (var t = 0; t <= 4; t++) {
      var gy = top + plotH - sy(max * t / 4);
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: t === 0 ? '#c9d3c1' : GRID, 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: padL - 8, y: gy + 4, 'text-anchor': 'end', 'font-size': 11, fill: INK3 }, short(max * t / 4)));
    }
    var groupW = plotW / data.musim.length;
    var barW = Math.min(44, (groupW * 0.62) / js.length);
    data.musim.forEach(function (m, i) {
      var cx = padL + groupW * i + groupW / 2;
      var startX = cx - (barW * js.length + 2 * (js.length - 1)) / 2;
      js.forEach(function (j, k) {
        var r = data.perMusim.find(function (row) { return row.musim === m && row.jenis === j; });
        if (!r) return;
        var h = Math.max(1, sy(r.kg));
        var x = startX + k * (barW + 2);
        var bar = anim(el('path', { d: barPath(x, top + plotH - h, barW, h, 'v'), fill: color(j) }), 'rv-grow-y', 320 + i * 120 + k * 60);
        hover(bar, '<strong>' + m + '</strong>' + tipRow(j, r.kg), m + ', ' + nama(j) + ': ' + fmt(r.kg) + ' kilogram');
        svg.appendChild(bar);
        // Label angka hanya bila muat; di layar sempit pakai format ringkas, detail lengkap ada di tooltip & tabel.
        var label = barW >= 34 ? fmt(r.kg) : short(r.kg);
        if (barW >= 22) svg.appendChild(anim(el('text', { x: x + barW / 2, y: top + plotH - h - 6, 'text-anchor': 'middle', 'font-size': barW < 34 ? 10 : 11, 'font-weight': 650, fill: INK2, 'pointer-events': 'none' }, label), 'rv-fade', 900 + i * 120 + k * 60));
      });
      svg.appendChild(el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 650, fill: INK }, m));
    });
    host.replaceChildren(svg);
  }

  // ---------- 3. Peta panas: jenis × musim (satu hue, terang → gelap) ----------
  function mix(a, b, t) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); });
    var pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); });
    return 'rgb(' + pa.map(function (v, i) { return Math.round(v + (pb[i] - v) * t); }).join(',') + ')';
  }
  function chartHeatmap(host) {
    var js = visibleJenis();
    var W = host.clientWidth, padL = 64, top = 24, cellH = 46, gap = 2;
    var H = top + js.length * (cellH + gap) + 4;
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    var vals = data.perMusim.map(function (r) { return r.kg; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var cellW = (W - padL - gap * (data.musim.length - 1)) / data.musim.length;
    data.musim.forEach(function (m, i) {
      svg.appendChild(el('text', { x: padL + i * (cellW + gap) + cellW / 2, y: 14, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 650, fill: INK }, m));
    });
    js.forEach(function (j, r) {
      var y = top + r * (cellH + gap);
      svg.appendChild(el('text', { x: padL - 10, y: y + cellH / 2 + 4, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 650, fill: INK }, nama(j)));
      data.musim.forEach(function (m, i) {
        var row = data.perMusim.find(function (x) { return x.musim === m && x.jenis === j; });
        var v = row ? row.kg : 0;
        var t = hi > lo ? (v - lo) / (hi - lo) : 1;
        var fill = mix('#e7f2df', '#1e5631', 0.12 + t * 0.88);
        var x = padL + i * (cellW + gap);
        var cell = anim(el('rect', { x: x, y: y, width: cellW, height: cellH, rx: 6, fill: fill }), 'rv-pop', 400 + (r + i) * 90);
        hover(cell, '<strong>' + nama(j) + ' · ' + m + '</strong><span class="rdkk-tip-row">Kebutuhan<b>' + fmt(v) + ' kg</b></span>', nama(j) + ' ' + m + ': ' + fmt(v) + ' kilogram');
        svg.appendChild(cell);
        svg.appendChild(anim(el('text', { x: x + cellW / 2, y: y + cellH / 2 + 5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: t > 0.45 ? '#fff' : INK, 'pointer-events': 'none' }, fmt(v)), 'rv-fade', 560 + (r + i) * 90));
      });
    });
    host.replaceChildren(svg);
  }

  var RENDER = { kelompok: chartKelompok, musim: chartMusim, heatmap: chartHeatmap };
  function renderAll() {
    hideTip();
    legend();
    root.querySelectorAll('[data-chart]').forEach(function (host) { RENDER[host.getAttribute('data-chart')](host); });
  }

  // Filter jenis pupuk (warna tidak berubah saat jumlah seri berkurang).
  var filter = root.querySelector('[data-rdkk-filter]');
  filter.hidden = false;
  filter.addEventListener('click', function (e) {
    var b = e.target.closest('[data-jenis]');
    if (!b) return;
    selected = b.getAttribute('data-jenis');
    filter.querySelectorAll('[data-jenis]').forEach(function (x) {
      var on = x === b;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderAll();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });

  renderAll();
  var lastW = root.clientWidth;
  if (window.ResizeObserver) {
    new ResizeObserver(function () { if (Math.abs(root.clientWidth - lastW) > 4) { lastW = root.clientWidth; renderAll(); } }).observe(root);
  }
})();
