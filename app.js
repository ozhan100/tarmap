// Configuration
const APP_NAME = "TarMap";
const APP_VERSION = "1.9.9";

const AUTH_CONFIG = {
    notificationEnabled: true
};

// SUPABASE AYARLARI (Supabase panelinden alıp buraya yapıştırın)
const SUPABASE_URL = 'https://tjedetetzqenwdlqgwiv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ig4eVjojcsZqRraP8cD5xg_WPdUsBgp';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
const CSV_FILE = "Halhalca.csv";
const GML_FILE = "Halhalca.gml";
const FARMER_FILE = "ÇKSÇiftçiVeritabanı.xlsx";

// State Management
let map;
let parselData = [];
let farmerData = [];
let gmlFeatures = [];
let mapPolygons = [];
let userMarker;
let isMeasuringDist = false;
let isMeasuringArea = false;
let measurePath = [];
let measureShapes = [];
let measureLayer;
let activeFeature = null;
let currentOwnerData = null;
let masterRecords = [];

let selectedFiles = {
    gml: null,
    csv: null,
    excel: null
};

// DOM Elements (initialized after DOM is ready)
let loginScreen, appScreen, loadingOverlay, usernameInput, passwordInput;
let loginButton, loginError, infoPanel, parselDetails, closePanelBtn;
let measureToast, measureText, clearMeasureBtn;

// Init
document.addEventListener('DOMContentLoaded', () => {
    loginScreen = document.getElementById('login-screen');
    appScreen = document.getElementById('app');
    loadingOverlay = document.getElementById('loading-overlay');
    usernameInput = document.getElementById('username-input');
    passwordInput = document.getElementById('password-input');
    loginButton = document.getElementById('login-button');
    loginError = document.getElementById('login-error');
    infoPanel = document.getElementById('info-panel');
    parselDetails = document.getElementById('parsel-details');
    closePanelBtn = document.getElementById('close-panel');
    measureToast = document.getElementById('measure-info');
    measureText = document.getElementById('measure-text');
    clearMeasureBtn = document.getElementById('clear-measure');
    initAuth();
});

function initAuth() {
    // Set Version labels
    document.getElementById('login-version').innerText = `V${APP_VERSION}`;
    document.getElementById('header-version').innerText = `V${APP_VERSION}`;

    loginButton.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    if (sessionStorage.getItem('isLoggedIn') === 'true') {
        currentUser = sessionStorage.getItem('currentUser');
        showApp();
    }
}

async function handleLogin() {
    const user = usernameInput.value.trim();
    const pass = passwordInput.value;

    if (!user || !pass) {
        loginError.innerText = "Kullanıcı adı ve şifre boş olamaz!";
        loginError.style.display = 'block';
        return;
    }

    loginButton.innerText = "Giriş Yapılıyor...";
    loginButton.disabled = true;
    loginError.style.display = 'none';

    try {
        console.log("Giriş denemesi:", user);
        // Supabase RPC fonksiyonunu çağırıyoruz
        const { data, error } = await supabaseClient.rpc('guvenli_giris_yap', {
            p_kullanici_adi: user,
            p_sifre: pass,
            p_uygulama_adi: 'TarMap'
        });

        if (error) {
            console.error("Supabase RPC Hatası:", error);
            loginError.innerText = "Bağlantı Hatası: " + (error.message || "Sunucuya ulaşılamadı.");
            loginError.style.display = 'block';
            return;
        }

        console.log("RPC Yanıtı:", data);

        if (data && data.basarili) {
            // TarMap uygulaması için yetki kontrolü
            if (data.tarmap_yetkisi) {
                currentUser = data.kullanici_adi;
                sessionStorage.setItem('isLoggedIn', 'true');
                sessionStorage.setItem('currentUser', currentUser);

                // Telegram ayarlarını kaydediyoruz
                if (data.telegram_token) {
                    sessionStorage.setItem('tgToken', data.telegram_token);
                    sessionStorage.setItem('tgChat', data.telegram_chat_id);
                }
                sendNotification(`${currentUser} sisteme giriş yaptı! (TarMap)`);
                showApp();
            } else {
                loginError.innerText = "Bu hesabın TarMap uygulamasına giriş yetkisi yoktur!";
                loginError.style.display = 'block';
            }
        } else {
            loginError.innerText = (data && data.mesaj) ? data.mesaj : "Hatalı şifre veya kullanıcı adı!";
            loginError.style.display = 'block';
        }
    } catch (err) {
        console.error("Beklenmeyen hata:", err);
        loginError.innerText = "Beklenmeyen bir hata oluştu. Lütfen internet bağlantınızı kontrol edin.";
        loginError.style.display = 'block';
    } finally {
        loginButton.innerText = "Giriş Yap";
        loginButton.disabled = false;
        passwordInput.value = '';
    }
}


async function sendNotification(message) {
    const tgToken = sessionStorage.getItem('tgToken');
    const tgChat = sessionStorage.getItem('tgChat');

    if (AUTH_CONFIG.notificationEnabled && tgToken && tgChat) {
        try {
            const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: tgChat,
                    text: `🔔 TarMap Bildirimi:\n${message}\n📅 ${new Date().toLocaleString('tr-TR')}`
                })
            });
        } catch (error) {
            console.error("Bildirim hatası:", error);
        }
    }
}

function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    initLeafletMap();

    // Leaflet'in konteyner boyutunu doğru hesaplaması için küçük bir gecikme ile tetikliyoruz
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 500);
}

async function initLeafletMap() {
    // Initialize Map
    map = L.map('map', {
        center: [40.15, 29.44],
        zoom: 15,
        zoomControl: false
    });

    // Add Hybrid Tiles (Google) - No API key required for this method
    const hybridTiles = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Google'
    }).addTo(map);

    measureLayer = L.layerGroup().addTo(map);

    await loadData();
    setupTools();
    setupSearch();
    setupSettings();
    startLocationTracking();
    loadingOverlay.classList.add('hidden');
}

async function loadData() {
    try {
        const response = await fetch('TarmapVeri.json');
        if (response.ok) {
            const records = await response.json();
            renderFromMasterData(records);
            console.log(`✅ ${records.length} parsel TarmapVeri.json'dan otomatik yüklendi.`);
        } else {
            console.warn('TarmapVeri.json bulunamadı. Lütfen Ayarlar menüsünden veri yükleyin.');
        }
    } catch (error) {
        console.warn('TarmapVeri.json otomatik yüklenemedi:', error.message);
    }
}

