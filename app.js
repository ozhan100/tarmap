// Configuration
// her güncellemeden sonra APP_VERSION 0.01 arttırılsın
const APP_NAME = "TarMap";
const APP_VERSION = "2.99";

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
let currentSearchResults = [];
let currentSearchIndex = 0;
let isSearchActive = false;
let nearbyParcelsLayer = null;
let nearbyParcelsLabels = [];

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

async function initAuth() {
    // Set Version labels
    document.getElementById('login-version').innerText = `V${APP_VERSION}`;
    document.getElementById('header-version').innerText = `V${APP_VERSION}`;

    loginButton.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Kayıtlı oturum token'ı yalnızca SUNUCUDA doğrulanırsa geçerlidir.
    // (İstemci bayrağına güvenilmez — sahte "isLoggedIn=true" ile giriş atlanamaz.)
    const token = sessionStorage.getItem('tarmap_sessionToken');
    if (token) {
        try {
            const { data, error } = await supabaseClient.rpc('oturum_dogrula', {
                p_token: token,
                p_uygulama_adi: 'TarMap'
            });
            if (!error && data && data.gecerli) {
                currentUser = data.kullanici_adi;
                showApp();
                return;
            }
        } catch (err) {
            console.warn('Oturum doğrulaması başarısız:', err);
        }
        sessionStorage.removeItem('tarmap_sessionToken');
        sessionStorage.removeItem('tarmap_currentUser');
    }

    // Kullanım istatistiği: açıkken 2 dakikada bir sunucuya aktiflik sinyali gönder
    setInterval(async () => {
        const aktifToken = sessionStorage.getItem('tarmap_sessionToken');
        if (!aktifToken) return;
        try {
            await supabaseClient.rpc('aktiflik_bildir', {
                p_token: aktifToken,
                p_uygulama_adi: 'TarMap'
            });
        } catch (err) { /* sessiz geç */ }
    }, 120000);
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

        if (data && data.basarili) {
            if (data.tarmap_yetkisi) {
                currentUser = data.kullanici_adi;
                sessionStorage.setItem('tarmap_sessionToken', data.token);
                sessionStorage.setItem('tarmap_currentUser', currentUser);

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

function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    initLeafletMap();
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 500);

    // Otomatik veri yükleme: girişten hemen sonra Downloads klasörünü tara
    setTimeout(async () => {
        try {
            if (typeof window.autoLoadFromDownloads === 'function') {
                await window.autoLoadFromDownloads();
            }
        } catch (err) {
            console.warn('Otomatik veri yükleme başarısız:', err);
        }
    }, 800);
}

async function initLeafletMap() {
    map = L.map('map', {
        center: [40.15, 29.44],
        zoom: 15,
        zoomControl: false
    });

    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Google'
    }).addTo(map);

    measureLayer = L.layerGroup().addTo(map);

    // UI kurulumlarını hemen yap (Veri yüklenmesini bekleme)
    setupTools();
    setupSearch();
    setupSettings();

    try {
        await loadData();
        startLocationTracking();
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

async function loadData() {
    // Otomatik yükleme çok büyük veri setlerinde (88k parsel) tarayıcıyı dondurur.
    // Bu nedenle otomatik yüklemeyi devre dışı bıraktık.
    console.log('ℹ️ Otomatik veri yükleme devre dışı. Lütfen Ayarlar (⚙️) menüsünden manuel yükleme yapın.');
}

function setupSettings() {
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('open-settings');
    const closeBtn = document.getElementById('close-settings');

    openBtn?.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab)?.classList.remove('hidden');
        });
    });

    // Renk Lejantı penceresi
    const legendModal = document.getElementById('legend-modal');
    const openLegendBtn = document.getElementById('open-legend-btn');
    const closeLegendBtn = document.getElementById('close-legend');

    const buildLegend = () => {
        const list = document.getElementById('legend-list');
        if (!list || list.dataset.built) return;
        list.dataset.built = '1';
        list.className = 'legend-list-wrap';
        Object.entries(PRODUCT_GROUP_COLORS).forEach(([key, val]) => {
            const row = document.createElement('div');
            row.className = 'legend-item';
            row.innerHTML = `<span class="legend-color" style="background:${val.color}"></span><span>${val.name}</span>`;
            list.appendChild(row);
        });
    };

    openLegendBtn?.addEventListener('click', () => {
        buildLegend();
        modal.classList.add('hidden');
        legendModal.classList.remove('hidden');
    });
    closeLegendBtn?.addEventListener('click', () => legendModal.classList.add('hidden'));
    legendModal?.addEventListener('click', (e) => {
        if (e.target === legendModal) legendModal.classList.add('hidden');
    });

    const gmlInput = document.getElementById('local-gml');
    const csvInput = document.getElementById('local-csv');
    const excelInput = document.getElementById('local-excel');
    const processBtn = document.getElementById('process-data-btn');

    gmlInput?.addEventListener('change', (e) => selectedFiles.gml = e.target.files[0]);
    csvInput?.addEventListener('change', (e) => selectedFiles.csv = e.target.files[0]);
    excelInput?.addEventListener('change', (e) => selectedFiles.excel = e.target.files[0]);

    processBtn?.addEventListener('click', async () => {
        if (!selectedFiles.gml && !selectedFiles.csv) {
            alert('Lütfen en az GML ve Parsel Excel dosyasını seçiniz.');
            return;
        }
        modal.classList.add('hidden');
        showLoading('Veriler birleştiriliyor...');
        const progressArea = document.getElementById('merge-progress-area');
        const progressBar = document.getElementById('merge-progress-bar');
        const progressText = document.getElementById('merge-progress-text');
        if (progressArea) progressArea.classList.remove('hidden');

        const updateMergeProgress = (pct, stageMsg, counterMsg) => {
            if (progressBar) progressBar.style.width = pct + '%';
            if (progressText) progressText.textContent = stageMsg;
            updateLoadingProgress(pct, stageMsg, counterMsg);
        };

        try {
            masterRecords = await buildMasterData(updateMergeProgress);
            updateMergeProgress(100, 'Veriler yüklendi!');
            hideLoading();
            if (progressArea) progressArea.classList.add('hidden');
            alert(`✅ ${masterRecords.length} parsel yüklendi. Arama yaparak parselleri haritada görüntüleyin.`);

        } catch (err) {
            console.error(err);
            alert('İşlem hatası: ' + err.message);
        } finally {
            hideLoading();
            if (progressArea) progressArea.classList.add('hidden');
        }
    });
}

function showLoading(msg) {
    if (loadingOverlay) {
        updateLoadingProgress(0, msg || 'Hazırlanıyor...');
        loadingOverlay.classList.remove('hidden');
    }
}
function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

// Yükleme ekranını günceller: yüzde (0-100), aşama metni, opsiyonel sayaç
function updateLoadingProgress(pct, stageMsg, counterMsg) {
    pct = Math.round(Math.max(0, Math.min(100, pct || 0)));

    const textEl    = document.getElementById('loading-text');
    const pctEl     = document.getElementById('loading-pct');
    const ringEl    = document.getElementById('loading-ring-fill');
    const barEl     = document.getElementById('loading-bar');
    const counterEl = document.getElementById('loading-counter');

    if (textEl)    textEl.textContent    = stageMsg || '';
    if (pctEl)     pctEl.textContent     = pct + '%';
    if (barEl)     barEl.style.width     = pct + '%';
    if (counterEl) counterEl.textContent = counterMsg || '';

    // SVG halkası: stroke-dashoffset = circumference × (1 - pct/100)
    // Çevre = 2π × 26 ≈ 163.36
    if (ringEl) {
        const offset = 163.36 * (1 - pct / 100);
        ringEl.style.strokeDashoffset = offset;
    }
}

