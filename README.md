# Tarla Takip Sistemi Kullanım Kılavuzu

Bu uygulama, tarlalarınızın sınırlarını GML dosyalarından okuyarak Google Haritalar üzerinde gösterir ve CSV dosyasındaki mülkiyet bilgilerini bu sınırlarla eşleştirir.

## Ana Özellikler

- **🔒 Güvenli Giriş**: Şifreli giriş ekranı ile yetkili kullanıcılar uygulamayı kullanabilir.
- **🌍 Hibrit Harita**: Google Maps hibrit katmanı ile hem uydu görüntüsü hem de yol bilgilerini bir arada görün.
- **🛰️ Canlı Konum**: Tarlada gezerken kendi konumunuzu mavi bir nokta olarak görün.
- **📊 Parsel Bilgileri**: Herhangi bir parselin üzerine tıklayarak sahibini, ekili ürünü ve alan bilgilerini inceleyin.
- **📏 Ölçüm Araçları**: Mesafe (m) ve Alan (m² / dönüm) ölçümü yapın.

## Kurulum ve Çalıştırma

1. **Dosya Yükleme**: Uygulama, GML ve Excel/CSV dosyalarınızı cihazınızda işler. Dosyalar sunucuya yüklenmez.
2. **GitHub Pages**: Bu klasörü GitHub'a yükleyip GitHub Pages üzerinden yayınlayabilirsiniz.

## KVKK / Veri Güvenliği

Bu uygulama kişisel verileri sunuculara aktarmaz. Excel/GML dosyaları yalnızca kullanıcının cihazında işlenir ve tarayıcının geçici belleğinde tutulur; sayfa kapatıldığında veriler silinir. Giriş ekranı yalnızca yetkilendirme amaçlıdır; uygulama kodu veya barındırma ortamında kişisel veri bulundurulmaz.

## Teknik Detaylar

- **Veri Eşleme**: GML içerisindeki `AdaNo` ve `ParselNo` değerleri, CSV dosyasındaki aynı sütunlarla eşleştirilir.
- **GML Ayrıştırma**: Tarayıcı tabanlı XML ayrıştırıcı kullanılarak koordinatlar EPSG:4326 formatında okunur.
- **Görsel Tasarım**: Glassmorphism (cam efekti) ve koyu tema kullanılarak modern bir arayüz oluşturulmuştur.