function setupSettings() {
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('open-settings');
    const closeBtn = document.getElementById('close-settings');

    openBtn?.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

    // ── Sekme Geçişi ──
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab)?.classList.remove('hidden');
        });
    });

    // ── TAB 1: Hazır JSON Yükle ──
    const jsonInput = document.getElementById('local-json');
    const loadJsonBtn = document.getElementById('load-json-btn');

    loadJsonBtn?.addEventListener('click', async () => {
        const file = jsonInput?.files[0];
        if (!file) { alert('Lütfen bir JSON dosyası seçin.'); return; }
        modal.classList.add('hidden');
        showLoading('JSON yükleniyor...');
        setTimeout(async () => {
            try {
                const text = await file.text();
                const records = JSON.parse(text);
                renderFromMasterData(records);
                alert(`✅ ${records.length} parsel yüklendi.`);
            } catch (err) {
                alert('JSON okunamadı: ' + err.message);
            } finally { hideLoading(); }
        }, 80);
    });

    // ── TAB 2: Veri Birleştir ──
    const gmlInput   = document.getElementById('local-gml');
    const csvInput   = document.getElementById('local-csv');
    const excelInput = document.getElementById('local-excel');
    const processBtn = document.getElementById('process-data-btn');

    gmlInput?.addEventListener('change',   (e) => selectedFiles.gml   = e.target.files[0]);
    csvInput?.addEventListener('change',   (e) => selectedFiles.csv   = e.target.files[0]);
    excelInput?.addEventListener('change', (e) => selectedFiles.excel = e.target.files[0]);

    processBtn?.addEventListener('click', async () => {
        if (!selectedFiles.gml && !selectedFiles.csv && !selectedFiles.excel) {
            alert('Lütfen en az GML ve Parsel Excel dosyasını seçiniz.');
            return;
        }
        modal.classList.add('hidden');
        showLoading('Veriler birleştiriliyor...');
        const progressArea = document.getElementById('merge-progress-area');
        const progressBar  = document.getElementById('merge-progress-bar');
        const progressText = document.getElementById('merge-progress-text');
        if (progressArea) progressArea.classList.remove('hidden');

        const updateMergeProgress = (pct, msg) => {
            if (progressBar)  progressBar.style.width = pct + '%';
            if (progressText) progressText.textContent = msg;
            const loadingTextEl = document.getElementById('loading-text');
            if (loadingTextEl) loadingTextEl.textContent = msg;
        };

        setTimeout(async () => {
            try {
                const masterRecords = await buildMasterData(updateMergeProgress);
                updateMergeProgress(90, 'Harita çiziliyor...');
                renderFromMasterData(masterRecords);
                updateMergeProgress(100, 'Tamamlandı!');

                // JSON dosyasını indir
                const blob = new Blob([JSON.stringify(masterRecords)], { type: 'application/json' });
                const url  = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'TarmapVeri.json';
                a.click();
                URL.revokeObjectURL(url);

                alert(`✅ ${masterRecords.length} parsel işlendi.\n\nTarmapVeri.json indirildi — bir dahaki sefere sadece bu dosyayı yükleyin.`);
            } catch (err) {
                console.error(err);
                alert('İşlem hatası: ' + err.message);
            } finally {
                hideLoading();
                if (progressArea) progressArea.classList.add('hidden');
            }
        }, 80);
    });
}

function showLoading(msg) {
    if (loadingOverlay) {
        const t = document.getElementById('loading-text');
        if (t) t.textContent = msg || 'Yükleniyor...';
        loadingOverlay.classList.remove('hidden');
    }
}
function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

// ── Birleşik JSON'dan doğrudan harita çizimi ──
function renderFromMasterData(records) {
    masterRecords = records;
    // Mevcut poligonları temizle
    mapPolygons.forEach(p => map.removeLayer(p));
    mapPolygons = [];
    gmlFeatures = [];
    parselData  = [];
    farmerData  = [];

    if (!records || !records.length) return;

    const bounds = L.latLngBounds();

    records.forEach(rec => {
        if (!rec.coords || !rec.coords.length) return;

        const hasInfo = !!(rec.isletme || rec.urun);

        const polygon = L.polygon(rec.coords, {
            color:       hasInfo ? '#2ecc71' : '#95a5a6',
            weight:      2,
            opacity:     0.8,
            fillColor:   hasInfo ? '#2ecc71' : '#95a5a6',
            fillOpacity: 0.25
        }).addTo(map);

        // Tıklama: showParselInfo uyumlu feature ve owner nesneleri oluştur
        const feature = { ada: rec.ada, parsel: rec.parsel, mahalle: rec.mahalle, coords: rec.coords };
        const owner   = hasInfo ? {
            'İşletme Adı': rec.isletme,
            'TC':          rec.tc,
            'Köy':         rec.mahalle,
            'Ürün':        rec.urun,
            'Alan':        rec.alan,
            'Tarım Şekli': rec.tarim_sekli,
            _phone:        rec.telefon || null
        } : null;

        polygon.on('click', (e) => {
            if (isMeasuringDist || isMeasuringArea) { addMeasurePoint(e.latlng); return; }
            L.DomEvent.stopPropagation(e);
            showParselInfo(feature, owner);
        });
        polygon.on('mouseover', () => { if (!isMeasuringDist && !isMeasuringArea) polygon.setStyle({ fillOpacity: 0.5 }); });
        polygon.on('mouseout',  () => polygon.setStyle({ fillOpacity: 0.25 }));

        polygon._ada    = rec.ada;
        polygon._parsel = rec.parsel;

        bounds.extend(polygon.getBounds());
        mapPolygons.push(polygon);

        // Arama & eski fonksiyonlar için gmlFeatures'e de ekle
        gmlFeatures.push(feature);
        if (owner) parselData.push(owner);
    });

    if (mapPolygons.length > 0) map.fitBounds(bounds);
}

