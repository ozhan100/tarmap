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
    const AUTO_LOAD_VERSION = "1.1.0";

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

    // ── Dosya seçim yardımcıları ──────────────────────────────────────
    // Aynı türden birden fazla dosya varsa en yenisi önerilir; yine de
    // kullanıcıya seçtirilir (rastgele yükleme → harita karışması önlenir).
    async function lastModifiedOf(handle) {
        try {
            const f = await handle.getFile();
            return f.lastModified || 0;
        } catch (e) {
            return 0;
        }
    }

    async function sortNewest(candidates) {
        const dated = await Promise.all(candidates.map(async (h) => ({
            handle: h,
            mtime: await lastModifiedOf(h)
        })));
        dated.sort((a, b) => b.mtime - a.mtime);
        return dated.map(d => d.handle);
    }

    // groups: [{ type, label, files }]
    function showFileChooser(groups) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
            const box = document.createElement('div');
            box.style.cssText = 'background:#fff;color:#111;border-radius:12px;padding:20px 24px;max-width:540px;width:92%;max-height:80vh;overflow:auto;font-family:sans-serif;';

            const title = document.createElement('h3');
            title.textContent = 'Aynı türden birden fazla dosya bulundu';
            title.style.margin = '0 0 6px';
            const sub = document.createElement('div');
            sub.textContent = 'En yeni tarihli dosya işaretlidir. Doğru olanları seçip "Yükle" deyin.';
            sub.style.cssText = 'color:#666;font-size:13px;margin-bottom:14px;';
            box.appendChild(title);
            box.appendChild(sub);

            groups.forEach((grp) => {
                const gt = document.createElement('div');
                gt.textContent = grp.label;
                gt.style.cssText = 'font-weight:bold;margin:12px 0 6px;font-size:14px;';
                box.appendChild(gt);

                grp.files.forEach((handle, idx) => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;';
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = 'pick-' + grp.type;
                    radio.value = String(idx);
                    if (idx === 0) radio.checked = true;
                    const span = document.createElement('span');
                    span.textContent = handle.name;
                    label.appendChild(radio);
                    label.appendChild(span);
                    box.appendChild(label);
                });
            });

            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px;';
            const cancel = document.createElement('button');
            cancel.textContent = 'Vazgeç';
            cancel.style.cssText = 'padding:8px 14px;border:1px solid #ccc;border-radius:8px;background:#f2f2f2;cursor:pointer;font-size:14px;';
            const ok = document.createElement('button');
            ok.textContent = 'Yükle';
            ok.style.cssText = 'padding:8px 18px;border:none;border-radius:8px;background:#c94c4c;color:#fff;cursor:pointer;font-size:14px;';
            btns.appendChild(cancel);
            btns.appendChild(ok);
            box.appendChild(btns);

            const close = (result) => {
                document.body.removeChild(overlay);
                resolve(result);
            };
            cancel.addEventListener('click', () => close(null));
            ok.addEventListener('click', () => {
                const picked = {};
                groups.forEach((grp) => {
                    const sel = box.querySelector('input[name="pick-' + grp.type + '"]:checked');
                    picked[grp.type] = grp.files[Number(sel.value)];
                });
                close(picked);
            });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
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

        // Adayları türe göre topla (en yeni önce olacak şekilde sıralanır)
        const gmlCandidates = await sortNewest(files.filter(h => /\.(gml|xml)$/.test(name(h))));
        const csvCandidates = await sortNewest(files.filter(h =>
            /\.(csv|xlsx|xls)$/.test(name(h)) &&
            !/ciftci|çiftçi/i.test(name(h))
        ));
        const farmerCandidates = await sortNewest(files.filter(h =>
            /\.(xlsx|xls)$/.test(name(h)) &&
            /ciftci|çiftçi/i.test(name(h))
        ));

        if (gmlCandidates.length === 0 || csvCandidates.length === 0) {
            console.log('ℹ️ Klasörde uygun TarMap verisi bulunamadı. Manuel yükleme kullanın.');
            return false;
        }

        let gml = gmlCandidates[0];
        let csv = csvCandidates[0];
        let farmer = farmerCandidates[0] || null;

        // Aynı türden birden fazla dosya varsa kullanıcıya sor
        const ambiguous = [];
        if (gmlCandidates.length > 1) ambiguous.push({ type: 'gml', label: 'GML / XML Harita Dosyası', files: gmlCandidates });
        if (csvCandidates.length > 1) ambiguous.push({ type: 'csv', label: 'ÇKS Üretim Raporu (Parsel Excel/CSV)', files: csvCandidates });
        if (farmerCandidates.length > 1) ambiguous.push({ type: 'farmer', label: 'Çiftçi Veritabanı Excel', files: farmerCandidates });

        if (ambiguous.length > 0) {
            const picked = await showFileChooser(ambiguous);
            if (!picked) {
                console.log('ℹ️ Dosya seçimi iptal edildi. Manuel yükleme kullanın.');
                return false;
            }
            if (picked.gml) gml = picked.gml;
            if (picked.csv) csv = picked.csv;
            if (picked.farmer) farmer = picked.farmer;
        }

        return await mergeAndLoad(gml, csv, farmer);
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
