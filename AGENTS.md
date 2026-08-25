# AGENTS.md - TarMap

## Güncelleme Kuralları

Her güncelleme sonrasında `app.js` dosyasındaki `APP_VERSION` sabiti **0.01** arttırılmalıdır.

Mevcut konum (`app.js` satır 1-4):
```
// her güncellemeden sonra APP_VERSION 0.01 arttırılsın
const APP_NAME = "TarMap";
const APP_VERSION = "3.01";
```

## Nereler Güncellenmeli?

1. `app.js` → `APP_VERSION` sabiti (0.01 artır)
2. `index.html` → Versiyon etiketleri (`login-version`, `header-version`) güncellenmeli
3. `manifest.json` → Versiyon bilgisi güncellenmeli

## Test

Değişiklik sonrası:
- Tarayıcı önbelleğini temizle (Ctrl+Shift+R)
- Giriş ekranında ve üst banner'da yeni versiyon numarasını doğrula
