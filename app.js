// Configuration
const APP_NAME = "TarMap";
const APP_VERSION = "2.0.6";

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
                sessionStorage.setItem('isLoggedIn', 'true');
                sessionStorage.setItem('currentUser', currentUser);

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
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 500);
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
    
    await loadData();
    startLocationTracking();
    loadingOverlay.classList.add('hidden');
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
                masterRecords = JSON.parse(text);
                renderFromMasterData(masterRecords);
                alert(`✅ ${masterRecords.length} parsel yüklendi.`);
            } catch (err) {
                alert('JSON okunamadı: ' + err.message);
            } finally { hideLoading(); }
        }, 80);
    });

    const gmlInput   = document.getElementById('local-gml');
    const csvInput   = document.getElementById('local-csv');
    const excelInput = document.getElementById('local-excel');
    const processBtn = document.getElementById('process-data-btn');

    gmlInput?.addEventListener('change',   (e) => selectedFiles.gml   = e.target.files[0]);
    csvInput?.addEventListener('change',   (e) => selectedFiles.csv   = e.target.files[0]);
    excelInput?.addEventListener('change', (e) => selectedFiles.excel = e.target.files[0]);

    processBtn?.addEventListener('click', async () => {
        if (!selectedFiles.gml && !selectedFiles.csv) {
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
                masterRecords = await buildMasterData(updateMergeProgress);
                updateMergeProgress(90, 'Harita çiziliyor...');
                renderFromMasterData(masterRecords);
                updateMergeProgress(100, 'Tamamlandı!');

                const blob = new Blob([JSON.stringify(masterRecords)], { type: 'application/json' });
                const url  = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'TarmapVeri.json';
                a.click();
                URL.revokeObjectURL(url);

                alert(`✅ ${masterRecords.length} parsel işlendi.\n\nTarmapVeri.json indirildi.`);
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

function renderFromMasterData(records, fitBounds = true) {
    // Mevcut poligonları temizle
    mapPolygons.forEach(p => map.removeLayer(p));
    mapPolygons = [];

    if (!records || !records.length) return;

    // Performans için: Eğer çok fazla kayıt varsa (örn > 500), sadece ilk 500'ünü çiz veya uyarı ver.
    // Ancak arama sonuçları genellikle az olacağı için bu sorun olmayacaktır.
    const displayLimit = 1000;
    const toDisplay = records.slice(0, displayLimit);

    const bounds = L.latLngBounds();

    toDisplay.forEach(rec => {
        if (!rec.coords || !rec.coords.length) return;

        const hasInfo = !!(rec.isletme || rec.urun);

        const polygon = L.polygon(rec.coords, {
            color:       hasInfo ? '#2ecc71' : '#95a5a6',
            weight:      2,
            opacity:     0.8,
            fillColor:   hasInfo ? '#2ecc71' : '#95a5a6',
            fillOpacity: 0.25
        }).addTo(map);

        const feature = { ada: rec.ada, parsel: rec.parsel, mahalle: rec.mahalle, coords: rec.coords };
        const owner   = hasInfo ? {
            'İşletme Adı': rec.isletme,
            'TC':          rec.tc,
            'Köy':         rec.mahalle,
            'Ürün':        rec.urun,
            'Alan':        rec.alan,
            'Tarım Şekli': rec.tarim_sekli,
            'Ekim Tarihi': rec.ekim_tarihi,
            _phone:        rec.telefon || null
        } : null;

        polygon.on('click', (e) => {
            if (isMeasuringDist || isMeasuringArea) { addMeasurePoint(e.latlng); return; }
            L.DomEvent.stopPropagation(e);
            showParselInfo(feature, owner);
        });
        
        polygon.on('mouseover', () => { 
            if (!isMeasuringDist && !isMeasuringArea) polygon.setStyle({ fillOpacity: 0.5 }); 
        });
        polygon.on('mouseout',  () => polygon.setStyle({ fillOpacity: 0.25 }));

        bounds.extend(polygon.getBounds());
        mapPolygons.push(polygon);
    });

    if (fitBounds && mapPolygons.length > 0) {
        map.fitBounds(bounds);
    }
    
    if (records.length > displayLimit) {
        console.warn(`Performans için sadece ilk ${displayLimit} parsel çizildi.`);
    }
}

async function buildMasterData(progressCb) {
    progressCb?.(5, 'GML dosyası okunuyor...');
    gmlFeatures = [];
    if (selectedFiles.gml) {
        const text = await selectedFiles.gml.text();
        parseGML(text);
    }
    progressCb?.(35, `${gmlFeatures.length} parsel geometrisi okundu.`);

    parselData = [];
    if (selectedFiles.csv) {
        parselData = await readExcelOrCsvSmart(
            selectedFiles.csv,
            [['ADA', 'PARSEL'], ['ÜRÜN', 'URUN'], ['İŞLETME', 'ISLETME']]
        );
    }
    progressCb?.(55, `${parselData.length} parsel kaydı okundu.`);

    farmerData = [];
    if (selectedFiles.excel) {
        farmerData = await readExcelOrCsvSmart(
            selectedFiles.excel,
            [['TC', 'TELEFON'], ['ADI', 'SOYAD'], ['UNVAN']]
        );
    }
    progressCb?.(70, 'Veriler eşleştiriliyor...');

    const farmerByTC   = new Map();
    const farmerByName = new Map();
    farmerData.forEach(f => {
        const tc = (f['TC_V NO'] || f['TC'] || f['T.C. No'] || f['TC No'] || f['T.C.'] || '').trim();
        const nm = normalizeText(f['ADI/UNVANI'] || f['Ad Soyad'] || f['Adı Soyadı'] || f['ADI SOYADI'] || f['İşletme Adı'] || '');
        if (tc) farmerByTC.set(tc, f);
        if (nm) farmerByName.set(nm, f);
    });

    const parselMap = new Map();
    parselData.forEach(p => {
        const rawMahalle = p['Köy'] || p['KÖY'] || p['Mahalle'] || '';
        const mahalle = getCleanMahalle(rawMahalle);
        const ada    = (p['Ada\nNo'] || p['Ada No'] || p['Ada'] || p['AdaNo'] || '').toString().trim().replace(/^0+/, '') || '0';
        const parsel = (p['Parsel\nNo'] || p['Parsel No'] || p['Parsel'] || p['ParselNo'] || '').toString().trim().replace(/^0+/, '') || '0';
        
        const key = `${mahalle}-${ada}-${parsel}`;
        if (!parselMap.has(key)) parselMap.set(key, []);
        parselMap.get(key).push(p);
    });

    const records = gmlFeatures.flatMap(feat => {
        const fAda    = feat.ada.toString().replace(/^0+/, '');
        const fParsel = feat.parsel.toString().replace(/^0+/, '');
        const fMahalle = getCleanMahalle(feat.mahalle);
        
        const pList = parselMap.get(`${fMahalle}-${fAda}-${fParsel}`);
        
        if (!pList || pList.length === 0) {
            return [{
                ada:        feat.ada,
                parsel:     feat.parsel,
                mahalle:    feat.mahalle,
                coords:     feat.coords,
                isletme:    '',
                tc:         '',
                urun:       '',
                alan:       '',
                tarim_sekli:'',
                ekim_tarihi:'',
                telefon:    ''
            }];
        }

        return pList.map(p => {
            const pTC   = (p['TC'] || p['TC / Vergi No'] || '').trim();
            const pName = normalizeText(p['İşletme Adı'] || p['İşletme'] || p['Ad Soyad'] || p['Sahibi'] || '');
            const farmer = (pTC && farmerByTC.get(pTC)) || (pName && farmerByName.get(pName)) || {};
            const phone  = farmer['TELEFON'] || farmer['Telefon'] || farmer['Cep Tel'] || farmer['GSM'] || farmer['CEP TEL'] || '';
            
            return {
                ada:        feat.ada,
                parsel:     feat.parsel,
                mahalle:    feat.mahalle,
                coords:     feat.coords,
                isletme:    p['İşletme Adı'] || p['İşletme'] || '',
                tc:         pTC,
                urun:       p['Ürün'] || '',
                alan:       p['Kullanılan  Alan(da)'] || p['Kullanılan Alan(da)'] || p['Kullanılan Alan'] || p['Alan'] || p['Alanı'] || p['Ekili Alan'] || p['Tapu Alanı'] || p['ParselAlanı'] || '',
                tarim_sekli:p['Tarım Şekli'] || '',
                ekim_tarihi:p['Ekim Tarihi'] || p['EKİM TARİHİ'] || '',
                telefon:    phone
            };
        });
    });

    progressCb?.(88, `${records.length} kayıt birleştirildi.`);
    return records;
}

async function readExcelOrCsvSmart(file, keywordSets) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const data     = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];

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

function parseGML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const members = xmlDoc.getElementsByTagNameNS("*", "featureMember");

    for (let member of members) {
        const layer = member.getElementsByTagNameNS("*", "Layer1")[0] || member.firstElementChild;
        if (!layer) continue;

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
            layer.getElementsByTagNameNS("*", "MahalleAd")[0]?.textContent?.trim() ||
            layer.getElementsByTagNameNS("*", "MAHALLE_ADI")[0]?.textContent?.trim() ||
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

function normalizeText(text) {
    if (!text) return "";
    let str = text.toString();
    const mapping = {
        'İ': 'i', 'I': 'ı', 'Ş': 'ş', 'Ğ': 'ğ', 'Ü': 'ü', 'Ö': 'ö', 'Ç': 'ç',
        'i': 'i', 'ı': 'ı', 'ş': 'ş', 'ğ': 'ğ', 'ü': 'ü', 'ö': 'ö', 'ç': 'ç'
    };
    str = str.replace(/[İIŞĞÜÖÇ]/g, (letter) => mapping[letter] || letter.toLowerCase());
    str = str.toLowerCase();
    return str.replace(/\s+/g, ' ').trim();
}


function getCleanMahalle(str) {
    if (!str) return "";
    let s = normalizeText(str);
    return s.replace(/\b(mahallesi|mah|mah\.|köyü|koyu|köy)\b/g, '').trim();
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
        if (!query) return;
        
        const normalizedQuery = normalizeText(query);
        let results = [];

        // Ada/Parsel araması: "128/118" veya "128 118"
        const adaParselMatch = query.match(/(\d+)[/\s](\d+)/);
        if (adaParselMatch) {
            const ada = adaParselMatch[1];
            const parsel = adaParselMatch[2];
            results = masterRecords.filter(r => r.ada === ada && r.parsel === parsel);
        } else {
            // İsim veya Mahalle araması
            results = masterRecords.filter(r => 
                normalizeText(r.isletme).includes(normalizedQuery) || 
                normalizeText(r.mahalle).includes(normalizedQuery)
            );
        }

        // Arama sonuçlarını haritaya çiz
        if (results.length > 0) {
            renderFromMasterData(results);
        }

        renderSearchResults(results);
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

function renderSearchResults(results) {
    const resultsPanel = document.getElementById('search-results');
    const resultsList = document.getElementById('results-list');
    resultsList.innerHTML = '';

    if (results.length === 0) {
        resultsList.innerHTML = '<div class="p-4 text-gray-500">Sonuç bulunamadı.</div>';
    } else {
        results.forEach(r => {
            const div = document.createElement('div');
            div.className = 'p-3 border-b hover:bg-gray-50 cursor-pointer';
            div.innerHTML = `
                <div class="font-bold">${r.mahalle} ${r.ada}/${r.parsel}</div>
                <div class="text-sm text-gray-600">${r.isletme || 'Bilgi Yok'}</div>
            `;
            div.onclick = () => {
                const bounds = L.polygon(r.coords).getBounds();
                map.fitBounds(bounds);
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
                resultsPanel.classList.add('hidden');
            };
            resultsList.appendChild(div);
        });
    }
    resultsPanel.classList.remove('hidden');
}

function showParselInfo(feature, owner) {
    activeFeature = feature;
    currentOwnerData = owner;
    infoPanel.classList.remove('hidden');
    
    let html = `
        <div class="mb-4">
            <h3 class="text-lg font-bold text-green-700">${feature.mahalle} ${feature.ada}/${feature.parsel}</h3>
        </div>
    `;

    if (owner) {
        html += `
            <div class="space-y-2">
                <p><strong>İşletme:</strong> ${owner['İşletme Adı']}</p>
                <p><strong>TC:</strong> ${owner['TC']}</p>
                <p><strong>Ürün:</strong> ${owner['Ürün']}</p>
                <p><strong>Alan:</strong> ${owner['Alan']} da</p>
                <p><strong>Tarım Şekli:</strong> ${owner['Tarım Şekli']}</p>
                ${owner['Ekim Tarihi'] ? `<p><strong>Ekim Tarihi:</strong> ${owner['Ekim Tarihi']}</p>` : ''}
                ${owner._phone ? `<p><strong>Telefon:</strong> <a href="tel:${owner._phone}" class="text-blue-600 underline">${owner._phone}</a></p>` : ''}
            </div>
            <button onclick="generateReport()" class="mt-4 w-full bg-green-600 text-white py-2 rounded">Rapor Al</button>
        `;
    } else {
        html += `<p class="text-gray-500 italic">Bu parsel için üretim kaydı bulunamadı.</p>`;
    }

    parselDetails.innerHTML = html;
}

function setupTools() {
    closePanelBtn.onclick = () => infoPanel.classList.add('hidden');
    document.getElementById('logout-button').onclick = () => {
        sessionStorage.removeItem('isLoggedIn');
        location.reload();
    };

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

window.generateReport = () => {
    window.print();
};
