// Chatroom: lampiran foto, status pesan (mengirim/gagal), indikator AI merespons, posisi baca terjaga.
(function () {
  'use strict';
  var form = document.getElementById('composer');
  if (!form) return;
  form.dataset.js = 'custom';
  var input = form.querySelector('[data-attach]');
  var prev = form.querySelector('[data-attach-preview]');
  var msg = form.querySelector('[data-composer-msg]');
  var textarea = form.querySelector('textarea');
  var list = document.querySelector('[data-messages]');
  var jump = document.querySelector('[data-jump]');
  var end = document.getElementById('akhir');
  var busy = false;

  function setMsg(t) { msg.textContent = t || ''; msg.hidden = !t; }
  function nearBottom() { return end.getBoundingClientRect().top - window.innerHeight < 260; }
  function toBottom(smooth) { end.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' }); }

  // Saat halaman dibuka: tampilkan pesan terbaru (kecuali percakapan baru yang masih pendek).
  if (location.hash === '#akhir' || list.children.length > 3) toBottom(false);

  // Tidak memaksa gulir: tombol "Pesan terbaru" muncul bila petani sedang membaca pesan lama.
  var onScroll = function () { jump.hidden = nearBottom(); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  jump.addEventListener('click', function () { toBottom(true); });

  // ---------- Lampiran foto ----------
  input.addEventListener('change', function () {
    setMsg('');
    var f = input.files[0];
    if (!f) { prev.hidden = true; return; }
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(f.type) === -1) { setMsg('Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.'); input.value = ''; return; }
    if (f.size > 8 * 1048576) { setMsg('Ukuran foto terlalu besar. Maksimal 8 MB.'); input.value = ''; return; }
    prev.querySelector('img').src = URL.createObjectURL(f);
    prev.hidden = false;
  });
  form.querySelector('[data-attach-clear]').addEventListener('click', function () { input.value = ''; prev.hidden = true; textarea.focus(); });

  // Tinggi textarea mengikuti isi; Enter mengirim di desktop, Shift+Enter baris baru.
  textarea.addEventListener('input', function () { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px'; });
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  // ---------- Kirim ----------
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function userBubble(text, file) {
    var li = el('li', 'msg msg-user is-sending');
    var bub = el('div', 'bubble');
    if (file) { var img = el('img', 'msg-img'); img.src = URL.createObjectURL(file); img.alt = 'Foto yang dikirim'; bub.appendChild(img); }
    bub.appendChild(el('p', 'pre', text || 'Foto tambahan'));
    var foot = el('div', 'msg-foot');
    var st = el('span', 'msg-status', 'Mengirim…');
    foot.appendChild(st);
    bub.appendChild(foot);
    li.appendChild(bub);
    list.appendChild(li);
    return { li: li, status: st, foot: foot };
  }
  function typing() {
    var li = el('li', 'msg msg-assistant');
    li.setAttribute('role', 'status');
    li.innerHTML = '<span class="msg-avatar" aria-hidden="true"></span><div class="bubble"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span> <span class="small muted">Asisten sedang menyiapkan jawaban…</span></div>';
    list.appendChild(li);
    return li;
  }

  function send(fd, file) {
    if (busy) return;
    busy = true;
    setMsg('');
    form.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    document.querySelectorAll('.quick-form button').forEach(function (b) { b.disabled = true; });
    var mine = userBubble(fd.get('message'), file);
    var dots = null;
    toBottom(true);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', form.action);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-CSRF-Token', document.querySelector('meta[name=csrf-token]').content);
    // Pesan sudah sampai di server → tampilkan indikator AI sedang merespons.
    xhr.upload.onload = function () { mine.status.textContent = 'Terkirim'; mine.li.classList.remove('is-sending'); dots = typing(); toBottom(true); };
    xhr.onload = function () {
      var d = {};
      try { d = JSON.parse(xhr.responseText); } catch (e) { /* abaikan */ }
      if (xhr.status >= 400 && !d.redirect) return fail(d.error || 'Pesan gagal dikirim.');
      // Muat ulang agar jawaban (atau status gagalnya) tampil dari server.
      location.replace(location.pathname + '?t=' + Date.now() + '#akhir');
    };
    xhr.onerror = function () { fail('Koneksi terputus. Pesan belum terkirim.'); };
    xhr.send(fd);

    function fail(text) {
      busy = false;
      if (dots) dots.remove();
      form.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      document.querySelectorAll('.quick-form button').forEach(function (b) { b.disabled = false; });
      mine.li.classList.remove('is-sending');
      mine.li.classList.add('is-failed');
      mine.status.textContent = text + ' ';
      var again = el('button', 'link-btn', 'Coba lagi');
      again.type = 'button';
      again.addEventListener('click', function () { mine.li.remove(); send(fd, file); });
      mine.foot.appendChild(again);
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var file = input.files[0] || null;
    if (!String(fd.get('message') || '').trim() && !file) { setMsg('Tulis pesan atau lampirkan foto terlebih dahulu.'); textarea.focus(); return; }
    send(fd, file);
    textarea.value = ''; textarea.style.height = 'auto';
    input.value = ''; prev.hidden = true;
  });

  // Tombol pertanyaan cepat memakai alur yang sama.
  document.querySelectorAll('.quick-form').forEach(function (qf) {
    qf.dataset.js = 'custom';
    qf.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(qf);
      fd.set('message', e.submitter ? e.submitter.value : qf.querySelector('button').value);
      send(fd, null);
    });
  });
})();
