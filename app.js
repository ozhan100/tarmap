// Configuration
const APP_NAME = "TarMap";
const APP_VERSION = "1.6.0";

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

function setupSettings() {
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('open-settings');
    const closeBtn = document.getElementById('close-settings');
    const resetBtn = document.getElementById('reset-defaults');
    
    const csvInput = document.getElementById('local-csv');
    const gmlInput = document.getElementById('local-gml');
    const excelInput = document.getElementById('local-excel');

    openBtn?.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    resetBtn?.addEventListener('click', () => {
        if(confirm("Varsayılan verilere geri dönmek istiyor musunuz?")) {
            location.reload();
        }
    });

    csvInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const parsed = Papa.parse(event.target.result, {
                header: true,
                delimiter: ";",
                skipEmptyLines: true
            });
            parselData = parsed.data.map(row => {
                const newRow = {};
                for (let key in row) {
                    newRow[key.trim()] = row[key];
                }
                return newRow;
            });
            joinFarmerData();
            alert("CSV Verisi Yüklendi!");
        };
        reader.readAsText(file);
    });

    gmlInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            gmlFeatures = [];
            parseGML(event.target.result);
            renderPolygons();
            alert("Harita Verisi (GML) Yüklendi!");
        };
        reader.readAsText(file);
    });

    excelInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            farmerData = XLSX.utils.sheet_to_json(firstSheet);
            joinFarmerData();
            alert("Çiftçi Veritabanı (Excel) Yüklendi!");
        };
        reader.readAsArrayBuffer(file);
    });
}

async function loadData() {
    console.log("Başlangıçta veri yüklenmeyecek. Verileri 'Veri Yükle' menüsünden yükleyiniz.");
}

function joinFarmerData() {
    if (!parselData.length || !farmerData.length) return;
    
    parselData.forEach(p => {
        const pTC = (p["TC"] || "").toString().trim();
        const pName = normalizeText(p["İşletme"]);

        const farmer = farmerData.find(f => {
            const fTC = (f["TC_V NO"] || f["TC"] || f["T.C. No"] || "").toString().trim();
            if (pTC && fTC === pTC) return true;

            const fName = normalizeText(f["ADI/UNVANI"] || f["Ad Soyad"] || f["Adı Soyadı"]);
            if (pName && fName === pName) return true;
            
            return false;
        });

        if (farmer) {
            p._farmerInfo = farmer;
            p._phone = farmer["TELEFON"] || farmer["Telefon"] || farmer["Cep Tel"];
        }
    });
}

function parseGML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const members = xmlDoc.getElementsByTagNameNS("*", "featureMember");

    for (let member of members) {
        const layer = member.getElementsByTagNameNS("*", "Layer1")[0];
        if (!layer) continue;

        const adaNo = layer.getElementsByTagNameNS("*", "AdaNo")[0]?.textContent;
        const parselNo = layer.getElementsByTagNameNS("*", "ParselNo")[0]?.textContent;
        const geom = layer.getElementsByTagNameNS("*", "Geom")[0];
        
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
            coords: coordinates
        });
    }
}