// Ürün gruplarına göre renklendirme.
// Uydu görüntüsündeki yeşil tarla/orman tonlarıyla karışmaması için
// yeşil yerine parlak ve uyduda nadir bulunan renkler kullanılır.
const PRODUCT_GROUP_COLORS = {
    tahil:  { color: '#C94C4C', name: 'Tahıllar (Buğday, Arpa, Yulaf, Mısır)' },
    yem:    { color: '#72B7D6', name: 'Yem Bitkileri (Yonca, Fiğ, Silajlık Mısır)' },
    meyve:  { color: '#8E5A9E', name: 'Meyveler (Ceviz, Elma, Kiraz, Üzüm)' },
    sebze:  { color: '#E99A3D', name: 'Sebzeler (Domates, Biber, Patates)' },
    yagli:  { color: '#D9829B', name: 'Yağlı Tohumlar (Ayçiçeği)' },
    bos:    { color: '#C8A77A', name: 'Boş Bırakılan / Nadas' },
    orman:  { color: '#70503C', name: 'Orman / Kavaklık' },
    diger:  { color: '#C7C7C7', name: 'Diğer Ürünler' },
    karisik:{ color: '#3FA7A3', name: 'Karışık (Aynı parselde 2+ ürün grubu)' },
    bosKayit:{ color: '#808080', name: 'Üretim Kaydı Yok' }
};

function getProductGroup(urun) {
    if (!urun) return null;
    const u = normalizeText(urun);

    // Yem bitkileri önce kontrol edilir (silajlık mısır bu gruba girer)
    const yemKws = ['yonca', 'fiğ', 'silaj', 'çayır otu', 'yem bezelyesi', 'ryegrass', 'korunga', 'sorgum', 'arı otu', 'italyan çimi', 'hayvan pancarı'];
    if (yemKws.some(k => u.includes(k))) return 'yem';

    if (u.includes('orman') || u.includes('kavak')) return 'orman';
    if (u.includes('boş bırakılan') || u.includes('nadas')) return 'bos';
    if (u.includes('ayçiçeği')) return 'yagli';

    const sebzeKws = ['domates', 'biber', 'patates', 'fasulye', 'soğan', 'lahana', 'kabak', 'bezelye', 'enginar', 'balkabağı', 'marul', 'salatalık', 'patlıcan', 'sarımsak', 'karnabahar', 'karnıbahar', 'ıspanak', 'pırasa', 'havuç', 'karpuz', 'kavun', 'bamya', 'brokoli', 'hıyar', 'bakla', 'şeker pancarı', 'nohut', 'mercimek', 'kuşkonmaz', 'maydanoz', 'safran'];
    if (sebzeKws.some(k => u.includes(k))) return 'sebze';

    if (u.includes('susam')) return 'yagli';

    const meyveKws = ['ceviz', 'armut', 'kiraz', 'şeftali', 'elma', 'erik', 'üzüm', 'fındık', 'kestane', 'badem', 'muşmula', 'nektarin', 'yaban mersini', 'ahududu', 'kızılcık', 'trabzon hurması', 'çilek', 'vişne', 'ayva', 'dut', 'böğürtlen', 'zeytin', 'yabanmersini', 'kayısı', 'incir', 'hünnap', 'kuşburnu', 'hurma', 'antep fıstığı'];
    if (meyveKws.some(k => u.includes(k))) return 'meyve';

    const tahilKws = ['buğday', 'arpa', 'yulaf', 'çavdar', 'tritikale', 'mısır'];
    if (tahilKws.some(k => u.includes(k))) return 'tahil';

    return 'diger';
}

async function renderFromMasterData(records, fitBounds = true) {
    try {
        // Mevcut poligonları temizle
        mapPolygons.forEach(p => map.removeLayer(p));
        mapPolygons = [];

        if (!records || !records.length) return;

        const bounds = L.latLngBounds();

        // Aynı mahalle-ada-parsel anahtarında birden fazla farklı ürün grubu
        // varsa parsel "karışık" kabul edilir ve kendine özel renk alır.
        const groupByKey = new Map();
        records.forEach(rec => {
            if (!rec.urun) return;
            const key = `${rec.mahalle}-${rec.ada}-${rec.parsel}`;
            if (!groupByKey.has(key)) groupByKey.set(key, new Set());
            groupByKey.get(key).add(getProductGroup(rec.urun));
        });

        showLoading('Harita hazırlanıyor...');
        const total = records.length;

        for (let i = 0; i < total; i++) {
            if (i > 0 && i % 1000 === 0) {
                updateLoadingProgress((i / total) * 100, 'Harita Geometrileri Çiziliyor...', `${i} / ${total}`);
                await yieldToUI();
            }
            
            const rec = records[i];

            // Tek kayıttaki bozuk veri diğer parsellerin çizilmesini engellemesin
            try {
                if (!rec.coords || !rec.coords.length) continue;

                const hasInfo = !!(rec.isletme || rec.urun);

                let fillColor;
                if (!hasInfo) {
                    fillColor = PRODUCT_GROUP_COLORS.bosKayit.color;
                } else {
                    const key = `${rec.mahalle}-${rec.ada}-${rec.parsel}`;
                    const groups = groupByKey.get(key);
                    const isKarisik = groups && groups.size > 1;
                    const grp = getProductGroup(rec.urun);
                    fillColor = isKarisik
                        ? PRODUCT_GROUP_COLORS.karisik.color
                        : (PRODUCT_GROUP_COLORS[grp] ? PRODUCT_GROUP_COLORS[grp].color : PRODUCT_GROUP_COLORS.diger.color);
                }

                const polygon = L.polygon(rec.coords, {
                    color: fillColor,
                    weight: 2,
                    opacity: 0.8,
                    fillColor: fillColor,
                    fillOpacity: 0.35
                }).addTo(map);

                polygon._rec = rec;

                const feature = { ada: rec.ada, parsel: rec.parsel, mahalle: rec.mahalle, coords: rec.coords };
                const owner = hasInfo ? {
                    'İşletme Adı': rec.isletme,
                    'TC': rec.tc,
                    'Köy': rec.mahalle,
                    'Ürün': rec.urun,
                    'Alan': rec.alan,
                    'Tarım Şekli': rec.tarim_sekli,
                    'Ekim Tarihi': rec.ekim_tarihi,
                    _phone: rec.telefon || null
                } : null;

                polygon.on('click', (e) => {
                    if (isMeasuringDist || isMeasuringArea) { addMeasurePoint(e.latlng); return; }
                    L.DomEvent.stopPropagation(e);
                    // Aktif arama varsa tıklanan parselin arama listesindeki sırasını bul
                    if (currentSearchResults.length > 0) {
                        const key = `${rec.mahalle}-${rec.ada}-${rec.parsel}`;
                        const idx = currentSearchResults.findIndex(r => `${r.mahalle}-${r.ada}-${r.parsel}` === key);
                        if (idx >= 0) currentSearchIndex = idx;
                    }
                    showParselInfo(feature, owner);
                });

                bounds.extend(polygon.getBounds());
                mapPolygons.push(polygon);
            } catch (err) {
                console.warn('Parsel çizilemedi:', rec.mahalle, rec.ada, rec.parsel, err);
            }
        }

        if (fitBounds && mapPolygons.length > 0) {
            map.fitBounds(bounds, { animate: false });
        }
    } finally {
        // Yükleme overlay'i her durumda kapansın (Android'de takılı kalmasın)
        hideLoading();
    }
}

