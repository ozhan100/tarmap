# Tarla Takip Sistemi Kullanım Kılavuzu

Bu uygulama, tarlalarınızın sınırlarını GML dosyalarından okuyarak Google Haritalar üzerinde gösterir ve CSV dosyasındaki mülkiyet bilgilerini bu sınırlarla eşleştirir.

## Ana Özellikler

- **🔒 Güvenli Giriş**: KVKK uyumluluğu için şifreli giriş ekranı. (Varsayılan Şifre: `1234`)
- **🌍 Hibrit Harita**: Google Maps hibrit katmanı ile hem uydu görüntüsü hem de yol bilgilerini bir arada görün.
- **🛰️ Canlı Konum**: Tarlada gezerken kendi konumunuzu mavi bir nokta olarak görün.
- **📊 Parsel Bilgileri**: Herhangi bir parselin üzerine tıklayarak sahibini, ekili ürünü ve alan bilgilerini inceleyin.
- **📏 Ölçüm Araçları**: Mesafe (m) ve Alan (m² / dönüm) ölçümü yapın.

## Kurulum ve Çalıştırma

1. **Google Maps API Anahtarı**: Uygulamayı ilk açtığınızda bir Google Maps API anahtarı girmeniz istenecektir. Bu anahtarı [Google Cloud Console](https://console.cloud.google.com/) üzerinden alabilirsiniz.
2. **Dosya Yapısı**: `Halhalca.csv` ve `Halhalca.gml` dosyaları uygulamanın ana dizininde bulunmalıdır.
3. **GitHub Pages**: Bu klasörü GitHub'a yükleyip GitHub Pages üzerinden yayınlayabilirsiniz.

## Teknik Detaylar

- **Veri Eşleme**: GML içerisindeki `AdaNo` ve `ParselNo` değerleri, CSV dosyasındaki aynı sütunlarla eşleştirilir.
- **GML Ayrıştırma**: Tarayıcı tabanlı XML ayrıştırıcı kullanılarak koordinatlar EPSG:4326 formatında okunur.
- **Görsel Tasarım**: Glassmorphism (cam efekti) ve koyu tema kullanılarak modern bir arayüz oluşturulmuştur.
