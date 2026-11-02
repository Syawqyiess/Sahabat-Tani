"""Definisi kelas model scanner hama padi.

Kelas 0-13 = 14 hama padi pertama dari IP102 (classes.txt, indeks 1-14).
Kelas 14   = "bukan_hama_padi": contoh serangga lain dari IP102 agar model bisa menolak
             serangga yang bukan hama padi (bukan jaminan untuk foto non-serangga).
Nama Indonesia mengikuti istilah umum; nama ilmiah dicantumkan bila sudah lazim.
"""

# (indeks_ip102_0based, kunci, nama_indonesia, nama_ilmiah, nama_inggris_ip102)
RICE_CLASSES = [
    (0, "penggulung_daun", "Hama putih palsu (penggulung daun)", "Cnaphalocrocis medinalis", "rice leaf roller"),
    (1, "ulat_daun_padi", "Ulat daun padi (rice leaf caterpillar)", "", "rice leaf caterpillar"),
    (2, "belatung_batang_padi", "Belatung batang padi (paddy stem maggot)", "", "paddy stem maggot"),
    (3, "penggerek_batang_asia", "Penggerek batang padi bergaris", "Chilo suppressalis", "asiatic rice borer"),
    (4, "penggerek_batang_kuning", "Penggerek batang padi kuning", "Scirpophaga incertulas", "yellow rice borer"),
    (5, "ganjur", "Ganjur (hama gall midge)", "Orseolia oryzae", "rice gall midge"),
    (6, "lalat_batang_padi", "Lalat batang padi (rice stem fly)", "", "Rice Stemfly"),
    (7, "wereng_batang_cokelat", "Wereng batang cokelat", "Nilaparvata lugens", "brown plant hopper"),
    (8, "wereng_punggung_putih", "Wereng punggung putih", "Sogatella furcifera", "white backed plant hopper"),
    (9, "wereng_cokelat_kecil", "Wereng cokelat kecil", "Laodelphax striatellus", "small brown plant hopper"),
    (10, "kumbang_air_padi", "Kumbang air padi", "Lissorhoptrus oryzophilus", "rice water weevil"),
    (11, "wereng_daun", "Wereng daun padi (rice leafhopper)", "", "rice leafhopper"),
    (12, "thrips_padi", "Thrips padi (grain spreader thrips)", "", "grain spreader thrips"),
    (13, "hama_kulit_gabah", "Hama kulit gabah (rice shell pest)", "", "rice shell pest"),
]

OTHER_KEY = "bukan_hama_padi"
OTHER_NAME = "Bukan hama padi (serangga lain)"

CLASS_KEYS = [c[1] for c in RICE_CLASSES] + [OTHER_KEY]
IP102_TO_KEY = {c[0]: c[1] for c in RICE_CLASSES}


def labels_metadata():
    out = [
        {"key": k, "name_id": n, "scientific": s, "ip102_name": e, "is_rice_pest": True}
        for (_, k, n, s, e) in RICE_CLASSES
    ]
    out.append({"key": OTHER_KEY, "name_id": OTHER_NAME, "scientific": "", "ip102_name": "classes 15-102 (sampel)", "is_rice_pest": False})
    return out