// Bilgi panelinde gösterilen (seçili) parselin içini koyulaştırır.
// Aynı mahalle-ada-parsel için birden fazla geometri varsa hepsi vurgulanır.
function highlightSelectedParsel(feature) {
    mapPolygons.forEach(p => {
        p.setStyle({ fillOpacity: 0.35, weight: 2 });
    });
    if (!feature) return;
    const key = `${feature.mahalle}-${feature.ada}-${feature.parsel}`;
    mapPolygons.forEach(p => {
        const rec = p._rec;
        if (rec && `${rec.mahalle}-${rec.ada}-${rec.parsel}` === key) {
            p.setStyle({ fillOpacity: 0.75, weight: 3 });
        }
    });
}

// Tarayıcıya arayüzü güncellemesi için fırsat verir (Paint)
const yieldToUI = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

async function buildMasterData(progressCb) {
    progressCb?.(5, 'GML dosyası okunuyor...', '');
    await yieldToUI();
    
    gmlFeatures = [];
    if (selectedFiles.gml) {
        const text = await selectedFiles.gml.text();
        await parseGML(text, progressCb);
    }
    progressCb?.(35, `${gmlFeatures.length} parsel geometrisi okundu.`, '');

    parselData = [];
    if (selectedFiles.csv) {
        progressCb?.(35, 'Parsel Excel/CSV dosyası okunuyor...', '');
        parselData = await readExcelOrCsvSmart(
            selectedFiles.csv,
            [['ADA', 'PARSEL'], ['ÜRÜN', 'URUN'], ['İŞLETME', 'ISLETME']]
        );
    }
    progressCb?.(55, `${parselData.length} parsel kaydı okundu.`, '');

    farmerData = [];
    if (selectedFiles.excel) {
        progressCb?.(55, 'ÇKS Çiftçi Veritabanı okunuyor...', '');
        farmerData = await readExcelOrCsvSmart(
            selectedFiles.excel,
            [['TC', 'TELEFON'], ['ADI', 'SOYAD'], ['UNVAN']]
        );
    }
    progressCb?.(70, 'Veriler eşleştiriliyor...', '');

    const farmerByTC = new Map();
    const farmerByName = new Map();
    farmerData.forEach(f => {
        const tc = (f['TC_V NO'] || f['TC'] || f['T.C. No'] || f['TC No'] || f['T.C.'] || '').trim();
        const nm = normalizeText(f['ADI/UNVANI'] || f['Ad Soyad'] || f['Adı Soyadı'] || f['ADI SOYADI'] || f['İşletme Adı'] || '');
        if (tc) farmerByTC.set(tc, f);
        if (nm) farmerByName.set(nm, f);
    });

    const parselMap = new Map();
    parselData.forEach(p => {
        const rawMahalle = p['Köy'] || p['KÖY'] || p['Mahalle'] || p['MAHALLE'] ||
            p['Mahalle Adı'] || p['Köyü'] || p['Köy/Mahalle'] ||
            p['KÖY/MAHALLE'] || p['KÖY/MAHALLE ADI'] || p['İlçe/Köy/Mahalle'] || '';
        const mahalle = getCleanMahalle(rawMahalle);
        const ada = (p['Ada\nNo'] || p['Ada No'] || p['Ada'] || p['AdaNo'] || p['Ada_No'] || '').toString().trim().replace(/^0+/, '') || '0';
        const parsel = (p['Parsel\nNo'] || p['Parsel No'] || p['Parsel'] || p['ParselNo'] || p['Parsel_No'] || '').toString().trim().replace(/^0+/, '') || '0';

        const key = `${mahalle}-${ada}-${parsel}`;
        p._matched = false;
        if (!parselMap.has(key)) parselMap.set(key, []);
        parselMap.get(key).push(p);
    });

    const records = [];
    const totalGml = gmlFeatures.length;
    for (let i = 0; i < totalGml; i++) {
        const feat = gmlFeatures[i];
        
        if (i % 2000 === 0) {
            progressCb?.(70 + (i / totalGml) * 10, 'GML ve Excel Eşleştiriliyor...', `${i} / ${totalGml}`);
            await yieldToUI();
        }

        const fAda = feat.ada.toString().replace(/^0+/, '') || '0';
        const fParsel = feat.parsel.toString().replace(/^0+/, '') || '0';
        const fMahalle = getCleanMahalle(feat.mahalle);

        const pList = parselMap.get(`${fMahalle}-${fAda}-${fParsel}`);

        if (!pList || pList.length === 0) {
            records.push({
                ada: feat.ada,
                parsel: feat.parsel,
                mahalle: feat.mahalle,
                coords: feat.coords,
                isletme: '',
                tc: '',
                urun: '',
                alan: '',
                tarim_sekli: '',
                ekim_tarihi: '',
                telefon: ''
            });
            continue;
        }

        pList.forEach(p => {
            p._matched = true;
            const pTC = (p['TC'] || p['TC / Vergi No'] || '').trim();
            const pName = normalizeText(p['İşletme Adı'] || p['İşletme'] || p['Ad Soyad'] || p['Sahibi'] || '');
            const farmer = (pTC && farmerByTC.get(pTC)) || (pName && farmerByName.get(pName)) || {};
            const phone = farmer['TELEFON'] || farmer['Telefon'] || farmer['Cep Tel'] || farmer['GSM'] || farmer['CEP TEL'] || '';
            const adres = farmer['ADRES'] || farmer['Adres'] || farmer['Adresi'] || p['Köy'] || p['KÖY'] || p['Mahalle'] || p['MAHALLE'] || p['Köyü'] || '';

            records.push({
                ada: feat.ada,
                parsel: feat.parsel,
                mahalle: feat.mahalle,
                coords: feat.coords,
                isletme: p['İşletme Adı'] || p['İşletme'] || p['ADI SOYADI'] || p['AD SOYAD'] || '',
                tc: pTC,
                urun: p['Ürün'] || p['ÜRÜN'] || '',
                alan: p['Kullanılan  Alan(da)'] || p['Kullanılan Alan(da)'] || p['Kullanılan Alan'] || p['Alan'] || p['Alanı'] || p['Ekili Alan'] || p['Tapu Alanı'] || p['ParselAlanı'] || p['Alan (da)'] || '',
                tarim_sekli: p['Tarım Şekli'] || '',
                ekim_tarihi: p['Ekim Tarihi'] || p['EKİM TARİHİ'] || '',
                telefon: phone,
                adres: adres
            });
        });
    }

    // Eşleşmeyen (GML'de harita karşılığı olmayan) Excel parsellerini ekle
    const totalParsel = parselData.length;
    for (let i = 0; i < totalParsel; i++) {
        const p = parselData[i];
        
        if (i % 2000 === 0) {
            progressCb?.(80 + (i / totalParsel) * 5, 'Eşleşmeyen Parseller Ekleniyor...', `${i} / ${totalParsel}`);
            await yieldToUI();
        }

        if (!p._matched) {
            const pTC = (p['TC'] || p['TC / Vergi No'] || '').trim();
            const pName = normalizeText(p['İşletme Adı'] || p['İşletme'] || p['Ad Soyad'] || p['Sahibi'] || '');
            const farmer = (pTC && farmerByTC.get(pTC)) || (pName && farmerByName.get(pName)) || {};
            const phone = farmer['TELEFON'] || farmer['Telefon'] || farmer['Cep Tel'] || farmer['GSM'] || farmer['CEP TEL'] || '';
            const rawMahalle = p['Köy'] || p['KÖY'] || p['Mahalle'] || p['MAHALLE'] || p['Köyü'] || p['Mahalle Adı'] || '';

            records.push({
                ada: (p['Ada\nNo'] || p['Ada No'] || p['Ada'] || p['AdaNo'] || p['Ada_No'] || '').toString().trim().replace(/^0+/, '') || '0',
                parsel: (p['Parsel\nNo'] || p['Parsel No'] || p['Parsel'] || p['ParselNo'] || p['Parsel_No'] || '').toString().trim().replace(/^0+/, '') || '0',
                mahalle: getCleanMahalle(rawMahalle) || rawMahalle,
                coords: [], // Geometri yok
                isletme: p['İşletme Adı'] || p['İşletme'] || p['ADI SOYADI'] || p['AD SOYAD'] || '',
                tc: pTC,
                urun: p['Ürün'] || p['ÜRÜN'] || '',
                alan: p['Kullanılan  Alan(da)'] || p['Kullanılan Alan(da)'] || p['Kullanılan Alan'] || p['Alan'] || p['Alanı'] || p['Ekili Alan'] || p['Tapu Alanı'] || p['ParselAlanı'] || p['Alan (da)'] || '',
                tarim_sekli: p['Tarım Şekli'] || '',
                ekim_tarihi: p['Ekim Tarihi'] || p['EKİM TARİHİ'] || '',
                telefon: phone,
                adres: farmer['ADRES'] || farmer['Adres'] || farmer['Adresi'] || rawMahalle
            });
        }
    }

    progressCb?.(85, `${records.length} kayıt birleştirildi.`, '');
    return records;
}

