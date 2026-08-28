import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });

function getServiceKey(): string | null {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!secretKeys) return null;

  try {
    const parsed = JSON.parse(secretKeys);
    return parsed.default || null;
  } catch (_) {
    return null;
  }
}

function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = getServiceKey();
  if (!url || !key) throw new Error('Supabase sunucu anahtarı yapılandırılmamış.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getSessionToken(req: Request): string {
  const custom = req.headers.get('x-session-token');
  if (custom) return custom.trim();
  const authorization = req.headers.get('authorization') || '';
  return authorization.replace(/^Bearer\s+/i, '').trim();
}

function randomTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const values = new Uint32Array(16);
  crypto.getRandomValues(values);
  let result = '';
  for (const value of values) result += alphabet[value % alphabet.length];
  return result;
}

function safeApplicationName(value: unknown): 'VetMap' | 'TarMap' | null {
  return value === 'VetMap' || value === 'TarMap' ? value : null;
}

async function getTelegramToken(supabaseAdmin: ReturnType<typeof createAdminClient>, appName: 'VetMap' | 'TarMap') {
  const configuredSecret = Deno.env.get('TELEGRAM_BOT_TOKEN_AGE');
  if (configuredSecret && configuredSecret.trim()) return configuredSecret.trim();

  const { data, error } = await supabaseAdmin
    .from('uygulama_ayarlari')
    .select('telegram_bot_token')
    .eq('uygulama_adi', appName)
    .maybeSingle();

  if (error || !data?.telegram_bot_token || !String(data.telegram_bot_token).trim()) {
    throw new Error('Telegram bot ayarı bulunamadı.');
  }
  return String(data.telegram_bot_token).trim();
}

async function sendTelegramMessage(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  appName: 'VetMap' | 'TarMap',
  telegramId: string,
  username: string,
  temporaryPassword: string,
) {
  const botToken = await getTelegramToken(supabaseAdmin, appName);
  const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramId,
      text: `${appName} kullanıcı hesabınız için geçici şifre oluşturuldu.\nKullanıcı adı: ${username}\nGeçici şifre: ${temporaryPassword}\n\nİlk girişten sonra şifrenizi değiştirmeniz önerilir.`,
    }),
  });

  const result = await telegramResponse.json().catch(() => null);
  if (!telegramResponse.ok || !result?.ok) {
    throw new Error('Telegram gönderimi başarısız.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ basarili: false, mesaj: 'Yalnızca POST desteklenir.' }, 405);

  try {
    const body = await req.json();
    const appName = safeApplicationName(body.uygulama_adi);
    const token = getSessionToken(req);
    const action = String(body.islem || '').trim();

    if (!appName || !token) {
      return jsonResponse({ basarili: false, mesaj: 'Oturum veya uygulama bilgisi eksik.' }, 401);
    }

    const supabaseAdmin = createAdminClient();
    const rpcBase = { p_token: token, p_uygulama_adi: appName };
    let data: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;

    if (action === 'listele') {
      ({ data, error } = await supabaseAdmin.rpc('admin_kullanici_listesi', rpcBase));
    } else if (action === 'ekle') {
      const username = String(body.kullanici_adi || '').trim();
      const telegramId = String(body.telegram_id || '').trim();
      if (!username || !telegramId || telegramId === '---') {
        return jsonResponse({ basarili: false, mesaj: 'Kullanıcı adı ve Telegram ID zorunludur.' }, 400);
      }
      const temporaryPassword = randomTemporaryPassword();
      ({ data, error } = await supabaseAdmin.rpc('admin_kullanici_ekle', {
        ...rpcBase,
        p_kullanici_adi: username,
        p_gecici_sifre: temporaryPassword,
        p_tarmap_yetkisi: Boolean(body.tarmap_yetkisi),
        p_vetmap_yetkisi: Boolean(body.vetmap_yetkisi),
        p_telegram_id: telegramId,
      }));
      if (error || !data?.basarili) return jsonResponse({ basarili: false, mesaj: data?.mesaj || 'Kullanıcı oluşturulamadı.' }, 400);
      try {
        await sendTelegramMessage(supabaseAdmin, appName, telegramId, username, temporaryPassword);
      } catch (_) {
        return jsonResponse({ basarili: false, mesaj: 'Kullanıcı oluşturuldu ancak Telegram gönderimi başarısız oldu. Şifre sıfırlama işlemini tekrar deneyin.' }, 502);
      }
      return jsonResponse({ basarili: true, mesaj: 'Kullanıcı oluşturuldu ve geçici şifre Telegram ile gönderildi.' });
    } else if (action === 'guncelle') {
      ({ data, error } = await supabaseAdmin.rpc('admin_kullanici_guncelle', {
        ...rpcBase,
        p_kullanici_id: body.kullanici_id,
        p_tarmap_yetkisi: Boolean(body.tarmap_yetkisi),
        p_vetmap_yetkisi: Boolean(body.vetmap_yetkisi),
        p_telegram_id: body.telegram_id ? String(body.telegram_id).trim() : null,
      }));
    } else if (action === 'sil') {
      ({ data, error } = await supabaseAdmin.rpc('admin_kullanici_sil', {
        ...rpcBase,
        p_kullanici_id: body.kullanici_id,
      }));
    } else if (action === 'sifre_sifirla') {
      const temporaryPassword = randomTemporaryPassword();
      ({ data, error } = await supabaseAdmin.rpc('admin_sifre_sifirla', {
        ...rpcBase,
        p_kullanici_id: body.kullanici_id,
        p_gecici_sifre: temporaryPassword,
      }));
      if (error || !data?.basarili) return jsonResponse({ basarili: false, mesaj: data?.mesaj || 'Şifre yenilenemedi.' }, 400);
      const telegramId = String(data.telegram_id || '').trim();
      const username = String(data.kullanici_adi || '').trim();
      if (!telegramId || !username) return jsonResponse({ basarili: false, mesaj: 'Telegram hedefi bulunamadı.' }, 502);
      try {
        await sendTelegramMessage(supabaseAdmin, appName, telegramId, username, temporaryPassword);
      } catch (_) {
        return jsonResponse({ basarili: false, mesaj: 'Şifre yenilendi ancak Telegram gönderimi başarısız oldu. Yeni sıfırlama işlemi başlatın.' }, 502);
      }
      return jsonResponse({ basarili: true, mesaj: 'Yeni geçici şifre Telegram ile gönderildi.' });
    } else {
      return jsonResponse({ basarili: false, mesaj: 'Geçersiz yönetici işlemi.' }, 400);
    }

    if (error) return jsonResponse({ basarili: false, mesaj: 'Yönetici işlemi gerçekleştirilemedi.' }, 400);
    return jsonResponse((data || { basarili: true }) as Record<string, unknown>);
  } catch (error) {
    console.error('admin-yonetim işlem hatası:', error instanceof Error ? error.message : 'bilinmeyen hata');
    return jsonResponse({ basarili: false, mesaj: 'Yönetici işlemi sırasında sunucu hatası oluştu.' }, 500);
  }
});
