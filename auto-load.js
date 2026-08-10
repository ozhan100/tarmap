// =====================================================================
//  TarMap Otomatik Veri Yükleme (auto-load.js)
//  Amaç: Program açıldığında en son kullanılan klasörü (varsayılan
//  "Downloads") tarar. Parçalı dosyaları (GML + Parsel Excel/CSV + Çiftçi
//  Excel) bulur ve otomatik birleştirir. Hiçbir şey bulamazsa manuel akış
//  korunur.
//
//  Not: Tarayıcı güvenliği nedeniyle arka planda otomatik tarama
//  imkansızdır. İlk açılışta kullanıcıdan klasör izni istenir
//  (showDirectoryPicker). Seçilen klasör IndexedDB'ye kaydedilir ve
//  sonraki açılışlarda sessizce kullanılır. Yalnızca Chromium
//  tarayıcılarda (Chrome, Edge, Android Chrome) çalışır.
// =====================================================================

(function () {
    // her güncellemeden sonra 0.0.1 arttırılsın
    const AUTO_LOAD_VERSION = "1.0.1";

    // ── IndexedDB yardımcıları (klasör handle saklamak için) ──────────
    const DB_NAME = "tarmap_auto_load_db";
    const DB_STORE = "handles";

    function idbOpen() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(DB_STORE)) {
                    req.result.createObjectStore(DB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveHandle(key, handle) {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(handle, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadHandle(key) {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readonly');
            const req = tx.objectStore(DB_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    // ── Kayıtlı klasörü izinle birlikte al veya yeni seçtir ──────────
    async function getDirectoryHandle() {
        let dirHandle = await loadHandle('lastDir');

        if (dirHandle) {
            try {
                let perm = await dirHandle.queryPermission({ mode: 'read' });
                if (perm !== 'granted') {
                    perm = await dirHandle.requestPermission({ mode: 'read' });
                }
                if (perm === 'granted') return dirHandle;
            } catch (e) {
                // Kayıtlı handle geçersiz olabilir; yeni seçtirilecek
            }
        }

        if (!window.showDirectoryPicker) return null;

        try {
            // Varsayılan olarak "Downloads / İndirilenler" açılır
            dirHandle = await window.showDirectoryPicker({ startIn: 'downloads' });
            await saveHandle('lastDir', dirHandle);
            return dirHandle;
        } catch (e) {
            // Kullanıcı iptal etti
            return null;
        }
    }

    // ── Klasördeki dosyaları topla ────────────────────────────────────
    async function listFilesInDirectory(dirHandle) {
        const files = [];
        try {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file') files.push(entry);
            }
        } catch (e) {
            console.warn('Klasör okunamadı:', e);
        }
        return files;
    }

    // ── TarMap dosya eşleştirme ───────────────────────────────────────
    async function autoLoadFromDownloads() {
        if (!window.showDirectoryPicker) {
            console.log('ℹ️ Bu tarayıcı klasör taramasını desteklemiyor. Manuel yükleme kullanılacak.');
            return false;
        }

        const dirHandle = await getDirectoryHandle();
        if (!dirHandle) return false;

        const files = await listFilesInDirectory(dirHandle);
        if (files.length === 0) {
            console.log('ℹ️ Seçili klasörde dosya bulunamadı.');
            return false;
        }

        const name = (h) => h.name.toLowerCase();

        // 1) Parçalı dosyaları ara: GML/XML + Parsel Excel/CSV (+ Çiftçi Excel)
        const gmlHandle = files.find(h => /\.(gml|xml)$/.test(name(h)));
        const csvHandle = files.find(h =>
            /\.(csv|xlsx|xls)$/.test(name(h)) &&
            !/ciftci|çiftçi/i.test(name(h))
        );
        const excelHandle = files.find(h =>
            /\.(xlsx|xls)$/.test(name(h)) &&
            /ciftci|çiftçi/i.test(name(h))
        );

        if (gmlHandle && csvHandle) {
            return await mergeAndLoad(gmlHandle, csvHandle, excelHandle);
        }

        console.log('ℹ️ Klasörde uygun TarMap verisi bulunamadı. Manuel yükleme kullanın.');
        return false;
    }

    // Parçalı dosyaları birleştir
    async function mergeAndLoad(gmlHandle, csvHandle, excelHandle) {
        try {
            selectedFiles.gml = await gmlHandle.getFile();
            selectedFiles.csv = await csvHandle.getFile();
            selectedFiles.excel = excelHandle ? await excelHandle.getFile() : null;

            showLoading('Veriler birleştiriliyor...');

            const progressCb = (pct, msg) => {
                const loadingTextEl = document.getElementById('loading-text');
                if (loadingTextEl) loadingTextEl.textContent = msg;
            };

            masterRecords = await buildMasterData(progressCb);
            renderFromMasterData(masterRecords);
            hideLoading();
            alert(`✅ Otomatik birleştirildi: ${masterRecords.length} parsel`);
            return true;
        } catch (err) {
            console.error('Otomatik birleştirme hatası:', err);
            hideLoading();
        }
        return false;
    }

    function showLoading(msg) {
        const el = document.getElementById('loading-overlay');
        const t = document.getElementById('loading-text');
        if (t) t.textContent = msg || 'Yükleniyor...';
        if (el) el.classList.remove('hidden');
    }
    function hideLoading() {
        const el = document.getElementById('loading-overlay');
        if (el) el.classList.add('hidden');
    }

    // Dışarı aç: app.js showApp() içinden çağrılır
    window.autoLoadFromDownloads = autoLoadFromDownloads;
    window.AUTO_LOAD_VERSION = AUTO_LOAD_VERSION;
})();