// ── Üç dosyadan birleşik veri oluşturma motoru ──
async function buildMasterData(progressCb) {
    const norm = (v) => progressCb ? progressCb(v, '') : null;

    // 1. GML
    progressCb?.(5, 'GML dosyası okunuyor (büyük dosyalar 15-30 sn sürebilir)...');
    gmlFeatures = [];
    if (selectedFiles.gml) {
        const text = await selectedFiles.gml.text();
        parseGML(text);
    }
    progressCb?.(35, `${gmlFeatures.length} parsel geometrisi okundu. Excel işleniyor...`);

    // 2. Parsel Excel / CSV
    parselData = [];
    if (selectedFiles.csv) {
        parselData = await readExcelOrCsvSmart(
            selectedFiles.csv,
            [['ADA', 'PARSEL'], ['ÜRÜN', 'URUN'], ['İŞLETME', 'ISLETME']]
        );
    }
    progressCb?.(55, `${parselData.length} parsel kaydı okundu. Çiftçi verisi işleniyor...`);

    // 3. Çiftçi Excel (opsiyonel)
    farmerData = [];
    if (selectedFiles.excel) {
        farmerData = await readExcelOrCsvSmart(
            selectedFiles.excel,
            [['TC', 'TELEFON'], ['ADI', 'SOYAD'], ['UNVAN']]
        );
    }
    progressCb?.(70, 'Veriler eşleştiriliyor...');

    // Farmer Map (hız için)
    const farmerByTC   = new Map();
    const farmerByName = new Map();
    farmerData.forEach(f => {
        const tc = (f['TC_V NO'] || f['TC'] || f['T.C. No'] || f['TC No'] || f['T.C.'] || '').trim();
        const nm = normalizeText(f['ADI/UNVANI'] || f['Ad Soyad'] || f['Adı Soyadı'] || f['ADI SOYADI'] || f['İşletme Adı'] || '');
        if (tc) farmerByTC.set(tc, f);
        if (nm) farmerByName.set(nm, f);
    });

    // Parsel Map (Ada-Parsel anahtarı)
    const parselMap = new Map();
    parselData.forEach(p => {
        const ada    = (p['Ada No'] || p['Ada'] || p['AdaNo'] || p['Ada No'] || '').toString().trim().replace(/^0+/, '') || '0';
        const parsel = (p['Parsel No'] || p['Parsel'] || p['ParselNo'] || p['Parsel No'] || '').toString().trim().replace(/^0+/, '') || '0';
        parselMap.set(`${ada}-${parsel}`, p);
    });

    // Birleştir
    const records = gmlFeatures.map(feat => {
        const fAda    = feat.ada.toString().replace(/^0+/, '');
        const fParsel = feat.parsel.toString().replace(/^0+/, '');
        const p = parselMap.get(`${fAda}-${fParsel}`) || {};

        const pTC   = (p['TC'] || p['TC / Vergi No'] || '').trim();
        const pName = normalizeText(p['İşletme Adı'] || p['İşletme'] || p['Ad Soyad'] || p['Sahibi'] || '');
        const farmer = (pTC && farmerByTC.get(pTC)) || (pName && farmerByName.get(pName)) || {};
        const phone  = farmer['TELEFON'] || farmer['Telefon'] || farmer['Cep Tel'] || farmer['GSM'] || farmer['CEP TEL'] || '';

        return {
            ada:        feat.ada,
            parsel:     feat.parsel,
            mahalle:    p['Köy'] || p['KÖY'] || p['Mahalle'] || '',
            coords:     feat.coords,
            isletme:    p['İşletme Adı'] || p['İşletme'] || '',
            tc:         pTC,
            urun:       p['Ürün'] || '',
            alan:       p['Kullanılan  Alan(da)'] || p['Alan'] || '',
            tarim_sekli:p['Tarım Şekli'] || '',
            telefon:    phone
        };
    });

    progressCb?.(88, `${records.length} kayıt birleştirildi.`);
    return records;
}

// ── Akıllı Excel / CSV Okuyucu ──
async function readExcelOrCsvSmart(file, keywordSets) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const data     = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];

        // Akıllı başlık tespiti: keyword setindeki TÜM kelimelerin aynı satırda bulunması gerekir
        let rangeIdx = 0;
        const primaryKws = keywordSets[0]; // En spesifik set ([örn: 'ADA', 'PARSEL'])
        for (let i = 0; i < 12; i++) {
            const row = XLSX.utils.sheet_to_json(sheet, { range: i, header: 1 })[0] || [];
            const rowUpper = row.map(c => String(c || '').toUpperCase());
            // TÜM primer anahtar kelimeler satırda ayrı ayrı bulunmalı
            const allFound = primaryKws.every(kw => rowUpper.some(cell => cell.includes(kw)));
            if (allFound) { rangeIdx = i; break; }
        }
        const jsonData = XLSX.utils.sheet_to_json(sheet, { range: rangeIdx });
        return jsonData.map(row => {
            const out = {};
            for (const k in row) {
                const clean = k.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                out[clean] = row[k] !== undefined && row[k] !== null ? row[k].toString().trim() : '';
            }
            return out;
        });
    } else {
        const text   = await file.text();
        const parsed = Papa.parse(text, { header: true, delimiter: ';', skipEmptyLines: true });
        return parsed.data.map(row => {
            const out = {};
            for (const k in row) {
                const clean = k.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                out[clean] = row[k] ? row[k].toString().trim() : '';
            }
            return out;
        });
    }
}

async function processAllData() {
    // 1. Excel (Farmer) Verisini Oku
    if (selectedFiles.excel) {
        const data = await selectedFiles.excel.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        
        // Akıllı Başlık Tespiti: İlk 10 satırı kontrol et, 'TC' veya 'ADI' geçen satırı başlık kabul et
        let rangeIdx = 0;
        for (let i = 0; i < 10; i++) {
            const temp = XLSX.utils.sheet_to_json(firstSheet, { range: i, header: 1 })[0];
            if (temp && temp.some(cell => {
                const c = String(cell).toUpperCase();
                return c.includes('TC') || c.includes('ADI') || c.includes('UNVANI') || c.includes('SOYAD');
            })) {
                rangeIdx = i;
                break;
            }
        }

        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { range: rangeIdx });
        farmerData = jsonData.map(row => {
            const newRow = {};
            for (let key in row) {
                const cleanKey = key.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                newRow[cleanKey] = row[key];
            }
            return newRow;
        });
    }

    // 2. CSV veya Excel (Parsel) Verisini Oku
    if (selectedFiles.csv) {
        const file = selectedFiles.csv;
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            
            // Akıllı Başlık Tespiti: 'Ada' veya 'Parsel' geçen satırı bul (İlk 10 satırı tara)
            let rangeIdx = 0;
            for (let i = 0; i < 10; i++) {
                const temp = XLSX.utils.sheet_to_json(firstSheet, { range: i, header: 1 })[0];
                if (temp && temp.some(cell => {
                    const c = String(cell).toUpperCase();
                    return c.includes('ADA') || c.includes('PARSEL');
                })) {
                    rangeIdx = i;
                    break;
                }
            }

            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { range: rangeIdx });
            parselData = jsonData.map(row => {
                const newRow = {};
                for (let key in row) {
                    const cleanKey = key.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                    newRow[cleanKey] = row[key] ? row[key].toString().trim() : "";
                }
                return newRow;
            });
        } else {
            const text = await file.text();
            const parsed = Papa.parse(text, {
                header: true,
                delimiter: ";",
                skipEmptyLines: true
            });
            parselData = parsed.data.map(row => {
                const newRow = {};
                for (let key in row) {
                    const cleanKey = key.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                    newRow[cleanKey] = row[key] ? row[key].toString().trim() : "";
                }
                return newRow;
            });
        }
    }

    // 3. GML Verisini Oku
    if (selectedFiles.gml) {
        const text = await selectedFiles.gml.text();
        gmlFeatures = [];
        parseGML(text);
    }

    // 4. Verileri Birleştir (Optimize Edilmiş)
    joinFarmerData();

    // 5. Haritayı Çiz
    renderPolygons();
}

