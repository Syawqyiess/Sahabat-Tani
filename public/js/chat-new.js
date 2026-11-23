// Percakapan Baru: contoh pertanyaan mengisi kolom pesan, lampiran foto, dan draf yang tidak hilang
// saat petani berpindah halaman (disimpan di sessionStorage tab ini saja, terhapus saat tab ditutup).
(function () {
  'use strict';
  var form = document.getElementById('new-composer');
  if (!form) return;
  var textarea = form.querySelector('textarea');
  var input = form.querySelector('[data-attach]');
  var prev = form.querySelector('[data-attach-preview]');
  var msg = form.querySelector('[data-composer-msg]');
  var KEY = 'sahabat-tani:draf-percakapan-baru';
  var submitting = false;

  function store(fn) { try { return fn(window.sessionStorage); } catch (e) { return null; } }
  function setMsg(t) { msg.textContent = t || ''; msg.hidden = !t; }
  function autosize() { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px'; }

  // Pulihkan draf (kecuali server mengembalikan teks karena galat validasi).
  if (!textarea.value) {
    var saved = store(function (s) { return s.getItem(KEY); });
    if (saved) textarea.value = saved;
  }
  autosize();
  textarea.addEventListener('input', function () {
    autosize();
    store(function (s) { if (textarea.value.trim()) s.setItem(KEY, textarea.value); else s.removeItem(KEY); });
  });

  document.querySelectorAll('[data-starter]').forEach(function (b) {
    b.addEventListener('click', function () {
      textarea.value = b.getAttribute('data-starter');
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  });

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

  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }
  });

  form.addEventListener('submit', function (e) {
    if (submitting) { e.preventDefault(); return; }
    if (!textarea.value.trim() && !input.files[0]) { e.preventDefault(); setMsg('Tulis pertanyaan atau lampirkan foto terlebih dahulu.'); textarea.focus(); return; }
    submitting = true;
    store(function (s) { s.removeItem(KEY); });
  });

  // Foto terlampir tidak bisa disimpan sebagai draf: ingatkan sebelum halaman ditinggalkan.
  window.addEventListener('beforeunload', function (e) {
    if (!submitting && input.files[0]) { e.preventDefault(); e.returnValue = ''; }
  });
})();