async function readExcelOrCsvSmart(file, keywordSets) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        let rangeIdx = 0;
        const primaryKws = keywordSets[0];
        for (let i = 0; i < 15; i++) {
            const row = XLSX.utils.sheet_to_json(sheet, { range: i, header: 1 })[0] || [];
            const rowUpper = row.map(c => String(c || '').toUpperCase());
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
        const text = await file.text();
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

async function parseGML(xmlString, progressCb) {
    progressCb?.(5, 'GML Ayrıştırılıyor (Bu işlem kısa sürebilir)...', 'Lütfen Bekleyin');
    await yieldToUI(); // DOMParser çok ağır olduğu için öncesinde UI'ın güncellenmesini bekle

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const members = xmlDoc.getElementsByTagNameNS("*", "featureMember");
    const total = members.length;

    for (let idx = 0; idx < total; idx++) {
        const member = members[idx];
        
        if (idx % 1000 === 0) {
            progressCb?.(10 + (idx / total) * 25, 'GML Geometrileri Çıkarılıyor...', `${idx} / ${total}`);
            await yieldToUI();
        }

        const layer = member.getElementsByTagNameNS("*", "Layer1")[0] || member.firstElementChild;
        if (!layer) continue;

        let adaNo = "";
        let parselNo = "";
        let mahalle = "";
        let geom = null;

        for (let i = 0; i < layer.children.length; i++) {
            const child = layer.children[i];
            const tagName = child.localName.toUpperCase(); // namespace'siz büyük harf

            if (['ADANO', 'ADA_NO', 'ADA', 'AD'].includes(tagName)) {
                if (!adaNo) adaNo = child.textContent?.trim() || "";
            } else if (['PARSELNO', 'PARSEL_NO', 'PARSEL', 'PAR'].includes(tagName)) {
                if (!parselNo) parselNo = child.textContent?.trim() || "";
            } else if (['MAHALLE', 'MAHALLEADI', 'MAHALLE_AD', 'MAHALLE_ADI', 'KOYADI', 'KOY', 'KOY_ADI', 'MAHALLEAD'].includes(tagName)) {
                if (!mahalle) mahalle = child.textContent?.trim() || "";
            } else if (['GEOM', 'GEOMETRY', 'GEOMETRI', 'THE_GEOM'].includes(tagName)) {
                geom = child;
            }
        }

        if (!adaNo || !parselNo || !geom) continue;

        let coordinates = [];
        const coordNodes = geom.getElementsByTagNameNS("*", "coordinates");
        const posNodes = geom.getElementsByTagNameNS("*", "posList");

        // <coordinates> formatı (lon,lat lon,lat)
        for (let node of coordNodes) {
            const coordString = node.textContent;
            if (coordString) {
                const pairs = coordString.trim().split(/\s+/);
                const ring = pairs.map(p => {
                    const parts = p.split(",");
                    if (parts.length >= 2) {
                        return [parseFloat(parts[1]), parseFloat(parts[0])]; // [lat, lng]
                    }
                    return null;
                }).filter(Boolean);
                if (ring.length > 0) coordinates.push(ring);
            }
        }

        // <posList> formatı (lon lat lon lat veya lat lon lat lon)
        // Genelde GML'de x y şeklindedir (lon lat)
        for (let node of posNodes) {
            const coordString = node.textContent;
            if (coordString) {
                const values = coordString.trim().split(/\s+/).map(parseFloat);
                const ring = [];
                for (let j = 0; j < values.length; j += 2) {
                    if (j + 1 < values.length) {
                        ring.push([values[j + 1], values[j]]); // [lat, lng] varsayımı (y, x)
                    }
                }
                if (ring.length > 0) coordinates.push(ring);
            }
        }

        if (coordinates.length === 0) continue;

        gmlFeatures.push({
            ada: adaNo,
            parsel: parselNo,
            mahalle: mahalle,
            coords: coordinates
        });
    }
}

/**
 * AGE programındaki KelimeKucult() fonksiyonunun JS karşılığı.
 * Türkçe büyük → küçük harf dönüşümünü tüm tarayıcılarda tutarlı yapar:
 *   İ → i  (Türkçe noktalı büyük i)
 *   I → ı  (Latin büyük I → Türkçe küçük ı)
 *   Ş Ğ Ü Ö Ç → ş ğ ü ö ç
 * toLocaleLowerCase('tr-TR') iOS Safari ve eski Android WebView'da
 * farklı sonuç verebilir; bu yüzden replace zinciri + toLowerCase kullanıyoruz.
 */
function normalizeText(text) {
    if (text === null || text === undefined || text === '') return '';
    return String(text)
        .replace(/İ/g, 'i')
        .replace(/I/g, 'ı')
        .replace(/Ş/g, 'ş')
        .replace(/Ğ/g, 'ğ')
        .replace(/Ü/g, 'ü')
        .replace(/Ö/g, 'ö')
        .replace(/Ç/g, 'ç')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}


function getCleanMahalle(str) {
    if (!str) return "";
    let s = normalizeText(str);
    // Boşlukla ayrılmış ekler: "çavuşköy mahallesi" -> "çavuşköy"
    s = s.replace(/\b(mahallesi|mah|mah\.|köyü|koyu|köy)\b/g, '');
    // Birleşik son ekler: "çavuşköy" -> "çavuş"
    s = s.replace(/(mahallesi|mahalle|köyü|koyu|köy|koy)$/g, '');
    return s.trim();
}

// --- Nearby Parcels Feature ---
const NEARBY_RADIUS_KM = 1.0;

// Haversine formula: distance between two lat/lng points in km
function getDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate centroid of a polygon (first ring)
function getPolygonCentroid(coords) {
    if (!coords || !coords.length || !coords[0].length) return null;
    const ring = coords[0];
    let latSum = 0, lngSum = 0;
    for (const [lat, lng] of ring) {
        latSum += lat;
        lngSum += lng;
    }
    return [latSum / ring.length, lngSum / ring.length];
}

// Find parcels within radius of user location
function findNearbyParcels(userLat, userLng, radiusKm = NEARBY_RADIUS_KM) {
    if (!masterRecords || !masterRecords.length) return [];
    
    const nearby = [];
    for (const rec of masterRecords) {
        if (!rec.coords || !rec.coords.length) continue;
        const centroid = getPolygonCentroid(rec.coords);
        if (!centroid) continue;
        
        const dist = getDistanceKm(userLat, userLng, centroid[0], centroid[1]);
        if (dist <= radiusKm) {
            nearby.push({ ...rec, distance: dist });
        }
    }
    // Sort by distance
    nearby.sort((a, b) => a.distance - b.distance);
    return nearby;
}

// Yakındaki parselleri normal arama gibi currentSearchResults'e yükle ve göster
function displayNearbyParcels(parcels) {
    if (!parcels.length) {
        alert('1 km yarıçapında parsel bulunamadı.');
        return;
    }

    // Normal arama gibi sonuçları global state'e aktar
    currentSearchResults = parcels;
    currentSearchIndex = 0;
    isSearchActive = true;

    // Haritada normal arama poligonları olarak çiz (kutucuksuz)
    renderFromMasterData(currentSearchResults, true);

    // İlk sonucu info panelinde göster
    showSearchResult(0);
}

// Yakındaki parselleri temizle
function clearNearbyParcels() {
    if (nearbyParcelsLayer) {
        map.removeLayer(nearbyParcelsLayer);
        nearbyParcelsLayer = null;
    }
    nearbyParcelsLabels = [];
}

// Ana fonksiyon: yakındaki parselleri bul ve normal arama gibi göster
async function showNearbyParcels() {
    const btn = document.getElementById('nearby-parcels');

    if (!masterRecords || !masterRecords.length) {
        alert('Önce veri yükleyin (⚙️ Ayarlar menüsü).');
        return;
    }

    if (!userMarker) {
        alert('Önce konumunuzu alın (📍 butonuna basın).');
        startLocationTracking(true);
        return;
    }

    const userLatLng = userMarker.getLatLng();
    btn.innerText = '⏳';
    btn.disabled = true;

    try {
        const nearby = findNearbyParcels(userLatLng.lat, userLatLng.lng);
        displayNearbyParcels(nearby);
        btn.innerText = '🔍';
        btn.title = 'Yakındaki Parseller (1km)';
        btn.style.background = '';
    } catch (err) {
        console.error(err);
        alert('Hata: ' + err.message);
        btn.innerText = '🔍';
    } finally {
        btn.disabled = false;
    }
}

// 'yem bitkisi' aramasında aranacak ürün listesi (global sabit)
const YEM_BITKISI_LISTESI = [
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
].map(normalizeText);

// Ürün sözlüğü: yüklenen verideki tüm ürün adlarından türetilir.
// Yazılan bir terimin "ürün adı" olup olmadığını anlamak için kullanılır.
let _urunDictCache = null;
function getUrunDict() {
    if (_urunDictCache && _urunDictCache.ref === masterRecords) return _urunDictCache;
    const fullNames = new Set();
    const tokens = new Set();
    masterRecords.forEach(r => {
        const u = normalizeText(r.urun || '');
        if (!u) return;
        fullNames.add(u);
        u.replace(/[()]/g, ' ').split(/\s+/).forEach(t => {
            if (t.length >= 3) tokens.add(t);
        });
    });
    _urunDictCache = { ref: masterRecords, fullNames, tokens };
    return _urunDictCache;
}

// Bir arama terimi ürün adı mı? (tam ürün adının alt dizesi veya ürün adının bir parçası)
function isUrunTerm(term) {
    const dict = getUrunDict();
    if (dict.tokens.has(term)) return true;
    for (const u of dict.fullNames) {
        if (u.includes(term)) return true;
    }
    return false;
}

// ── Alan prefiksli arama (v2.9.0) ──
// "mahalle: süle" → sadece mahalle alanında
// "isim ahmet"   → sadece işletme sahibi alanında
// "ürün: üzüm,arpa" → virgülle ayrılan ürünlerden herhangi biri (OR)
const FIELD_ALIASES = {
    mahalle: ['mahalle', 'köy', 'koy'],
    isim: ['isim', 'işletme', 'isletme', 'sahip', 'çiftçi'],
    urun: ['ürün', 'urun'],
    tc: ['tc', 'tckimlik'],
    ada: ['ada'],
    parsel: ['parsel']
};

function parseFieldQuery(rawQuery) {
    const result = { mahalle: [], isim: [], urun: [], tc: [], ada: [], parsel: [], genel: [] };
    const tokens = rawQuery.split(/\s+/).filter(Boolean);

    const isFieldName = (t) => {
        const clean = normalizeText(t).replace(/[:"",.]/g, '');
        return Object.values(FIELD_ALIASES).some(aliases => aliases.includes(clean));
    };

    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        const lower = normalizeText(token);
        const cleanTok = lower.replace(/[:"",.]/g, '');

        let matchedField = null;
        for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
            if (aliases.includes(cleanTok)) { matchedField = field; break; }
        }

        if (!matchedField) {
            result.genel.push(token);
            i++;
            continue;
        }

        // Değerler: aynı token içinde (isim:süle) veya sonraki alan adına kadar
        const vals = [];
        if (lower.includes(':') && token.includes(':') && token.split(':')[1]) {
            vals.push(token.split(':')[1]);
        }
        let j = i + 1;
        while (j < tokens.length && !isFieldName(tokens[j])) {
            vals.push(tokens[j]);
            j++;
        }
        result[matchedField].push(vals.join(' '));
        i = j;
    }
    return result;
}

