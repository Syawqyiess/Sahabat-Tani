// Dimuat sinkron di <head> (tanpa defer): menandai bahwa JavaScript aktif sebelum halaman digambar,
// agar keadaan awal animasi hanya berlaku bila JS memang berjalan (tanpa JS, konten langsung tampil).
document.documentElement.classList.add('js');
