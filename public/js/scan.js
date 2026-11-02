// Scanner hama: kamera / galeri / seret-lepas → pratinjau → analisis → otomatis ke chatroom.
(function () {
  'use strict';
  var form = document.getElementById('scan-form');
  if (!form) return;
  form.dataset.js = 'custom'; // ditangani di sini, bukan oleh app.js

  var MAX_BYTES = Number(form.dataset.maxBytes);
  var MAX_DIM = 1600; // perkecil foto agar ringan di koneksi terbatas
  var ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  var $ = function (sel) { return form.querySelector(sel); };
  var steps = { pick: $('[data-step=pick]'), camera: $('[data-step=camera]'), preview: $('[data-step=preview]') };
  var stepper = document.querySelector('[data-stepper]');
  var galleryInput = $('[data-input=gallery]');
  var captureInput = $('[data-input=capture]');
  var video = steps.camera.querySelector('video');
  var pickMsg = $('[data-msg=pick]');
  var overlay = $('[data-overlay]');
  var stream = null;
  var photoBlob = null;
  var photoUrl = null;
  var lastSource = 'gallery';
  var busy = false;
  var lastScanId = null;

  // ---------- Tampilan langkah ----------
  function setStep(name) {
    var order = ['pick', 'check', 'analyze'];
    var idx = order.indexOf(name);
    stepper.querySelectorAll('li').forEach(function (li, i) {
      li.classList.toggle('is-current', i === idx);
      li.classList.toggle('is-done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  function show(name) {
    steps.pick.hidden = name !== 'pick';
    steps.camera.hidden = name !== 'camera';
    steps.preview.hidden = name !== 'preview';
    setStep(name === 'preview' ? 'check' : 'pick');
  }
  function setPickMsg(text) { pickMsg.textContent = text || ''; pickMsg.hidden = !text; }

  // ---------- Kamera ----------
  function stopCamera() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
  }
  function cameraFallback(reason) {
    setPickMsg(reason + ' Membuka kamera bawaan ponsel, atau pilih foto dari galeri.');
    show('pick');
    captureInput.click(); // di ponsel membuka aplikasi kamera bawaan
  }
  function openCamera() {
    setPickMsg('');
    lastSource = 'camera';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return cameraFallback('Browser ini tidak mendukung kamera langsung.');
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        show('camera');
        $('[data-action=shoot]').focus();
      })
      .catch(function (err) {
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          setPickMsg('Izin kamera ditolak. Izinkan akses kamera di pengaturan browser, atau gunakan “Pilih dari Galeri”.');
          show('pick');
        } else if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
          cameraFallback('Perangkat ini tidak memiliki kamera yang dapat dipakai.');
        } else {
          cameraFallback('Kamera tidak dapat dibuka.');
        }
      });
  }
  function shoot() {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    var scale = Math.min(1, MAX_DIM / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    stopCamera();
    c.toBlob(function (blob) { usePhoto(blob, c); }, 'image/jpeg', 0.85);
  }

  // ---------- Berkas dari galeri / kamera bawaan / seret-lepas ----------
  function handleFile(file) {
    setPickMsg('');
    if (!file) return;
    if (ALLOWED.indexOf(file.type) === -1) {
      setPickMsg('Format berkas tidak didukung. Gunakan foto JPG, PNG, atau WEBP.');
      show('pick');
      return;
    }
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (blob) {
        if (!blob) {
          if (file.size > MAX_BYTES) return setPickMsg('Ukuran foto terlalu besar. Maksimal ' + Math.round(MAX_BYTES / 1048576) + ' MB.');
          blob = file;
        }
        usePhoto(blob, c);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      setPickMsg('Berkas tidak dapat dibuka sebagai gambar. Coba foto lain.');
    };
    img.src = url;
  }

  // ---------- Pemeriksaan kualitas sederhana di perangkat ----------
  function assess(canvas) {
    var notes = [];
    var w = Math.min(canvas.width, 320);
    var h = Math.round(canvas.height * (w / canvas.width));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data;
    var gray = new Float32Array(w * h), sum = 0;
    for (var i = 0; i < w * h; i++) { gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += gray[i]; }
    var mean = sum / (w * h);
    var lsum = 0, lsq = 0, n = 0;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var k = y * w + x;
      var lap = gray[k - w] + gray[k + w] + gray[k - 1] + gray[k + 1] - 4 * gray[k];
      lsum += lap; lsq += lap * lap; n++;
    }
    var lapVar = lsq / n - Math.pow(lsum / n, 2);
    if (canvas.width < 480 || canvas.height < 480) notes.push(['warn', 'Resolusi foto rendah. Dekatkan kamera atau gunakan foto lain.']);
    if (mean < 55) notes.push(['warn', 'Foto tampak gelap. Ambil di tempat lebih terang.']);
    if (mean > 220) notes.push(['warn', 'Foto tampak terlalu terang.']);
    if (lapVar < 60) notes.push(['warn', 'Foto mungkin buram. Pastikan kamera fokus sebelum memotret.']);
    if (!notes.length) notes.push(['ok', 'Foto terlihat cukup terang dan tajam.']);
    return notes;
  }

  function usePhoto(blob, canvas) {
    if (blob.size > MAX_BYTES) { setPickMsg('Ukuran foto terlalu besar. Maksimal ' + Math.round(MAX_BYTES / 1048576) + ' MB.'); show('pick'); return; }
    photoBlob = blob;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(blob);
    $('[data-preview]').src = photoUrl;
    var list = $('[data-quality]');
    list.innerHTML = '';
    try {
      assess(canvas).forEach(function (n) {
        var li = document.createElement('li');
        li.className = n[0] === 'ok' ? 'q-ok' : 'q-warn';
        li.textContent = n[1];
        list.appendChild(li);
      });
    } catch (e) { /* pemeriksaan opsional */ }
    show('preview');
    steps.preview.querySelector('h2').setAttribute('tabindex', '-1');
    steps.preview.querySelector('h2').focus({ preventScroll: true });
    steps.preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Status proses (mengikuti kejadian nyata) ----------
  function setStatus(active) {
    var order = ['upload', 'ai', 'chat'];
    var idx = order.indexOf(active);
    overlay.querySelectorAll('[data-st]').forEach(function (li) {
      var i = order.indexOf(li.dataset.st);
      li.classList.toggle('is-active', i === idx);
      li.classList.toggle('is-done', i < idx);
    });
  }
  function showOverlay(mode, msg, chatUrl) {
    overlay.hidden = false;
    form.classList.toggle('is-busy', mode === 'busy');
    $('[data-ov-photo]').src = photoUrl || '';
    overlay.querySelector('[data-ov=busy]').hidden = mode !== 'busy';
    overlay.querySelector('[data-ov=fail]').hidden = mode !== 'fail';
    if (msg) overlay.querySelector('[data-ov-msg]').textContent = msg;
    var chatLink = overlay.querySelector('[data-ov-chat]');
    chatLink.hidden = !chatUrl;
    if (chatUrl) chatLink.href = chatUrl;
    if (mode === 'fail') overlay.querySelector('[data-action=retry]').focus();
    else overlay.querySelector('.overlay-card').focus();
  }
  function closeOverlay() {
    overlay.hidden = true;
    form.classList.remove('is-busy');
    busy = false;
    $('[data-action=analyze]').focus();
  }

  function send(url, body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-CSRF-Token', document.querySelector('meta[name=csrf-token]').content);
      // Unggahan selesai → server mulai menganalisis.
      xhr.upload.onload = function () { setStatus('ai'); };
      xhr.onload = function () {
        var data;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = { error: 'Server memberikan respons yang tidak terduga.' }; }
        data.status = xhr.status;
        resolve(data);
      };
      xhr.onerror = function () { reject(new Error('network')); };
      xhr.ontimeout = function () { reject(new Error('timeout')); };
      xhr.timeout = 180000;
      xhr.send(body);
    });
  }

  function handleResult(data) {
    if (data.scanId) lastScanId = data.scanId;
    if (data.ok && data.redirect) {
      setStatus('chat');
      setStep('analyze');
      location.href = data.redirect; // transisi halaman lembut via View Transitions (bila didukung)
      return;
    }
    busy = false;
    if (data.redirect) showOverlay('fail', data.error || 'Layanan analisis sedang bermasalah.', data.redirect);
    else showOverlay('fail', data.error || 'Terjadi kesalahan.', null);
  }
  function networkFail() {
    busy = false;
    showOverlay('fail', 'Koneksi terputus. Periksa internet lalu tekan “Coba Lagi”. Foto tidak akan tersimpan dua kali.', null);
  }

  function submit() {
    if (busy) return;
    if (!photoBlob) {
      setPickMsg('Belum ada foto. Ambil foto atau pilih dari galeri terlebih dahulu.');
      show('pick');
      steps.pick.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    busy = true;
    setStep('analyze');
    showOverlay('busy');
    setStatus('upload');
    var fd = new FormData(form);
    fd.delete('photo');
    fd.append('photo', photoBlob, 'scan.' + (photoBlob.type === 'image/png' ? 'png' : photoBlob.type === 'image/webp' ? 'webp' : 'jpg'));
    // Kunci idempoten yang sama dipakai saat "Coba Lagi" setelah koneksi putus.
    send(form.action, fd).then(handleResult).catch(networkFail);
  }

  function retry() {
    if (busy) return;
    if (!lastScanId) return submit();
    busy = true;
    showOverlay('busy');
    setStatus('ai');
    var body = new URLSearchParams({ _csrf: form.querySelector('[name=_csrf]').value });
    fetch('/scan/' + lastScanId + '/ulang', {
      method: 'POST', body: body, credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content },
    }).then(function (r) { return r.json(); }).then(handleResult).catch(networkFail);
  }

  // ---------- Event ----------
  form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  form.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action]');
    if (!b) return;
    var a = b.getAttribute('data-action');
    if (a === 'camera') openCamera();
    else if (a === 'shoot') shoot();
    else if (a === 'cancel-camera') { stopCamera(); show(photoBlob ? 'preview' : 'pick'); }
    else if (a === 'retake') { if (lastSource === 'camera') openCamera(); else galleryInput.click(); }
    else if (a === 'replace') { lastSource = 'gallery'; galleryInput.click(); }
    else if (a === 'retry') retry();
    else if (a === 'close-ov') closeOverlay();
  });
  overlay.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !busy) closeOverlay();
  });
  galleryInput.addEventListener('change', function () { lastSource = 'gallery'; handleFile(galleryInput.files[0]); });
  captureInput.addEventListener('change', function () { lastSource = 'camera'; handleFile(captureInput.files[0]); });

  // Seret-lepas (desktop)
  var dz = $('[data-dropzone]');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { lastSource = 'gallery'; handleFile(f); }
  });

  window.addEventListener('pagehide', stopCamera);
})();