// Mahalle filtresi: önce tam eşleşme (çavuşköy ↔ çavuş gibi ekler temizlenmiş),
// tam eşleşen yoksa kısmi (alt dize) eşleşmeye düşer.
// Böylece "süle" ararken "süleymaniye" karışmaz (tam "SÜLE" varsa sadece o gelir).
function filterByMahalle(records, terms) {
    const cleanTerms = terms.map(t => getCleanMahalle(t)).filter(Boolean);
    const exact = records.filter(r => {
        const mc = getCleanMahalle(r.mahalle || '');
        return mc && cleanTerms.some(t => t === mc);
    });
    if (exact.length > 0) return exact;
    return records.filter(r => {
        const m = normalizeText(r.mahalle || '');
        const mc = getCleanMahalle(r.mahalle || '');
        return cleanTerms.some(t => t && (m.includes(t) || mc.includes(t)));
    });
}

function setupSearch() {
    const searchInput = document.getElementById('global-search');
    const searchBtn = document.getElementById('search-button');
    const resultsPanel = document.getElementById('search-results');

    if (!searchInput || !searchBtn) {
        console.warn('Arama elementleri bulunamadı. Arama özelliği devre dışı.');
        return;
    }

    const performSearch = () => {
        const query = searchInput.value.trim();
        if (!query) {
            isSearchActive = false;
            currentSearchResults = [];
            renderFromMasterData(masterRecords);
            infoPanel.classList.add('hidden');
            return;
        }

        // Alan prefiksli terimleri ayır (v2.9.0):
        //   mahalle: süle   → sadece mahalle alanında (tam eşleşme öncelikli)
        //   isim ahmet      → sadece işletme sahibi alanında
        //   ürün: üzüm,arpa → virgülle ayrılan ürünlerden herhangi biri (OR)
        //   tc: / ada: / parsel: → ilgili alanda
        const parsed = parseFieldQuery(query);

        // Ürün alanındaki virgüllü terimleri ayrıştır ("üzüm,arpa,elma")
        const urunFieldTerms = [];
        parsed.urun.forEach(v => {
            v.split(',').map(t => t.trim()).filter(Boolean).forEach(t => urunFieldTerms.push(normalizeText(t)));
        });

        // İsim alanındaki kelimeleri ayrıştır (hepsi bulunmalı → AND)
        const isimFieldTerms = [];
        parsed.isim.forEach(v => {
            v.split(/\s+/).map(t => t.trim()).filter(Boolean).forEach(t => isimFieldTerms.push(normalizeText(t)));
        });

        // Prefiksi olmayan genel terimler için akıllı arama mantığı
        let normalizedQuery = normalizeText(parsed.genel.join(' '));
        // 'yem bitkisi' aramalarını tek bir özel anahtar kelimeye dönüştür
        normalizedQuery = normalizedQuery.replace(/yem bitkis[iİ]/g, 'yem_bitkisi_alias').replace(/yem bitkiler[iİ]/g, 'yem_bitkisi_alias');

        const searchTerms = normalizedQuery.split(/\s+/);

        // Terimleri ikiye ayır:
        // - ürünTerms: ürün adı olanlar (ör. "buğday", "arpa", "mısır") → OR ile aranır
        // - otherTerms: isim/köy/TC/ada/parsel gibi diğer terimler → AND ile aranır
        const urunTerms = [];
        const otherTerms = [];
        searchTerms.forEach(term => {
            if (term === 'yem_bitkisi_alias' || isUrunTerm(term)) {
                urunTerms.push(term);
            } else {
                otherTerms.push(term);
            }
        });

        // Terim satırla eşleşiyor mu? Köy adlarında ekleri esnetir:
        // "çavuşköy" ↔ verideki "çavuş" gibi. (getCleanMahalle üretilen
        // temiz hal de satıra eklendiğinden her iki yazım da bulunur.)
        const matchesTerm = (term, rowText) => {
            if (rowText.includes(term)) return true;
            const cleanTerm = getCleanMahalle(term);
            return !!cleanTerm && cleanTerm !== term && rowText.includes(cleanTerm);
        };

        // Mahalle prefiksi varsa önce tam eşleşme öncelikli daralt.
        // Böylece "mahalle: süle" yazınca süleymaniye karışmaz.
        let candidates = masterRecords;
        if (parsed.mahalle.length) {
            candidates = filterByMahalle(candidates, parsed.mahalle);
        }

        currentSearchResults = candidates.filter(r => {
            // Alan bazlı kontroller
            if (isimFieldTerms.length) {
                const isimTxt = normalizeText(r.isletme || '');
                if (!isimFieldTerms.every(t => isimTxt.includes(t))) return false;
            }

            if (urunFieldTerms.length) {
                const urunTxt = normalizeText(r.urun || '');
                const urunOk = urunFieldTerms.some(t => {
                    if (t === 'yem_bitkisi_alias') return YEM_BITKISI_LISTESI.some(yem => urunTxt.includes(yem));
                    return urunTxt.includes(t);
                });
                if (!urunOk) return false;
            }

            if (parsed.tc.length) {
                const tcTxt = normalizeText(r.tc || '');
                if (!parsed.tc.some(t => tcTxt.includes(normalizeText(t)))) return false;
            }

            if (parsed.ada.length) {
                const adaTxt = normalizeText(r.ada || '');
                if (!parsed.ada.some(t => adaTxt.includes(normalizeText(t)))) return false;
            }

            if (parsed.parsel.length) {
                const parselTxt = normalizeText(r.parsel || '');
                if (!parsed.parsel.some(t => parselTxt.includes(normalizeText(t)))) return false;
            }

            // Genel (prefiksi olmayan) terimler için eski akıllı arama
            const rowText = normalizeText(
                // Her alan için null/undefined güvenliği: String() ile sarıyoruz
                // Mahallenin hem ham hem "köy/mahalle ekleri atılmış" hali eklenir
                `${r.isletme || ''} ${r.mahalle || ''} ${getCleanMahalle(r.mahalle || '')} ${r.urun || ''} ${r.tc || ''} ${r.ada || ''} ${r.parsel || ''} ${r.ada || ''}/${r.parsel || ''}`
            );

            // Ürün dışı terimler: hepsi satırda bulunmalı (AND)
            if (!otherTerms.every(term => matchesTerm(term, rowText))) return false;

            // Ürün terimleri varsa: herhangi biri satırda bulunmalı (OR),
            // tıpkı "yem bitkisi" araması gibi. Bulunmayan ürün atlanır,
            // diğer ürünlerin sonuçları gösterilir.
            if (urunTerms.length > 0) {
                const urunOk = urunTerms.some(term => {
                    if (term === 'yem_bitkisi_alias') {
                        const urunNorm = normalizeText(r.urun || '');
                        return YEM_BITKISI_LISTESI.some(yem => urunNorm.includes(yem));
                    }
                    return matchesTerm(term, rowText);
                });
                if (!urunOk) return false;
            }

            return true;
        });

        if (currentSearchResults.length > 0) {
            isSearchActive = true;
            renderFromMasterData(currentSearchResults);
            currentSearchIndex = 0;
            showSearchResult(0);
        } else {
            alert('Arama kriterinize uygun sonuç bulunamadı.');
        }
    };

    searchBtn.onclick = performSearch;
    searchInput.onkeypress = (e) => { if (e.key === 'Enter') performSearch(); };

    // Arama Paneli Kapat/Aç
    const searchContainer = document.getElementById('search-container');
    const showSearchBtn = document.getElementById('show-search');
    const toggleSearchBtn = document.getElementById('toggle-search-btn');

    if (showSearchBtn && searchContainer && toggleSearchBtn) {
        showSearchBtn.onclick = () => {
            searchContainer.classList.remove('ui-hidden');
            showSearchBtn.classList.add('hidden');
        };
        toggleSearchBtn.onclick = () => {
            searchContainer.classList.add('ui-hidden');
            showSearchBtn.classList.remove('hidden');
        };
    }

    // Rapor Butonu
    const printBtn = document.getElementById('print-report-btn');
    if (printBtn) {
        printBtn.onclick = () => {
            if (activeFeature && currentOwnerData) {
                generateReport();
            } else {
                alert('Lütfen rapor almak için haritadan bir parsel seçin.');
            }
        };
    }
}

