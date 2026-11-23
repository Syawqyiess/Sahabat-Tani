-- Foto lahan milik petani (disimpan privat di folder unggahan, diakses lewat /media dengan cek pemilik).
-- Kolom commodity yang sudah ada dipakai sebagai "Jenis Tanaman"; kolom variety tetap tersimpan.
ALTER TABLE lands ADD COLUMN photo_path TEXT;
