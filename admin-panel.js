(() => {
    const ADMIN_NAME = 'ÖZHAN OLGUN';
    const state = { config: null, users: [] };
    const byId = (id) => document.getElementById(id);
    const normalizeName = (value) => String(value || '').trim().toLocaleUpperCase('tr-TR');
    const isAdmin = (value) => normalizeName(value) === ADMIN_NAME;

    function setStatus(message, isError = false) {
        const el = byId('admin-status');
        if (!el) return;
        el.textContent = message || '';
        el.className = `admin-status${isError ? ' error' : ''}`;
    }
    function closePanel() {
        byId('admin-modal')?.classList.remove('open');
    }
    async function callAdmin(islem, payload = {}) {
        const { config } = state;
        const token = sessionStorage.getItem(config.tokenStorageKey);
        if (!token) throw new Error('Oturum süresi dolmuş. Lütfen yeniden giriş yapın.');
        const response = await fetch(`${config.supabaseUrl}/functions/v1/admin-yonetim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': token },
            body: JSON.stringify({ uygulama_adi: config.appName, islem, ...payload })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.basarili === false) {
            throw new Error(data?.mesaj || 'Yönetici işlemi başarısız.');
        }
        return data;
    }
    function makeButton(text, className, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.className = className;
        button.addEventListener('click', handler);
        return button;
    }
    function makeCheck(label, checked) {
        const wrap = document.createElement('label');
        wrap.className = 'admin-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!checked;
        wrap.append(input, document.createTextNode(label));
        return { wrap, input };
    }
    function renderUsers(users) {
        state.users = Array.isArray(users) ? users : [];
        const list = byId('admin-users-list');
        if (!list) return;
        list.innerHTML = '';
        if (!state.users.length) {
            const empty = document.createElement('div');
            empty.className = 'admin-empty';
            empty.textContent = 'Kayıtlı kullanıcı bulunamadı.';
            list.appendChild(empty);
            return;
        }
        state.users.forEach((user) => {
            const row = document.createElement('div');
            row.className = 'admin-user-row';
            const identity = document.createElement('div');
            identity.className = 'admin-user-identity';
            const name = document.createElement('strong');
            name.textContent = user.kullanici_adi || 'Adsız kullanıcı';
            identity.appendChild(name);
            if (isAdmin(user.kullanici_adi)) {
                const badge = document.createElement('span');
                badge.className = 'admin-badge';
                badge.textContent = 'YÖNETİCİ';
                identity.appendChild(badge);
            }
            const telegram = document.createElement('input');
            telegram.type = 'text';
            telegram.className = 'admin-telegram-input';
            telegram.placeholder = 'Telegram ID';
            telegram.value = user.telegram_id || '';
            const permissions = document.createElement('div');
            permissions.className = 'admin-permissions';
            const vet = makeCheck('VetMap', user.vetmap_yetkisi);
            const tar = makeCheck('TarMap', user.tarmap_yetkisi);
            permissions.append(vet.wrap, tar.wrap);
            const actions = document.createElement('div');
            actions.className = 'admin-row-actions';
            const save = makeButton('Kaydet', 'admin-save-btn', async () => {
                save.disabled = true;
                try {
                    await callAdmin('guncelle', {
                        kullanici_id: user.id,
                        tarmap_yetkisi: tar.input.checked,
                        vetmap_yetkisi: vet.input.checked,
                        telegram_id: telegram.value.trim() || null
                    });
                    setStatus(`${user.kullanici_adi} güncellendi.`);
                    await loadUsers();
                } catch (error) {
                    setStatus(error.message, true);
                } finally {
                    save.disabled = false;
                }
            });
            const reset = makeButton('Şifre Sıfırla', 'admin-reset-btn', async () => {
                if (!confirm(`${user.kullanici_adi} için yeni geçici şifre oluşturulup Telegram’a gönderilsin mi?`)) return;
                reset.disabled = true;
                try {
                    const result = await callAdmin('sifre_sifirla', { kullanici_id: user.id });
                    setStatus(result.mesaj || 'Yeni geçici şifre Telegram’a gönderildi.');
                } catch (error) {
                    setStatus(error.message, true);
                } finally {
                    reset.disabled = false;
                }
            });
            const remove = makeButton('Sil', 'admin-delete-btn', async () => {
                if (isAdmin(user.kullanici_adi)) {
                    setStatus('Yönetici hesabı silinemez.', true);
                    return;
                }
                if (!confirm(`${user.kullanici_adi} silinsin mi? Bu işlem geri alınamaz.`)) return;
                remove.disabled = true;
                try {
                    const result = await callAdmin('sil', { kullanici_id: user.id });
                    setStatus(result.mesaj || 'Kullanıcı silindi.');
                    await loadUsers();
                } catch (error) {
                    setStatus(error.message, true);
                } finally {
                    remove.disabled = false;
                }
            });
            actions.append(save, reset, remove);
            row.append(identity, telegram, permissions, actions);
            list.appendChild(row);
        });
    }
    async function loadUsers() {
        setStatus('Kullanıcılar yükleniyor...');
        try {
            const result = await callAdmin('listele');
            renderUsers(result.kullanicilar);
            setStatus(`${result.kullanicilar?.length || 0} kullanıcı listelendi.`);
        } catch (error) {
            renderUsers([]);
            setStatus(error.message, true);
        }
    }
    function setupAddUser() {
        const add = byId('admin-add-btn');
        if (!add) return;
        add.addEventListener('click', async () => {
            const username = byId('admin-new-username')?.value.trim();
            const telegram = byId('admin-new-telegram')?.value.trim();
            if (!username || !telegram) {
                setStatus('Yeni kullanıcı adı ve Telegram ID zorunludur.', true);
                return;
            }
            add.disabled = true;
            try {
                const result = await callAdmin('ekle', {
                    kullanici_adi: username,
                    telegram_id: telegram,
                    vetmap_yetkisi: !!byId('admin-new-vet')?.checked,
                    tarmap_yetkisi: !!byId('admin-new-tar')?.checked
                });
                byId('admin-new-username').value = '';
                byId('admin-new-telegram').value = '';
                setStatus(result.mesaj || 'Kullanıcı oluşturuldu ve Telegram’a gönderildi.');
                await loadUsers();
            } catch (error) {
                setStatus(error.message, true);
            } finally {
                add.disabled = false;
            }
        });
    }
    function setup(config) {
        state.config = config;
        const open = byId('admin-open-btn');
        const modal = byId('admin-modal');
        if (!open || !modal || !isAdmin(config.userName)) return;
        open.classList.remove('hidden');
        open.style.display = 'flex';
        open.addEventListener('click', async () => {
            modal.classList.add('open');
            await loadUsers();
        });
        byId('admin-close-btn')?.addEventListener('click', closePanel);
        byId('admin-refresh-btn')?.addEventListener('click', loadUsers);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closePanel();
        });
        setupAddUser();
    }
    window.initAdminPanel = setup;
})();