window.showSearchResult = function (index) {
    if (!currentSearchResults || currentSearchResults.length === 0) return;

    if (index < 0) index = currentSearchResults.length - 1;
    if (index >= currentSearchResults.length) index = 0;

    currentSearchIndex = index;
    const r = currentSearchResults[index];

    if (r.coords && r.coords.length > 0) {
        const bounds = L.polygon(r.coords).getBounds();
        map.fitBounds(bounds, { animate: false, padding: [20, 20] });
    }

    showParselInfo(r, r.isletme ? {
        'İşletme Adı': r.isletme,
        'TC': r.tc,
        'Köy': r.mahalle,
        'Ürün': r.urun,
        'Alan': r.alan,
        'Tarım Şekli': r.tarim_sekli,
        'Ekim Tarihi': r.ekim_tarihi,
        _phone: r.telefon
    } : null);
};

function showParselInfo(feature, owner) {
    activeFeature = feature;
    currentOwnerData = owner;
    infoPanel.classList.remove('hidden');
    highlightSelectedParsel(feature);

    let html = `
        <div style="margin-bottom: 15px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
            <h3 style="font-size: 1.3rem; font-weight: 700; color: #2ecc71; letter-spacing: 0.5px; margin: 0;">${feature.mahalle}</h3>
            <div style="font-size: 0.95rem; color: #cbd5e1; font-weight: 500; margin-top: 4px;">Ada: <span style="color: #fff;">${feature.ada}</span> &nbsp;&bull;&nbsp; Parsel: <span style="color: #fff;">${feature.parsel}</span></div>
        </div>
    `;

    if (owner) {
        html += `
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; flex-direction: column; text-align: center; margin-bottom: 5px;">
                    <span style="font-size: 0.75rem; color: #94A3B8; text-transform: uppercase; letter-spacing: 1px;">İşletme Sahibi</span>
                    <span style="font-size: 1.15rem; color: #fff; font-weight: 600; line-height: 1.2;">${owner['İşletme Adı']}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 8px;">
                    <span style="color: #94A3B8; font-size: 0.9rem;">T.C. Kimlik</span>
                    <span style="color: #fff; font-weight: 500;">${owner['TC'] || '-'}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 8px;">
                    <span style="color: #94A3B8; font-size: 0.9rem;">Ürün / Alan</span>
                    <span style="color: #2ecc71; font-weight: bold; font-size: 0.95rem;">${owner['Ürün']} &bull; ${owner['Alan']} da</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 8px;">
                    <span style="color: #94A3B8; font-size: 0.9rem;">Tarım Şekli</span>
                    <span style="color: #fff; font-weight: 500;">${owner['Tarım Şekli'] || '-'}</span>
                </div>
                
                ${owner['Ekim Tarihi'] ? `
                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 8px;">
                    <span style="color: #94A3B8; font-size: 0.9rem;">Ekim Tarihi</span>
                    <span style="color: #fff; font-weight: 500;">${owner['Ekim Tarihi']}</span>
                </div>` : ''}
                
                ${owner._phone ? `
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 5px;">
                    <span style="color: #94A3B8; font-size: 0.9rem;">Telefon</span>
                    <a href="tel:${owner._phone}" style="background: linear-gradient(135deg, #16a34a, #22c55e); color: #fff; padding: 6px 14px; border-radius: 20px; text-decoration: none; font-size: 0.85rem; font-weight: bold; box-shadow: 0 4px 10px rgba(34,197,94,0.3); transition: transform 0.2s;">📞 ${owner._phone}</a>
                </div>` : ''}
            </div>
        `;
    } else {
        html += `<div style="text-align: center; padding: 20px 0; color: #94A3B8; font-style: italic;">Bu parsel için üretim kaydı bulunamadı.</div>`;
    }

    // Aktif arama sonucu varsa (birden fazla parsel) her zaman navigasyon göster
    if (currentSearchResults.length > 1) {
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                <button onclick="showSearchResult(currentSearchIndex - 1)" style="padding: 8px 12px; font-weight:bold; cursor:pointer; border-radius:8px; background:linear-gradient(135deg, #3b82f6, #2563eb); color:white; border:none; box-shadow: 0 2px 8px rgba(37,99,235,0.3); font-size: 0.85rem;">&laquo; Önceki</button>
                <span style="font-size:0.9rem; font-weight:bold; color:#fff; background: rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 20px;">${currentSearchIndex + 1} / ${currentSearchResults.length}</span>
                <button onclick="showSearchResult(currentSearchIndex + 1)" style="padding: 8px 12px; font-weight:bold; cursor:pointer; border-radius:8px; background:linear-gradient(135deg, #3b82f6, #2563eb); color:white; border:none; box-shadow: 0 2px 8px rgba(37,99,235,0.3); font-size: 0.85rem;">Sonraki &raquo;</button>
            </div>
        `;
    }

    parselDetails.innerHTML = html;
}

function setupTools() {
    closePanelBtn.onclick = () => {
        infoPanel.classList.add('hidden');
        highlightSelectedParsel(null);
        activeFeature = null;
        currentOwnerData = null;
    };

    // Haritada boş yere tıklamak paneli KAPATMAZ
    // (Kullanıcı haritaya tıklayarak parsele ulaşır, boş tık görmezden gelinir)

    // --- UI Panel Toggles (Header) ---
    const header = document.querySelector('header');
    const showHeaderBtn = document.getElementById('show-header');
    const toggleHeaderBtn = document.getElementById('toggle-header');

    if (showHeaderBtn && header && toggleHeaderBtn) {
        showHeaderBtn.onclick = () => {
            header.classList.remove('ui-hidden');
            showHeaderBtn.classList.add('hidden');
        };
        toggleHeaderBtn.onclick = () => {
            header.classList.add('ui-hidden');
            showHeaderBtn.classList.remove('hidden');
        };
    }

    document.getElementById('locate-me').onclick = () => {
        if (userMarker) map.setView(userMarker.getLatLng(), 18);
        else startLocationTracking(true);
    };
    document.getElementById('nearby-parcels').onclick = showNearbyParcels;
    document.getElementById('measure-dist').onclick = toggleMeasureDist;
    document.getElementById('measure-area').onclick = toggleMeasureArea;
    clearMeasureBtn.onclick = clearMeasurements;
}

function startLocationTracking(zoom = false) {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((position) => {
            const latlng = [position.coords.latitude, position.coords.longitude];
            if (!userMarker) {
                userMarker = L.circleMarker(latlng, { radius: 8, fillColor: "#4285F4", fillOpacity: 1, color: "white", weight: 2 }).addTo(map);
                if (zoom) map.setView(latlng, 18);
            } else userMarker.setLatLng(latlng);
        }, null, { enableHighAccuracy: true });
    }
}

function toggleMeasureDist() {
    clearMeasurements();
    isMeasuringDist = !isMeasuringDist;
    isMeasuringArea = false;
    if (isMeasuringDist) {
        measureToast.classList.remove('hidden');
        measureText.innerText = "Mesafe ölçmek için tıklayın";
    } else measureToast.classList.add('hidden');
}

function toggleMeasureArea() {
    clearMeasurements();
    isMeasuringArea = !isMeasuringArea;
    isMeasuringDist = false;
    if (isMeasuringArea) {
        measureToast.classList.remove('hidden');
        measureText.innerText = "Alan ölçmek için tıklayın";
    } else measureToast.classList.add('hidden');
}

function addMeasurePoint(latlng) {
    measurePath.push(latlng);
    measureLayer.clearLayers();
    measurePath.forEach(p => L.circleMarker(p, { radius: 4, fillColor: "white", fillOpacity: 1, color: "#2ecc71", weight: 2 }).addTo(measureLayer));

    if (isMeasuringDist) {
        L.polyline(measurePath, { color: "#f1c40f", weight: 3 }).addTo(measureLayer);
        let total = 0;
        for (let i = 0; i < measurePath.length - 1; i++) total += measurePath[i].distanceTo(measurePath[i + 1]);
        measureText.innerText = `Mesafe: ${total.toFixed(2)} m`;
    } else if (isMeasuringArea && measurePath.length >= 3) {
        L.polygon(measurePath, { color: "#f1c40f", weight: 2, fillColor: "#f1c40f", fillOpacity: 0.35 }).addTo(measureLayer);
        // Simplified area calculation
        measureText.innerText = `Alan ölçülüyor...`;
    }
}

function clearMeasurements() {
    measurePath = [];
    measureLayer.clearLayers();
    measureText.innerText = "";
}

window.generateReport = async () => {
    if (!currentOwnerData) {
        alert('Lütfen önce bir parsel seçin.');
        return;
    }
    showLoading('Rapor Hazırlanıyor...');

    const tc = currentOwnerData['TC'];
    const ad = currentOwnerData['İşletme Adı'];

    // Eğer aktif bir arama varsa parselleri arama havuzundan, yoksa genel havuzdan seç
    const sourceRecords = isSearchActive ? currentSearchResults : masterRecords;

    const ownerParcels = sourceRecords.filter(r =>
        (tc && r.tc === tc) ||
        (!tc && normalizeText(r.isletme) === normalizeText(ad))
    );

    document.getElementById('print-tc').textContent = `: ${tc || '-'}`;
    document.getElementById('print-isim').textContent = `: ${ad || '-'}`;

    // Yılı otomatik güncelle
    const yearEl = document.getElementById('print-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Çiftçi Veri Tabanındaki adres/köy bilgisini al (Yoksa parselin bulunduğu mahalleyi kullan)
    const mahalleler = [...new Set(ownerParcels.map(p => p.adres || p.mahalle))].filter(Boolean).join(', ');
    document.getElementById('print-mahalle').textContent = `: ${mahalleler || '-'}`;

    const grid = document.getElementById('print-maps-grid');
    if (grid) grid.innerHTML = '';

    const appMain = document.getElementById('app');
    const printContainer = document.getElementById('print-container');

    // Harita uydu katmanını gizle ve arka planı beyaz yap
    const tilePane = document.querySelector('.leaflet-tile-pane');
    if (tilePane) tilePane.style.display = 'none';
    const mapContainer = document.getElementById('map');
    const oldBg = mapContainer.style.backgroundColor;
    mapContainer.style.backgroundColor = 'white';

    // Save current map state
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

    for (const p of ownerParcels) {
        if (!p.coords || p.coords.length === 0) {
            // Geometri yoksa sadece bilgi kartı ekle
            const card = document.createElement('div');
            card.className = 'print-card';
            card.style.position = 'relative';
            card.style.height = '160px';
            card.style.padding = '0';
            card.style.overflow = 'hidden';
            card.style.border = '1px solid #555';
            card.style.display = 'flex';
            card.style.alignItems = 'center';
            card.style.justifyContent = 'center';
            card.style.background = '#f8f9fa';
            card.innerHTML = `
                <div style="text-align: center; color: #6c757d;">
                    <div style="font-size: 24px; margin-bottom: 8px;">📍</div>
                    <div style="font-weight: bold; font-family: Arial;">HARİTA SINIRI YOK</div>
                    <div style="font-size: 11px; margin-top: 4px;">(${p.mahalle || '-'} ${p.ada || '-'}/${p.parsel || '-'})</div>
                </div>
                <div style="position: absolute; top: 0; left: 0; width: 100%; background: rgba(255, 255, 255, 0.95); padding: 4px; font-size: 11px; text-align: center; border-bottom: 1px solid #777; font-family: Arial, sans-serif; font-weight: bold; box-sizing: border-box;">
                    ${p.mahalle || '-'} &nbsp;|&nbsp; ${p.ada || '-'}/${p.parsel || '-'} &nbsp;|&nbsp; ${p.urun || '-'}
                </div>
            `;
            if (grid) grid.appendChild(card);
            continue;
        }

        const bounds = L.polygon(p.coords).getBounds();
        // zoomu biraz geriye çekelim ki parsel tam sığsın (padding eklendi)
        map.fitBounds(bounds, { animate: false, padding: [20, 20] });

        // Render wait - haritanın yüklenmesini bekle
        await new Promise(r => setTimeout(r, 600));

        try {
            const canvas = await html2canvas(mapContainer, {
                useCORS: true,
                logging: false,
                ignoreElements: (el) => el.classList.contains('leaflet-control-container')
            });

            const card = document.createElement('div');
            card.className = 'print-card';
            card.style.position = 'relative';
            card.style.height = '160px';
            card.style.padding = '0';
            card.style.overflow = 'hidden';
            card.style.border = '1px solid #555';
            card.innerHTML = `
                <img src="${canvas.toDataURL('image/jpeg', 0.8)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
                <div style="position: absolute; top: 0; left: 0; width: 100%; background: rgba(255, 255, 255, 0.85); padding: 4px; font-size: 11px; text-align: center; border-bottom: 1px solid #777; font-family: Arial, sans-serif; font-weight: bold; box-sizing: border-box;">
                    ${p.mahalle || '-'} &nbsp;|&nbsp; ${p.ada || '-'}/${p.parsel || '-'} &nbsp;|&nbsp; ${p.urun || '-'}
                </div>
            `;
            if (grid) grid.appendChild(card);
        } catch (err) {
            console.error("Harita render hatası:", err);
        }
    }

    // Harita uydu katmanını ve arka planı geri getir
    if (tilePane) tilePane.style.display = '';
    mapContainer.style.backgroundColor = oldBg;

    // Ekranı rapor görünümüne al
    if (appMain && printContainer) {
        appMain.classList.add('hidden');
        printContainer.classList.remove('hidden');
    }

    // Restore map state
    map.setView(currentCenter, currentZoom, { animate: false });

    hideLoading();

    setTimeout(() => {
        window.print();
    }, 500);
};

document.getElementById('close-print-btn')?.addEventListener('click', () => {
    document.getElementById('print-container').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
});

// PWA: Service worker kaydı (kurulum butonunun görünmesi için)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW kayıt hatası:', err));
    });
}