function renderPolygons() {
    const bounds = L.latLngBounds();

    gmlFeatures.forEach(feature => {
        const owner = parselData.find(d => d["Ada No"] === feature.ada && d["Parsel No"] === feature.parsel);
        
        // feature.coords is an array of rings for L.polygon
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

function showParselInfo(feature, owner) {
    // Find farmer details if possible
    let farmerInfo = null;
    if (owner) {
        const ownerTC = (owner["TC"] || "").toString().trim();
        const ownerName = normalizeText(owner["İşletme"]);

        farmerInfo = farmerData.find(f => {
            const fTC = (f["TC"] || f["T.C. No"] || f["T.C."] || f["TC No"] || "").toString().trim();
            if (ownerTC && fTC === ownerTC) return true;
            const fName = normalizeText(f["Ad Soyad"] || f["Adı Soyadı"] || f["İşletme Adı"] || f["ADI SOYADI"]);
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
        ${owner ? `
            <div class="detail-item">
                <div class="detail-label">İşletme / Sahibi</div>
                <div class="detail-value">${owner["İşletme"] || "Bilinmiyor"}</div>
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
                <div class="detail-value">${owner["TC"] || "Gizli"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ürün</div>
                <div class="detail-value">${owner["Ürün"] || "-"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Alan (m²)</div>
                <div class="detail-value">${owner["Alan"] || owner["ParselAlanı"] || "-"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Tarım Şekli</div>
                <div class="detail-value">${owner["Tarım Şekli"] || "-"}</div>
            </div>
            <div class="edit-actions" style="margin-top: 15px; display: flex; gap: 10px;">
                <button onclick="enableEditMode()" class="action-btn-small blue">📝 Bilgi Güncelle</button>
                <button onclick="exportParselImage()" class="action-btn-small green">📷 Resim Al</button>
            </div>
        ` : `
            <div class="detail-item">
                <div class="detail-label">Bilgi</div>
                <div class="detail-value">Bu parsel için CSV verisi bulunamadı.</div>
            </div>
            <div class="edit-actions" style="margin-top: 15px; display: flex; gap: 10px;">
                <button onclick="exportParselImage()" class="action-btn-small green">📷 Resim Al</button>
            </div>
        `}
    `;
    infoPanel.classList.remove('hidden');

    // Draw the parcel sketch on canvas after DOM update
    setTimeout(() => drawParselSketch(feature), 50);
}

// ─── Parsel Sketch (Canvas) ────────────────────────────────────────────────

function drawParselSketch(feature) {
    const canvasId = 'parsel-sketch-canvas';
    let canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Collect all coordinate points (first ring only)
    const ring = feature.coords[0];
    if (!ring || ring.length < 3) {
        ctx.fillStyle = '#888';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Koordinat yok', W/2, H/2);
        return;
    }

    // Find bounding box
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    ring.forEach(([lat, lng]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    });

    const latSpan = maxLat - minLat || 0.0001;
    const lngSpan = maxLng - minLng || 0.0001;
    const padding = 20;

    // Scale to canvas with uniform aspect ratio
    const scale = Math.min((W - padding*2) / lngSpan, (H - padding*2) / latSpan);

    // Center offset
    const scaledW = lngSpan * scale;
    const scaledH = latSpan * scale;
    const offsetX = (W - scaledW) / 2;
    const offsetY = (H - scaledH) / 2;

    const toCanvas = ([lat, lng]) => ({
        x: offsetX + (lng - minLng) * scale,
        y: H - (offsetY + (lat - minLat) * scale)  // flip Y axis
    });

    // Draw filled polygon
    ctx.beginPath();
    const first = toCanvas(ring[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < ring.length; i++) {
        const pt = toCanvas(ring[i]);
        ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();

    // Fill with soft green
    ctx.fillStyle = 'rgba(46, 204, 113, 0.25)';
    ctx.fill();

    // Stroke with darker green
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Corner dots
    ring.forEach((pt, i) => {
        if (i === ring.length - 1) return; // skip closing duplicate
        const { x, y } = toCanvas(pt);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#27ae60';
        ctx.fill();
    });
}

// ─── Parsel Card Export ────────────────────────────────────────────────────

window.exportParselImage = function() {
    const ada = document.getElementById('panel-ada')?.innerText || '?';
    const parsel = document.getElementById('panel-parsel')?.innerText || '?';

    // Build the export card element (off-screen)
    const card = document.createElement('div');
    card.id = 'parsel-export-card';
    card.style.cssText = `
        position: fixed;
        top: -9999px; left: -9999px;
        width: 420px;
        background: #ffffff;
        border: 2px solid #27ae60;
        border-radius: 8px;
        font-family: 'Outfit', Arial, sans-serif;
        overflow: hidden;
        z-index: -1;
    `;

    // Collect current parsel details from panel
    const detailItems = document.querySelectorAll('#parsel-details .detail-item');
    let tableRows = '';
    detailItems.forEach(item => {
        const label = item.querySelector('.detail-label')?.innerText || '';
        const value = item.querySelector('.detail-value')?.innerText || '';
        if (label && value && label !== 'Ada / Parsel') {
            tableRows += `
                <tr>
                    <td style="padding:5px 8px; font-weight:600; color:#333; border-bottom:1px solid #f0f0f0; white-space:nowrap;">${label}</td>
                    <td style="padding:5px 8px; color:#555; border-bottom:1px solid #f0f0f0;">${value}</td>
                </tr>`;
        }
    });

    // Get existing canvas image data
    const existingCanvas = document.getElementById('parsel-sketch-canvas');
    const sketchDataUrl = existingCanvas ? existingCanvas.toDataURL('image/png') : '';

    card.innerHTML = `
        <!-- Header -->
        <div style="background: linear-gradient(135deg,#27ae60,#2ecc71); padding:12px 16px; display:flex; align-items:center; gap:10px;">
            <span style="font-size:22px;">🌾</span>
            <div>
                <div style="color:#fff; font-size:16px; font-weight:700;">TarMap — Parsel Kartı</div>
                <div style="color:rgba(255,255,255,0.85); font-size:11px;">${new Date().toLocaleDateString('tr-TR', {day:'2-digit',month:'long',year:'numeric'})}</div>
            </div>
            <div style="margin-left:auto; background:rgba(255,255,255,0.25); border-radius:6px; padding:4px 10px; text-align:center;">
                <div style="color:#fff; font-size:11px; font-weight:600;">ADA / PARSEL</div>
                <div style="color:#fff; font-size:18px; font-weight:700;">${ada} / ${parsel}</div>
            </div>
        </div>

        <!-- Sketch -->
        <div style="background:#f8fdf8; padding:12px; text-align:center; border-bottom:1px solid #e8f5e9;">
            <div style="font-size:10px; color:#888; margin-bottom:6px; text-transform:uppercase; letter-spacing:1px;">Parsel Şekli</div>
            ${sketchDataUrl
                ? `<img src="${sketchDataUrl}" style="width:180px; height:140px; object-fit:contain;" />`
                : `<div style="width:180px; height:140px; margin:auto; background:#e8f5e9; border-radius:4px; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:12px;">Şekil Yok</div>`
            }
        </div>

        <!-- Info Table -->
        <div style="padding:8px;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
                ${tableRows || '<tr><td colspan="2" style="padding:8px; color:#999; text-align:center;">Veri bulunamadı</td></tr>'}
            </table>
        </div>

        <!-- Footer -->
        <div style="background:#f5f5f5; padding:6px 16px; font-size:10px; color:#aaa; text-align:right; border-top:1px solid #eee;">
            TarMap v${APP_VERSION} • Tarla Takip Sistemi
        </div>
    `;

    document.body.appendChild(card);

    html2canvas(card, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
    }).then(canvas => {
        document.body.removeChild(card);

        // Try clipboard first (modern browsers)
        canvas.toBlob(blob => {
            if (navigator.clipboard && navigator.clipboard.write) {
                navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]).then(() => {
                    showExportToast('✅ Resim panoya kopyalandı! Excel\'e Ctrl+V ile yapıştırabilirsiniz.');
                }).catch(() => {
                    // Fallback to download
                    downloadCanvasImage(canvas, ada, parsel);
                });
            } else {
                downloadCanvasImage(canvas, ada, parsel);
            }
        }, 'image/png');
    }).catch(err => {
        document.body.removeChild(card);
        console.error('Export error:', err);
        alert('Resim oluşturulurken hata oluştu: ' + err.message);
    });
};

function downloadCanvasImage(canvas, ada, parsel) {
    const link = document.createElement('a');
    link.download = `parsel_${ada}_${parsel}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showExportToast('✅ Resim indirildi! Excel\'e ekleyebilirsiniz.');
}

function showExportToast(msg) {
    let toast = document.getElementById('export-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'export-toast';
        toast.style.cssText = `
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: #27ae60; color: #fff; padding: 12px 20px;
            border-radius: 25px; font-size: 14px; font-weight: 600;
            z-index: 9999; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            transition: opacity 0.4s; white-space: nowrap;
        `;
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3500);
}


window.enableEditMode = function() {
    const values = document.querySelectorAll('.detail-value');
    const labels = document.querySelectorAll('.detail-label');
    
    // Skip Ada/Parsel (not editable usually)
    for (let i = 1; i < values.length; i++) {
        const currentVal = values[i].innerText;
        const label = labels[i].innerText;
        
        // Don't edit phone value if it's in the special row, it will be handled by the farmer info
        if (values[i].parentElement.classList.contains('phone-row')) continue;

        values[i].innerHTML = `<input type="text" class="edit-input" value="${currentVal}" data-label="${label}">`;
    }

    const actions = document.querySelector('.edit-actions');
    actions.innerHTML = `
        <button onclick="saveChanges()" class="action-btn-small green">✅ Kaydet ve Bildir</button>
        <button onclick="cancelEdit()" class="action-btn-small red">❌ İptal</button>
    `;
};

window.cancelEdit = function() {
    // Simply re-render
    const activeFeature = gmlFeatures.find(f => f.ada === document.getElementById('panel-ada').innerText && f.parsel === document.getElementById('panel-parsel').innerText);
    const owner = parselData.find(d => d["Ada No"] === activeFeature.ada && d["Parsel No"] === activeFeature.parsel);
    showParselInfo(activeFeature, owner);
};

window.saveChanges = async function() {
    const inputs = document.querySelectorAll('.edit-input');
    const ada = document.getElementById('panel-ada').innerText;
    const parsel = document.getElementById('panel-parsel').innerText;
    
    let report = `📢 *SAHA GÜNCELLEME TALEBİ*\n`;
    report += `📍 *Parsel:* ${ada}/${parsel}\n`;
    report += `👤 *Kullanıcı:* ${currentUser}\n\n`;
    report += `🔄 *Değişiklikler:*\n`;

    inputs.forEach(input => {
        report += `• *${input.dataset.label}:* ${input.value}\n`;
    });

    try {
        await sendNotification(report);
        alert("Güncelleme talebi admin paneline başarıyla iletildi!");
        cancelEdit();
    } catch (err) {
        alert("Hata: Bildirim gönderilemedi.");
    }
};

function setupSearch() {
    const searchInput = document.getElementById('global-search');
    const searchBtn = document.getElementById('search-button');
    const searchContainer = document.getElementById('search-container');
    const toggleSearchBtn = document.getElementById('toggle-search-btn');
    const showSearchBtn = document.getElementById('show-search');

    searchBtn.onclick = () => executeSearch(searchInput.value);
    searchInput.onkeypress = (e) => {
        if (e.key === 'Enter') executeSearch(searchInput.value);
    };

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

function executeSearch(query) {
    if (!query) return;
    const normalizedQuery = normalizeText(query);

    let results = [];
    
    // Pattern 1: köy hamzabey ada 101,102 parsel 43,44
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
    // Pattern 2: köy hamzabey isim hasan doğan ürün üzüm
    else if (normalizedQuery.includes('isim') || normalizedQuery.includes('ürün')) {
    // All regex operations should be on the normalizedQuery to avoid case issues
    const villageMatch = normalizedQuery.match(/köy\s+(.*?)(?=\s+isim|\s+ürün|$)/);
    const nameMatch = normalizedQuery.match(/isim\s+(.*?)(?=\s+ürün|$)/);
    const productMatch = normalizedQuery.match(/ürün\s+(.*)/);

        const village = villageMatch ? normalizeText(villageMatch[1]) : null;
        const name = nameMatch ? normalizeText(nameMatch[1]) : null;
        const product = productMatch ? normalizeText(productMatch[1]) : null;

        // If no explicit tags found, try to treat the whole query as a name search
        const fallbackName = (!village && !name && !product) ? normalizedQuery : null;

        results = gmlFeatures.filter(f => {
            const owner = parselData.find(d => d["Ada No"] === f.ada && d["Parsel No"] === f.parsel);
            if (!owner) return false;

            let match = true;
            if (village && !normalizeText(owner["Köy"]).includes(village)) match = false;
            
            if (name) {
                if (!normalizeText(owner["İşletme"]).includes(name)) match = false;
            } else if (fallbackName) {
                if (!normalizeText(owner["İşletme"]).includes(fallbackName)) match = false;
            }
            
            if (product) {
                const cleanProductData = normalizeText(owner["Ürün"].split('(')[0]);
                if (!cleanProductData.includes(product)) match = false;
            }
            
            return match;
        });
    }

    if (results.length > 0) {
        const bounds = L.latLngBounds();
        results.forEach(f => {
            const poly = mapPolygons.find(p => {
                // This is a bit slow but ensures we find the right polygon
                // Better would be to store ref in feature
                return p.getBounds().getCenter().lat.toFixed(6) === L.polygon(f.coords).getBounds().getCenter().lat.toFixed(6);
            });
            
            // Re-find based on ada/parsel which is more reliable
            const foundPoly = mapPolygons.find(p => p._ada === f.ada && p._parsel === f.parsel);
            
            if (foundPoly) {
                bounds.extend(foundPoly.getBounds());
                foundPoly.setStyle({ color: '#f1c40f', weight: 4, fillOpacity: 0.7 });
                setTimeout(() => {
                    foundPoly.setStyle({ color: parselData.find(d => d["Ada No"] === f.ada && d["Parsel No"] === f.parsel) ? "#2ecc71" : "#95a5a6", weight: 2, fillOpacity: 0.25 });
                }, 5000);
            }
        });
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
    } else {
        alert("Sonuç bulunamadı.");
    }
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
            measureText.innerText = `Alan: ${area.toFixed(2)} m² (${(area/1000).toFixed(2)} dönüm)`;
        }
    }
}

function calculateDistance(path) {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
        total += path[i].distanceTo(path[i+1]);
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