async function loadData() {
    console.log("Başlangıçta veri yüklenmeyecek. Verileri 'Veri Yükle' menüsünden yükleyiniz.");
}

function joinFarmerData() {
    if (!parselData.length || !farmerData.length) return;

    // Hız için Farmer verilerini Map'e al (Key: TC veya Normalleştirilmiş İsim)
    const farmerMapByTC = new Map();
    const farmerMapByName = new Map();

    farmerData.forEach(f => {
        const fTC = (f["TC_V NO"] || f["TC"] || f["T.C. No"] || f["TC No"] || f["T.C."] || "").toString().trim();
        if (fTC) farmerMapByTC.set(fTC, f);

        const fName = normalizeText(f["ADI/UNVANI"] || f["Ad Soyad"] || f["Adı Soyadı"] || f["İşletme Adı"] || f["ADI SOYADI"]);
        if (fName) farmerMapByName.set(fName, f);
    });

    parselData.forEach(p => {
        const pTC = (p["TC"] || p["TC Kimlik"] || p["T.C. No"] || p["TC / Vergi No"] || "").toString().trim();
        const pName = normalizeText(p["İşletme"] || p["Ad Soyad"] || p["Sahibi"] || p["İşletme Adı"]);

        let farmer = null;
        if (pTC && farmerMapByTC.has(pTC)) {
            farmer = farmerMapByTC.get(pTC);
        } else if (pName && farmerMapByName.has(pName)) {
            farmer = farmerMapByName.get(pName);
        }

        if (farmer) {
            p._farmerInfo = farmer;
            const phone = farmer["TELEFON"] || farmer["Telefon"] || farmer["Cep Tel"] || farmer["GSM"] || farmer["CEP TEL"] || farmer["ADI/UNVANI"];
            p._phone = phone ? phone.toString().trim() : null;
        }
    });
}

function parseGML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const members = xmlDoc.getElementsByTagNameNS("*", "featureMember");

    for (let member of members) {
        const layer = member.getElementsByTagNameNS("*", "Layer1")[0] || member.firstElementChild;
        if (!layer) continue;

        // Ada ve Parsel için genişletilmiş etiket araması
        const adaNo = (layer.getElementsByTagNameNS("*", "AdaNo")[0] || 
                      layer.getElementsByTagNameNS("*", "ADA_NO")[0] || 
                      layer.getElementsByTagNameNS("*", "ADA")[0] || 
                      layer.getElementsByTagNameNS("*", "ADANO")[0])?.textContent?.trim();

        const parselNo = (layer.getElementsByTagNameNS("*", "ParselNo")[0] || 
                         layer.getElementsByTagNameNS("*", "PARSEL_NO")[0] || 
                         layer.getElementsByTagNameNS("*", "PARSEL")[0] || 
                         layer.getElementsByTagNameNS("*", "PARSELNO")[0])?.textContent?.trim();

        const mahalle = layer.getElementsByTagNameNS("*", "Mahalle")[0]?.textContent?.trim() ||
            layer.getElementsByTagNameNS("*", "MahalleAdi")[0]?.textContent?.trim() ||
            layer.getElementsByTagNameNS("*", "MAHALLE_AD")[0]?.textContent?.trim() ||
            layer.getElementsByTagNameNS("*", "KoyAdi")[0]?.textContent?.trim() || "";
        
        const geom = layer.getElementsByTagNameNS("*", "Geom")[0] || 
                     layer.getElementsByTagNameNS("*", "geometry")[0] ||
                     layer.getElementsByTagNameNS("*", "GEOMETRI")[0];

        if (!adaNo || !parselNo || !geom) continue;

        let coordinates = [];
        const coordNodes = geom.getElementsByTagNameNS("*", "coordinates");

        for (let node of coordNodes) {
            const coordString = node.textContent;
            if (coordString) {
                const pairs = coordString.trim().split(/\s+/);
                const ring = pairs.map(p => {
                    const parts = p.split(",");
                    // Leaflet expects [lat, lng]
                    return [parseFloat(parts[1]), parseFloat(parts[0])];
                });
                coordinates.push(ring);
            }
        }

        gmlFeatures.push({
            ada: adaNo,
            parsel: parselNo,
            mahalle: mahalle,
            coords: coordinates
        });
    }
}

function renderPolygons() {
    // Clear existing polygons from map
    mapPolygons.forEach(p => map.removeLayer(p));
    mapPolygons = [];

    if (!gmlFeatures.length) return;

    // Hız için parsel verilerini Map'e al (Key: Ada-Parsel)
    const ownerMap = new Map();
    parselData.forEach(d => {
        // Ada ve Parsel numaralarını sayısal olarak normalize et (Baştaki sıfırları temizle)
        const dAda = (d["Ada No"] || d["Ada"] || d["AdaNo"] || d["Ada\nNo"] || "").toString().trim().replace(/^0+/, '');
        const dParsel = (d["Parsel No"] || d["Parsel"] || d["ParselNo"] || d["Parsel\nNo"] || "").toString().trim().replace(/^0+/, '');
        ownerMap.set(`${dAda}-${dParsel}`, d);
    });

    const bounds = L.latLngBounds();

    gmlFeatures.forEach(feature => {
        // GML'den gelen ada/parseli de normalize et
        const fAda = feature.ada.toString().replace(/^0+/, '');
        const fParsel = feature.parsel.toString().replace(/^0+/, '');
        
        const key = `${fAda}-${fParsel}`;
        const owner = ownerMap.get(key);

        const polygon = L.polygon(feature.coords, {
            color: owner ? "#2ecc71" : "#95a5a6",
            weight: 2,
            opacity: 0.8,
            fillColor: owner ? "#2ecc71" : "#95a5a6",
            fillOpacity: 0.25
        }).addTo(map);

        polygon.on('click', (e) => {
            if (isMeasuringDist || isMeasuringArea) {
                addMeasurePoint(e.latlng);
                return;
            }
            L.DomEvent.stopPropagation(e);
            showParselInfo(feature, owner);
        });

        polygon.on('mouseover', () => {
            if (!isMeasuringDist && !isMeasuringArea) {
                polygon.setStyle({ fillOpacity: 0.5 });
            }
        });

        polygon.on('mouseout', () => {
            polygon.setStyle({ fillOpacity: 0.25 });
        });

        // Store ada/parsel on polygon for easier search lookup
        polygon._ada = feature.ada;
        polygon._parsel = feature.parsel;

        bounds.extend(polygon.getBounds());
        mapPolygons.push(polygon);
    });

    if (mapPolygons.length > 0) {
        map.fitBounds(bounds);
    }
}

