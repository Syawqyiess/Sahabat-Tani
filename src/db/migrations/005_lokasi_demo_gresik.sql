-- Pindahkan lokasi lahan & profil demo ke Desa Mojopuro Wetan, Kec. Bungah, Kab. Gresik, Jawa Timur.
-- Petak contoh dipilih dari citra satelit di hamparan sawah ±1 km utara Balai Desa (bukan batas lahan asli).
-- Hanya mengubah data yang masih berlabel demo / masih berisi nilai contoh lama; data asli petani tidak disentuh.
UPDATE lands SET lat = -7.0253, lng = 112.5285,
  polygon_json = '[[-7.02498,112.52817],[-7.02498,112.52882],[-7.02562,112.52882],[-7.02562,112.52817]]',
  address_desc = 'Hamparan sawah utara permukiman Desa Mojopuro Wetan, Bungah, Gresik — lokasi contoh, bukan lahan asli',
  updated_at = datetime('now')
 WHERE data_source = 'demo' AND name = 'Sawah Blok A (Demo)';
UPDATE lands SET lat = -7.0269, lng = 112.5358,
  polygon_json = '[[-7.02662,112.53551],[-7.02662,112.53607],[-7.02717,112.53607],[-7.02717,112.53551]]',
  address_desc = 'Sawah sebelah timur Blok A, Desa Mojopuro Wetan, Bungah, Gresik — lokasi contoh, bukan lahan asli',
  updated_at = datetime('now')
 WHERE data_source = 'demo' AND name = 'Sawah Blok B (Demo)';
UPDATE farmer_profiles SET village = 'Desa Mojopuro Wetan', district = 'Kecamatan Bungah', regency = 'Kabupaten Gresik', province = 'Jawa Timur',
  updated_at = datetime('now')
 WHERE village = 'Desa Contoh Makmur' AND regency = 'Kabupaten Karawang'
   AND user_id IN (SELECT id FROM users WHERE is_demo = 1);