window.showParselInfo = function (feature, owner) {
    activeFeature = feature;
    currentOwnerData = owner;
    // Find farmer details if possible
    let farmerInfo = null;
    if (owner) {
        const ownerTC = (owner["TC"] || owner["TC / Vergi No"] || "").toString().trim();
        const ownerName = normalizeText(owner["İşletme"] || owner["İşletme Adı"]);

        farmerInfo = farmerData.find(f => {
            const fTC = (f["TC"] || f["T.C. No"] || f["T.C."] || f["TC No"] || f["TC_V NO"] || "").toString().trim();
            if (ownerTC && fTC === ownerTC) return true;
            const fName = normalizeText(f["Ad Soyad"] || f["Adı Soyadı"] || f["İşletme Adı"] || f["ADI SOYADI"] || f["ADI/UNVANI"]);
            if (ownerName && fName === ownerName) return true;
            return false;
        });
    }

    let phone = null;
    if (owner) {
        phone = owner._phone;
        if (!phone && owner._farmerInfo) {
            const f = owner._farmerInfo;
            phone = f["TELEFON"] || f["Telefon"] || f["Cep Tel"] || f["GSM"];
        }
        if (!phone && owner._farmerInfo) {
            phone = Object.values(owner._farmerInfo).find(v => {
                const s = String(v).replace(/\s/g, "");
                return /^[0-9]{10,11}$/.test(s);
            });
        }
    }

    parselDetails.innerHTML = `
        <div class="detail-item">
            <div class="detail-label">Ada / Parsel</div>
            <div class="detail-value"><span id="panel-ada">${feature.ada}</span> / <span id="panel-parsel">${feature.parsel}</span></div>
        </div>
        ${feature.mahalle ? `
        <div class="detail-item">
            <div class="detail-label">Mahalle</div>
            <div class="detail-value">${feature.mahalle}</div>
        </div>
        ` : ''}
        ${owner ? `
            <div class="detail-item">
                <div class="detail-label">İşletme / Sahibi</div>
                <div class="detail-value">${owner["İşletme Adı"] || owner["İşletme"] || owner["Sahibi"] || "Bilinmiyor"}</div>
            </div>
            ${phone ? `
                <div class="detail-item phone-row">
                    <div class="detail-label">Telefon</div>
                    <div class="detail-value">${phone}</div>
                    <a href="tel:${phone.toString().replace(/\s/g, "")}" class="call-btn-small">📞 Ara</a>
                </div>
            ` : ''}
            <div class="detail-item">
                <div class="detail-label">TC Kimlik</div>
                <div class="detail-value">${owner["TC"] || owner["TC / Vergi No"] || "Gizli"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ürün</div>
                <div class="detail-value">${owner["Ürün"] || "-"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Alan (da)</div>
                <div class="detail-value">${owner["Alan"] || owner["Kullanılan  Alan(da)"] || owner["ParselAlanı"] || "-"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Tarım Şekli</div>
                <div class="detail-value">${owner["Tarım Şekli"] || "-"}</div>
            </div>
        ` : `
            <div class="detail-item">
                <div class="detail-label">Bilgi</div>
                <div class="detail-value">Bu parsel için CSV verisi bulunamadı.</div>
            </div>
        `}
    `;
    infoPanel.classList.remove('hidden');
}



function setupSearch() {
    const searchInput = document.getElementById('global-search');
    const searchBtn = document.getElementById('search-button');
    const searchContainer = document.getElementById('search-container');
    const toggleSearchBtn = document.getElementById('toggle-search-btn');
    const showSearchBtn = document.getElementById('show-search');
    const printReportBtn = document.getElementById('print-report-btn');
    const closePrintBtn = document.getElementById('close-print-btn');

    searchBtn.onclick = () => executeSearch(searchInput.value);
    searchInput.onkeypress = (e) => {
        if (e.key === 'Enter') executeSearch(searchInput.value);
    };

    if (printReportBtn) {
        printReportBtn.onclick = () => generateReport(searchInput.value);
    }
    if (closePrintBtn) {
        closePrintBtn.onclick = () => {
            document.getElementById('print-container').classList.add('hidden');
        };
    }

    // Toggle Search Visibility
    toggleSearchBtn.onclick = () => {
        searchContainer.classList.add('ui-hidden');
        showSearchBtn.classList.remove('hidden');
    };

    showSearchBtn.onclick = () => {
        searchContainer.classList.remove('ui-hidden');
        showSearchBtn.classList.add('hidden');
    };
}

function normalizeText(text) {
    if (!text) return "";
    let str = text.toString();

    // Turkish specific manual mapping for maximum reliability
    const mapping = {
        'İ': 'i', 'I': 'ı', 'Ş': 'ş', 'Ğ': 'ğ', 'Ü': 'ü', 'Ö': 'ö', 'Ç': 'ç',
        'i': 'i', 'ı': 'ı', 'ş': 'ş', 'ğ': 'ğ', 'ü': 'ü', 'ö': 'ö', 'ç': 'ç'
    };

    str = str.replace(/[İIŞĞÜÖÇ]/g, (letter) => mapping[letter] || letter.toLowerCase());
    str = str.toLowerCase(); // Fallback for other characters

    return str.replace(/\s+/g, ' ').trim();
}

const YEM_BITKILERI = [
    "ARİ OTU(YEŞİL OT)",
    "ÇAYIR OTU(MUHTELİF)",
    "FİĞ(YEŞİL OT)",
    "HAYVAN PANCARI(YEŞİL OT)",
    "İTALYAN ÇİMİ(YEŞİL OT)",
    "KORUNGA(YEŞİL OT)",
    "MISIR(SİLAJLIK)",
    "RYEGRASS(SÜT OTU) (YEŞİL OT)",
    "SİLAJLIK MISIR(SİLAJLIK)",
    "SORGUM SUDAN OTU MELEZİ(SİLAJLIK)",
    "SORGUM SUDAN OTU MELEZİ(YEŞİL OT)",
    "TRİTİKALE(SİLAJLIK)",
    "TRİTİKALE(YEŞİL OT)",
    "YEM BEZELYESİ(YEŞİL OT)",
    "YONCA(Yeşil Ot)",
    "YONCA(yonca)",
    "YULAF(YEŞİL OT)"
];

function checkProductMatch(recordProduct, searchProduct) {
    if (!searchProduct) return true;
    const nRecord = normalizeText(recordProduct || "");
    if (searchProduct === 'yem bitkisi' || searchProduct === 'yem bitkileri') {
        return YEM_BITKILERI.some(yb => nRecord.includes(normalizeText(yb)));
    }
    return nRecord.includes(searchProduct);
}

function findParcelsByQuery(query) {
    if (!query) return [];
    let normalizedQuery = normalizeText(query);
    let results = [];

    // Hızlı arama için masterRecords kullan (80 bin kayıtta anında sonuç verir)
    if (masterRecords && masterRecords.length > 0) {
        if (normalizedQuery.includes('ada') && normalizedQuery.includes('parsel')) {
            const villageMatch = normalizedQuery.match(/köy\s+([^\s]+)/);
            const adaMatch = normalizedQuery.match(/ada\s+([0-9,]+)/);
            const parselMatch = normalizedQuery.match(/parsel\s+([0-9,]+)/);

            if (adaMatch && parselMatch) {
                const adas = adaMatch[1].split(',');
                const parsels = parselMatch[1].split(',');

                for (let i = 0; i < adas.length; i++) {
                    const ada = adas[i].trim();
                    const parsel = parsels[i] ? parsels[i].trim() : null;
                    if (ada && parsel) {
                        const rec = masterRecords.find(r => r.ada.toString() === ada && r.parsel.toString() === parsel);
                        if (rec) results.push(rec);
                    }
                }
            }
        } else if (normalizedQuery.includes('isim') || normalizedQuery.includes('ürün')) {
            const villageMatch = normalizedQuery.match(/köy\s+(.*?)(?=\s+isim|\s+ürün|$)/);
            const nameMatch = normalizedQuery.match(/isim\s+(.*?)(?=\s+ürün|$)/);
            const productMatch = normalizedQuery.match(/ürün\s+(.*)/);

            const village = villageMatch ? normalizeText(villageMatch[1]) : null;
            const name = nameMatch ? normalizeText(nameMatch[1]) : null;
            const product = productMatch ? normalizeText(productMatch[1]) : null;

            results = masterRecords.filter(r => {
                let match = true;
                if (village && !normalizeText(r.mahalle).includes(village)) match = false;
                if (name && !normalizeText(r.isletme).includes(name)) match = false;
                if (product && !checkProductMatch(r.urun, product)) match = false;
                return match && (village || name || product);
            });
        }

        if (results.length === 0) {
            // İsim ve ürün kelimeleri kullanılmadan yapılan serbest aramalar:
            // Örn: "ahmet yonca" veya "ahmet yem bitkisi"
            let searchName = normalizedQuery;
            let searchProduct = null;

            if (normalizedQuery.includes('yem bitkisi')) {
                searchProduct = 'yem bitkisi';
                searchName = normalizedQuery.replace('yem bitkisi', '').trim();
            } else if (normalizedQuery.includes('yem bitkileri')) {
                searchProduct = 'yem bitkileri';
                searchName = normalizedQuery.replace('yem bitkileri', '').trim();
            } else {
                // Sona yazılan kelimenin yem bitkisi olup olmadığını kontrol edelim
                const words = normalizedQuery.split(' ');
                if (words.length > 1) {
                    const lastWord = words[words.length - 1];
                    const isProduct = YEM_BITKILERI.some(yb => normalizeText(yb).includes(lastWord));
                    if (isProduct) {
                        searchProduct = lastWord;
                        searchName = words.slice(0, -1).join(' ').trim();
                    }
                }
            }

            results = masterRecords.filter(r => {
                const pTC = (r.tc || "").toString().trim();
                const pName = normalizeText(r.isletme || "");
                
                let nameMatch = false;
                if (pTC && pTC.includes(searchName)) nameMatch = true;
                if (pName && pName.includes(searchName)) nameMatch = true;
                if (!searchName) nameMatch = true; // Sadece "yem bitkisi" araması için

                if (!nameMatch) return false;
                
                if (searchProduct) {
                    return checkProductMatch(r.urun, searchProduct);
                }
                
                return true;
            });
        }
        return results;
    }



    // Eski yavaş yöntem (Eğer masterRecords yoksa)
    if (normalizedQuery.includes('ada') && normalizedQuery.includes('parsel')) {
        const villageMatch = normalizedQuery.match(/köy\s+([^\s]+)/);
        const adaMatch = normalizedQuery.match(/ada\s+([0-9,]+)/);
        const parselMatch = normalizedQuery.match(/parsel\s+([0-9,]+)/);

        if (adaMatch && parselMatch) {
            const adas = adaMatch[1].split(',');
            const parsels = parselMatch[1].split(',');

            for (let i = 0; i < adas.length; i++) {
                const ada = adas[i].trim();
                const parsel = parsels[i] ? parsels[i].trim() : null;
                if (ada && parsel) {
                    const feature = gmlFeatures.find(f => f.ada === ada && f.parsel === parsel);
                    if (feature) results.push(feature);
                }
            }
        }
    }
    else if (normalizedQuery.includes('isim') || normalizedQuery.includes('ürün')) {
        const villageMatch = normalizedQuery.match(/köy\s+(.*?)(?=\s+isim|\s+ürün|$)/);
        const nameMatch = normalizedQuery.match(/isim\s+(.*?)(?=\s+ürün|$)/);
        const productMatch = normalizedQuery.match(/ürün\s+(.*)/);

        const village = villageMatch ? normalizeText(villageMatch[1]) : null;
        const name = nameMatch ? normalizeText(nameMatch[1]) : null;
        const product = productMatch ? normalizeText(productMatch[1]) : null;

        results = gmlFeatures.filter(f => {
            const owner = parselData.find(d => {
                const dAda = (d["Ada No"] || d["Ada"] || d["AdaNo"] || d["Ada\nNo"] || "").toString().trim();
                const dParsel = (d["Parsel No"] || d["Parsel"] || d["ParselNo"] || d["Parsel\nNo"] || "").toString().trim();
                return dAda === f.ada && dParsel === f.parsel;
            });
            if (!owner) return false;

            let match = true;
            if (village && !normalizeText(owner["Köy"] || owner["KÖY"] || "").includes(village)) match = false;
            if (name && !normalizeText(owner["İşletme"] || owner["Ad Soyad"] || owner["Sahibi"] || "").includes(name)) match = false;
            if (product) {
                const productVal = (owner["Ürün"] || owner["ÜRÜN"] || "").toString();
                if (!checkProductMatch(productVal, product)) match = false;
            }
            return match;
        });
    }

    if (results.length === 0) {
        let searchName = normalizedQuery;
        let searchProduct = null;

        if (normalizedQuery.includes('yem bitkisi')) {
            searchProduct = 'yem bitkisi';
            searchName = normalizedQuery.replace('yem bitkisi', '').trim();
        } else if (normalizedQuery.includes('yem bitkileri')) {
            searchProduct = 'yem bitkileri';
            searchName = normalizedQuery.replace('yem bitkileri', '').trim();
        } else {
            const words = normalizedQuery.split(' ');
            if (words.length > 1) {
                const lastWord = words[words.length - 1];
                const isProduct = YEM_BITKILERI.some(yb => normalizeText(yb).includes(lastWord));
                if (isProduct) {
                    searchProduct = lastWord;
                    searchName = words.slice(0, -1).join(' ').trim();
                }
            }
        }

        results = gmlFeatures.filter(f => {
            const owner = parselData.find(d => {
                const dAda = (d["Ada No"] || d["Ada"] || d["AdaNo"] || d["Ada\nNo"] || "").toString().trim();
                const dParsel = (d["Parsel No"] || d["Parsel"] || d["ParselNo"] || d["Parsel\nNo"] || "").toString().trim();
                return dAda === f.ada && dParsel === f.parsel;
            });
            if (!owner) return false;
            
            const pTC = (owner["TC"] || owner["TC Kimlik"] || owner["T.C. No"] || owner["TC / Vergi No"] || "").toString().trim();
            const pName = normalizeText(owner["İşletme"] || owner["Ad Soyad"] || owner["Sahibi"] || owner["İşletme Adı"] || "");
            
            let nameMatch = false;
            if (pTC && pTC.includes(searchName)) nameMatch = true;
            if (pName && pName.includes(searchName)) nameMatch = true;
            if (!searchName) nameMatch = true;

            if (!nameMatch) return false;

            if (searchProduct) {
                const productVal = (owner["Ürün"] || owner["ÜRÜN"] || "").toString();
                return checkProductMatch(productVal, searchProduct);
            }
            
            return true;
        });
    }

    return results;
}

function executeSearch(query) {
    const results = findParcelsByQuery(query);
    
    if (results.length > 0) {
        const bounds = L.latLngBounds();
        results.forEach(f => {
            const foundPoly = mapPolygons.find(p => p._ada === f.ada && p._parsel === f.parsel);

            if (foundPoly) {
                bounds.extend(foundPoly.getBounds());
                foundPoly.setStyle({ color: '#f1c40f', weight: 4, fillOpacity: 0.7 });
                setTimeout(() => {
                    const isOwner = f.isletme ? true : parselData.some(d => {
                        const dAda = (d["Ada No"] || d["Ada"] || d["AdaNo"] || d["Ada\nNo"] || "").toString().trim();
                        const dParsel = (d["Parsel No"] || d["Parsel"] || d["ParselNo"] || d["Parsel\nNo"] || "").toString().trim();
                        return dAda === f.ada && dParsel === f.parsel;
                    });
                    foundPoly.setStyle({ color: isOwner ? "#2ecc71" : "#95a5a6", weight: 2, fillOpacity: 0.25 });
                }, 5000);
            }
        });
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
    } else {
        alert("Sonuç bulunamadı.");
    }
}

async function generateReport(query) {
    if (!query) {
        alert("Lütfen TC No, isim veya köy adı giriniz.");
        return;
    }
    
    showLoading("Rapor hazırlanıyor...");
    
    setTimeout(async () => {
        try {
            const results = findParcelsByQuery(query);
            if (results.length === 0) {
                alert("Raporlanacak parsel bulunamadı.");
                hideLoading();
                return;
            }

            // Mahalleye göre, sonra Ada, sonra Parsele göre sırala
            results.sort((a, b) => {
                const m = a.mahalle.localeCompare(b.mahalle, 'tr');
                if (m !== 0) return m;
                const aAda = parseInt(a.ada) || 0;
                const bAda = parseInt(b.ada) || 0;
                if (aAda !== bAda) return aAda - bAda;
                const aParsel = parseInt(a.parsel) || 0;
                const bParsel = parseInt(b.parsel) || 0;
                return aParsel - bParsel;
            });

            // Başlık Bilgilerini Topla
            let allMahalleler = new Set();
            let matchedName = "";
            let matchedTC = "";
            let totalArea = 0;

            results.forEach(f => {
                let mahalleAdi = f.mahalle || "";
                if (!mahalleAdi) {
                    const owner = parselData.find(d => {
                        const dAda = (d["Ada No"] || d["Ada"] || d["AdaNo"] || d["Ada\nNo"] || "").toString().trim();
                        const dParsel = (d["Parsel No"] || d["Parsel"] || d["ParselNo"] || d["Parsel\nNo"] || "").toString().trim();
                        return dAda === f.ada && dParsel === f.parsel;
                    });
                    if (owner) mahalleAdi = owner["Köy"] || owner["KÖY"] || owner["Mahalle"] || "";
                }
                
                if (mahalleAdi) allMahalleler.add(mahalleAdi);
                
                if (f.isletme || f.tc) {
                    if (!matchedName) matchedName = f.isletme || "";
                    if (!matchedTC) matchedTC = f.tc || "";
                } else {
                    const owner = parselData.find(d => {
                        const dAda = (d["Ada No"] || d["Ada"] || d["AdaNo"] || d["Ada\nNo"] || "").toString().trim();
                        const dParsel = (d["Parsel No"] || d["Parsel"] || d["ParselNo"] || d["Parsel\nNo"] || "").toString().trim();
                        return dAda === f.ada && dParsel === f.parsel;
                    });
                    
                    if (owner) {
                        if (!matchedName) matchedName = owner["İşletme"] || owner["Ad Soyad"] || owner["Sahibi"] || owner["İşletme Adı"] || "";
                        if (!matchedTC) matchedTC = owner["TC"] || owner["TC Kimlik"] || owner["T.C. No"] || owner["TC / Vergi No"] || "";
                    }
                }
            });

            document.getElementById('print-year').innerText = new Date().getFullYear();
            
            let mahalleStr = Array.from(allMahalleler).join(", ");
            if (allMahalleler.size > 2) mahalleStr = "ÇEŞİTLİ MAHALLELER";
            
            document.getElementById('print-mahalle').innerText = ": " + mahalleStr;
            document.getElementById('print-isim').innerText = ": " + (matchedName || query.toUpperCase());
            document.getElementById('print-tc').innerText = ": " + (matchedTC || "-");

            const grid = document.getElementById('print-maps-grid');
            grid.innerHTML = '';
            
            // Render HTML
            results.forEach((f, idx) => {
                let urun = f.urun || "-";
                let mahalleAdi = f.mahalle || "";
                
                if (!f.urun || !mahalleAdi) {
                    const owner = parselData.find(d => {
                        const dAda = (d["Ada No"] || d["Ada"] || d["AdaNo"] || d["Ada\nNo"] || "").toString().trim();
                        const dParsel = (d["Parsel No"] || d["Parsel"] || d["ParselNo"] || d["Parsel\nNo"] || "").toString().trim();
                        return dAda === f.ada && dParsel === f.parsel;
                    });
                    if (owner) {
                        if (!f.urun) urun = owner["Ürün"] || owner["ÜRÜN"] || "-";
                        if (!mahalleAdi) mahalleAdi = owner["Köy"] || owner["KÖY"] || owner["Mahalle"] || "";
                    }
                }
                
                const titleStr = mahalleAdi ? `${mahalleAdi} - Ada:${f.ada} Par:${f.parsel} - ${urun}` : `Ada:${f.ada} Par:${f.parsel} - ${urun}`;

                const card = document.createElement('div');
                card.className = 'print-card';
                card.innerHTML = `
                    <div class="print-card-title" title="${titleStr}">${titleStr}</div>
                    <div id="print-map-${idx}" class="print-map-container"></div>
                `;
                grid.appendChild(card);
            });

            document.getElementById('print-container').classList.remove('hidden');

            // Draw Leaflet Maps
            // We need to wait a tiny bit for the DOM to render the new divs so Leaflet can get their sizes
            await new Promise(r => setTimeout(r, 100));

            for (let i = 0; i < results.length; i++) {
                const f = results[i];
                let pMap = L.map(`print-map-${i}`, {
                    zoomControl: false,
                    attributionControl: false,
                    dragging: false,
                    scrollWheelZoom: false,
                    doubleClickZoom: false,
                    boxZoom: false,
                    keyboard: false
                });

                // Google Map arka planı kapatıldı, sadece beyaz bir fon üzerine poligon çizilecek
                let poly = L.polygon(f.coords, {
                    color: '#e74c3c', // Kırmızı çizgi
                    weight: 3,
                    opacity: 1,
                    fillColor: '#e74c3c',
                    fillOpacity: 0.1
                }).addTo(pMap);

                pMap.fitBounds(poly.getBounds());
            }

            hideLoading();
            
            // Wait for tiles to load before print
            setTimeout(() => {
                window.print();
            }, 1500);

        } catch (err) {
            console.error(err);
            alert("Rapor oluşturulurken hata oluştu: " + err.message);
            hideLoading();
        }
    }, 100);
}

function setupTools() {
    closePanelBtn.onclick = () => infoPanel.classList.add('hidden');

    document.getElementById('logout-button').onclick = () => {
        sessionStorage.removeItem('isLoggedIn');
        location.reload();
    };

    document.getElementById('locate-me').onclick = () => {
        if (userMarker) {
            map.setView(userMarker.getLatLng(), 18);
        } else {
            startLocationTracking(true);
        }
    };

    document.getElementById('measure-dist').onclick = toggleMeasureDist;
    document.getElementById('measure-area').onclick = toggleMeasureArea;
    clearMeasureBtn.onclick = clearMeasurements;

    // UI Toggles
    const header = document.querySelector('header');
    const toggleHeaderBtn = document.getElementById('toggle-header');
    const showHeaderBtn = document.getElementById('show-header');

    toggleHeaderBtn.onclick = () => {
        header.classList.add('ui-hidden');
        showHeaderBtn.classList.remove('hidden');
    };

    showHeaderBtn.onclick = () => {
        header.classList.remove('ui-hidden');
        showHeaderBtn.classList.add('hidden');
    };

    map.on('click', (e) => {
        if (isMeasuringDist || isMeasuringArea) {
            addMeasurePoint(e.latlng);
        }
    });
}

function startLocationTracking(zoom = false) {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((position) => {
            const latlng = [position.coords.latitude, position.coords.longitude];

            if (!userMarker) {
                userMarker = L.circleMarker(latlng, {
                    radius: 8,
                    fillColor: "#4285F4",
                    fillOpacity: 1,
                    color: "white",
                    weight: 2
                }).addTo(map);
                if (zoom) map.setView(latlng, 18);
            } else {
                userMarker.setLatLng(latlng);
            }
        }, (err) => {
            console.warn("Konum hatası:", err);
        }, {
            enableHighAccuracy: true
        });
    }
}

// Measurement Logic
function toggleMeasureDist() {
    clearMeasurements();
    isMeasuringDist = !isMeasuringDist;
    isMeasuringArea = false;
    updateToolButtons();
    if (isMeasuringDist) {
        measureToast.classList.remove('hidden');
        measureText.innerText = "Mesafe ölçmek için tıklayın";
        document.getElementById('map').style.cursor = 'crosshair';
    } else {
        measureToast.classList.add('hidden');
        document.getElementById('map').style.cursor = '';
    }
}

function toggleMeasureArea() {
    clearMeasurements();
    isMeasuringArea = !isMeasuringArea;
    isMeasuringDist = false;
    updateToolButtons();
    if (isMeasuringArea) {
        measureToast.classList.remove('hidden');
        measureText.innerText = "Alan ölçmek için tıklayın";
        document.getElementById('map').style.cursor = 'crosshair';
    } else {
        measureToast.classList.add('hidden');
        document.getElementById('map').style.cursor = '';
    }
}

function updateToolButtons() {
    document.getElementById('measure-dist').classList.toggle('active', isMeasuringDist);
    document.getElementById('measure-area').classList.toggle('active', isMeasuringArea);
}

function addMeasurePoint(latlng) {
    measurePath.push(latlng);

    L.circleMarker(latlng, {
        radius: 4,
        fillColor: "white",
        fillOpacity: 1,
        color: "#2ecc71",
        weight: 2
    }).addTo(measureLayer);

    measureLayer.clearLayers();
    // Re-add dots
    measurePath.forEach(p => {
        L.circleMarker(p, { radius: 4, fillColor: "white", fillOpacity: 1, color: "#2ecc71", weight: 2 }).addTo(measureLayer);
    });

    if (isMeasuringDist) {
        const polyline = L.polyline(measurePath, { color: "#f1c40f", weight: 3 }).addTo(measureLayer);
        const dist = calculateDistance(measurePath);
        measureText.innerText = `Mesafe: ${dist.toFixed(2)} m`;
    } else if (isMeasuringArea) {
        const polygon = L.polygon(measurePath, { color: "#f1c40f", weight: 2, fillColor: "#f1c40f", fillOpacity: 0.35 }).addTo(measureLayer);
        if (measurePath.length >= 3) {
            const area = calculateArea(measurePath);
            measureText.innerText = `Alan: ${area.toFixed(2)} m² (${(area / 1000).toFixed(2)} dönüm)`;
        }
    }
}

function calculateDistance(path) {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
        total += path[i].distanceTo(path[i + 1]);
    }
    return total;
}

function calculateArea(path) {
    // Using Shoelace formula for lat/lng (approximation for small areas)
    // For better accuracy we'd use a projected coordinate system, but this is usually fine for fields.
    const R = 6378137; // Earth radius
    let area = 0;
    if (path.length > 2) {
        for (let i = 0; i < path.length; i++) {
            let j = (i + 1) % path.length;
            area += (path[j].lng - path[i].lng) * (2 + Math.sin(path[i].lat * Math.PI / 180) + Math.sin(path[j].lat * Math.PI / 180));
        }
        area = Math.abs(area * R * R * Math.PI / 180 / 2);
    }
    return area;
}

function clearMeasurements() {
    measurePath = [];
    measureLayer.clearLayers();
    measureText.innerText = "";
}

