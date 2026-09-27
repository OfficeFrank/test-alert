require('dotenv').config();

const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });

const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID || '';
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'dev-encryption-key-change-me';
const ALLOW_UNVERIFIED_WEBHOOKS = process.env.ALLOW_UNVERIFIED_WEBHOOKS === '1';

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const BASE_ALERT_SETTINGS = {
  layoutMode: 'card',
  durationMs: 6500,
  soundDurationMs: 6500,
  position: 'center',
  showAvatar: true,
  showModerator: true,
  showReason: true,
  showDuration: true,
  titleTemplate: '',
  subtitleTemplate: '',
  accent: '#53FC18',
  customLogoUrl: '',
  customSoundUrl: '',
  fullscreenBackgroundUrl: '',
  fullscreenMediaUrl: '',
  fullscreenDim: 0.35,
  videoMuted: true,
  volume: 0.75
};

const DEFAULT_TIMEOUT_SETTINGS = {
  ...BASE_ALERT_SETTINGS,
  titleTemplate: 'تم إعطاء {username} تايم أوت',
  subtitleTemplate: '{duration} • بواسطة {moderator}',
  showDuration: true
};

const DEFAULT_BANNED_SETTINGS = {
  ...BASE_ALERT_SETTINGS,
  accent: '#FF4057',
  titleTemplate: 'تم حظر {username}',
  subtitleTemplate: 'بواسطة {moderator}',
  showDuration: false
};

const DEFAULT_SETTINGS = {
  timeout: { ...DEFAULT_TIMEOUT_SETTINGS },
  banned: { ...DEFAULT_BANNED_SETTINGS }
};

function normalizeSettings(raw) {
  if (raw && raw.timeout && raw.banned) {
    return {
      timeout: { ...DEFAULT_TIMEOUT_SETTINGS, ...(raw.timeout || {}) },
      banned: { ...DEFAULT_BANNED_SETTINGS, ...(raw.banned || {}) }
    };
  }

  // Migrate V3 flat settings into TIME OUT, while keeping shared media choices for BANNED.
  const legacy = raw && typeof raw === 'object' ? raw : {};
  return {
    timeout: { ...DEFAULT_TIMEOUT_SETTINGS, ...legacy },
    banned: {
      ...DEFAULT_BANNED_SETTINGS,
      accent: legacy.accent || DEFAULT_BANNED_SETTINGS.accent,
      customLogoUrl: legacy.customLogoUrl || '',
      customSoundUrl: legacy.customSoundUrl || '',
      fullscreenMediaUrl: legacy.fullscreenMediaUrl || legacy.fullscreenBackgroundUrl || '',
      fullscreenBackgroundUrl: legacy.fullscreenBackgroundUrl || '',
      fullscreenDim: legacy.fullscreenDim ?? DEFAULT_BANNED_SETTINGS.fullscreenDim,
      videoMuted: legacy.videoMuted !== false,
      volume: Number.isFinite(Number(legacy.volume)) ? Number(legacy.volume) : DEFAULT_BANNED_SETTINGS.volume,
      soundDurationMs: Number.isFinite(Number(legacy.soundDurationMs)) ? Number(legacy.soundDurationMs) : DEFAULT_BANNED_SETTINGS.soundDurationMs
    }
  };
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function initialStore() {
  return {
    overlayToken: randomToken(24),
    owner: null,
    kick: null,
    settings: normalizeSettings(null),
    webhook: {
      subscribed: false,
      subscriptionMessage: 'لم يتم الربط بعد',
      subscriptionId: null,
      lastCheckedAt: null,
      lastDeliveryAt: null,
      lastEventAt: null,
      lastEventType: null,
      lastMessageId: null,
      lastSubscriptionId: null,
      lastSignatureValid: null,
      lastRejectedAt: null,
      lastRejectedReason: null
    },
    history: []
  };
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      const s = initialStore();
      fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2));
      return s;
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      ...initialStore(),
      ...parsed,
      settings: normalizeSettings(parsed.settings),
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch (err) {
    console.error('Store read error:', err);
    return initialStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

let store = readStore();

function encryptionKey() {
  return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY).digest();
}

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(b => b.toString('base64url')).join('.');
}

function decrypt(blob) {
  if (!blob) return null;
  const [ivB64, tagB64, dataB64] = String(blob).split('.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivB64, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function isAuthenticated(req) {
  return Boolean(req.session && req.session.kickUserId && store.owner && Number(req.session.kickUserId) === Number(store.owner.user_id));
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'يجب ربط حساب Kick أولاً.' });
  next();
}

function publicSettings() {
  return {
    settings: store.settings,
    overlayUrl: `${APP_URL}/overlay/${store.overlayToken}`,
    connected: Boolean(store.owner && store.kick),
    owner: store.owner,
    webhook: store.webhook,
    appUrl: APP_URL,
    webhookUrl: `${APP_URL}/webhooks/kick`,
    publicHttpsReady: isLikelyPublicHttps(APP_URL)
  };
}


function isLikelyPublicHttps(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    return u.protocol === 'https:' && !local;
  } catch {
    return false;
  }
}

function makePkce() {
  const verifier = randomToken(64);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function kickFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`Kick API ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function refreshKickTokenIfNeeded() {
  if (!store.kick) throw new Error('Kick account not connected.');
  const expiresAt = Number(store.kick.expires_at || 0);
  if (Date.now() < expiresAt - 60_000) return decrypt(store.kick.access_token);

  const refreshToken = decrypt(store.kick.refresh_token);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: KICK_CLIENT_ID,
    client_secret: KICK_CLIENT_SECRET,
    refresh_token: refreshToken
  });

  const tokenData = await kickFetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  store.kick.access_token = encrypt(tokenData.access_token);
  if (tokenData.refresh_token) store.kick.refresh_token = encrypt(tokenData.refresh_token);
  store.kick.expires_at = Date.now() + Number(tokenData.expires_in || 3600) * 1000;
  store.kick.scope = tokenData.scope || store.kick.scope;
  writeStore(store);
  return tokenData.access_token;
}


async function getEventSubscriptions() {
  if (!store.owner || !store.kick) throw new Error('Account not connected.');
  const accessToken = await refreshKickTokenIfNeeded();
  const url = new URL('https://api.kick.com/public/v1/events/subscriptions');
  url.searchParams.set('broadcaster_user_id', String(store.owner.user_id));
  return kickFetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
}

async function refreshSubscriptionStatus() {
  const data = await getEventSubscriptions();
  const rows = Array.isArray(data?.data) ? data.data : [];
  const found = rows.find(x => x?.event === 'moderation.banned' && Number(x?.version || 1) === 1 && x?.method === 'webhook');
  store.webhook.subscribed = Boolean(found);
  store.webhook.subscriptionId = found?.id || null;
  store.webhook.lastCheckedAt = new Date().toISOString();
  store.webhook.subscriptionMessage = found ? 'اشتراك moderation.banned مؤكد من Kick' : 'لم أجد اشتراك moderation.banned في Kick';
  store.webhook.lastListResponse = data;
  writeStore(store);
  return { data, found };
}

async function subscribeModerationEvent() {
  if (!store.owner || !store.kick) throw new Error('Account not connected.');
  const accessToken = await refreshKickTokenIfNeeded();
  const payload = {
    broadcaster_user_id: Number(store.owner.user_id),
    method: 'webhook',
    events: [{ name: 'moderation.banned', version: 1 }]
  };

  try {
    const data = await kickFetch('https://api.kick.com/public/v1/events/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    store.webhook.subscribed = true;
    store.webhook.subscriptionMessage = 'تم طلب الاشتراك في moderation.banned';
    store.webhook.lastSubscribeResponse = data;
    const created = Array.isArray(data?.data) ? data.data.find(x => x?.name === 'moderation.banned') : null;
    if (created?.subscription_id) store.webhook.subscriptionId = created.subscription_id;
    writeStore(store);
    try { await refreshSubscriptionStatus(); } catch (verifyErr) { console.error('Subscription verify error:', verifyErr.data || verifyErr.message); }
    return data;
  } catch (err) {
    const message = err.data?.message || err.data?.error || err.message;
    // Kick may return an error if the exact subscription already exists.
    if (/already|exist|duplicate/i.test(String(message))) {
      store.webhook.subscribed = true;
      store.webhook.subscriptionMessage = 'الاشتراك موجود مسبقاً';
      writeStore(store);
      return { message };
    }
    store.webhook.subscribed = false;
    store.webhook.subscriptionMessage = `فشل الاشتراك: ${message}`;
    writeStore(store);
    throw err;
  }
}

const processedWebhookIds = new Set();
let kickPublicKeyCache = { value: null, fetchedAt: 0 };
async function getKickPublicKey() {
  if (kickPublicKeyCache.value && Date.now() - kickPublicKeyCache.fetchedAt < 6 * 60 * 60 * 1000) {
    return kickPublicKeyCache.value;
  }
  const data = await kickFetch('https://api.kick.com/public/v1/public-key');
  const key = data?.data?.public_key || data?.public_key || data?.data || null;
  if (!key || typeof key !== 'string') throw new Error('Could not read Kick public key.');
  kickPublicKeyCache = { value: key, fetchedAt: Date.now() };
  return key;
}

async function verifyKickWebhook(req, rawBody) {
  if (ALLOW_UNVERIFIED_WEBHOOKS) return true;
  const messageId = req.get('Kick-Event-Message-Id');
  const timestamp = req.get('Kick-Event-Message-Timestamp');
  const signatureB64 = req.get('Kick-Event-Signature');
  if (!messageId || !timestamp || !signatureB64) return false;


  const publicKey = await getKickPublicKey();
  const signedPayload = Buffer.from(`${messageId}.${timestamp}.${rawBody.toString('utf8')}`, 'utf8');
  return crypto.verify(
    'RSA-SHA256',
    signedPayload,
    publicKey,
    Buffer.from(signatureB64, 'base64')
  );
}

function humanDuration(createdAt, expiresAt) {
  const start = Date.parse(createdAt);
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'مدة غير معروفة';
  let seconds = Math.max(1, Math.round((end - start) / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  const parts = [];
  if (days) parts.push(`${days} يوم`);
  if (hours) parts.push(`${hours} ساعة`);
  if (minutes) parts.push(`${minutes} دقيقة`);
  if (seconds && parts.length < 2) parts.push(`${seconds} ثانية`);
  return parts.slice(0, 2).join(' و ');
}

function normalizeModerationEvent(payload) {
  const md = payload.metadata || {};
  const isTimeout = Boolean(md.expires_at);
  return {
    id: randomToken(10),
    type: isTimeout ? 'timeout' : 'banned',
    username: payload.banned_user?.username || 'مستخدم',
    avatar: payload.banned_user?.profile_picture || '',
    userId: payload.banned_user?.user_id || null,
    moderator: payload.moderator?.username || 'Moderator',
    moderatorAvatar: payload.moderator?.profile_picture || '',
    reason: md.reason || 'بدون سبب',
    createdAt: md.created_at || new Date().toISOString(),
    expiresAt: md.expires_at || null,
    duration: isTimeout ? humanDuration(md.created_at, md.expires_at) : 'حظر دائم',
    broadcasterId: payload.broadcaster?.user_id || null,
    broadcaster: payload.broadcaster?.username || ''
  };
}

function emitModerationAlert(event) {
  io.to(`overlay:${store.overlayToken}`).emit('moderation-alert', event);
  store.history.unshift(event);
  store.history = store.history.slice(0, 50);
  store.webhook.lastEventAt = new Date().toISOString();
  store.webhook.lastAcceptedType = event.type;
  writeStore(store);
}

// Webhook must receive raw JSON for Kick signature verification.
app.post('/webhooks/kick', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const eventType = req.get('Kick-Event-Type') || 'unknown';
    const messageId = req.get('Kick-Event-Message-Id') || null;
    store.webhook.lastDeliveryAt = new Date().toISOString();
    store.webhook.lastEventType = eventType;
    store.webhook.lastMessageId = messageId;
    store.webhook.lastSubscriptionId = req.get('Kick-Event-Subscription-Id') || null;
    writeStore(store);

    const verified = await verifyKickWebhook(req, rawBody);
    store.webhook.lastSignatureValid = Boolean(verified);
    if (!verified) {
      store.webhook.lastRejectedAt = new Date().toISOString();
      store.webhook.lastRejectedReason = 'توقيع Kick غير صالح أو الهيدرز ناقصة/قديمة';
      writeStore(store);
      return res.status(401).send('invalid signature');
    }
    writeStore(store);


    if (messageId && processedWebhookIds.has(messageId)) return res.status(200).send('duplicate');
    if (messageId) {
      processedWebhookIds.add(messageId);
      if (processedWebhookIds.size > 500) processedWebhookIds.delete(processedWebhookIds.values().next().value);
    }

    const payload = JSON.parse(rawBody.toString('utf8'));

    if (eventType === 'moderation.banned') {
      const broadcasterId = Number(payload.broadcaster?.user_id || 0);
      const isOurChannel = store.owner && broadcasterId === Number(store.owner.user_id);
      if (isOurChannel) {
        emitModerationAlert(normalizeModerationEvent(payload));
      } else {
        store.webhook.lastRejectedAt = new Date().toISOString();
        store.webhook.lastRejectedReason = `وصل moderation.banned لقناة مختلفة (${broadcasterId || 'unknown'})`;
        writeStore(store);
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('webhook error');
  }
});

app.set('trust proxy', 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: APP_URL.startsWith('https://'),
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));
app.use(express.static(PUBLIC_DIR));

// Explicit dashboard route so Render always serves the homepage even if static index resolution changes.
app.get('/', (_req, res) => {
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return res.status(500).send('Dashboard file is missing on the server. Check that public/index.html exists in the deployed GitHub commit.');
  }
  res.sendFile(indexFile);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${randomToken(8)}${ext}`);
    }
  }),
  limits: { fileSize: 250 * 1024 * 1024 }
});

app.get('/health', (_req, res) => res.json({ ok: true, version: '4.0.0', publicIndexExists: fs.existsSync(path.join(PUBLIC_DIR, 'index.html')) }));

app.get('/auth/kick', (req, res) => {
  if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET) {
    return res.status(500).send('ضع KICK_CLIENT_ID و KICK_CLIENT_SECRET في ملف .env أولاً.');
  }
  const { verifier, challenge } = makePkce();
  const state = randomToken(24);
  req.session.oauth = { verifier, state, createdAt: Date.now() };

  const redirectUri = `${APP_URL}/auth/kick/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: KICK_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'user:read events:subscribe',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });
  res.redirect(`https://id.kick.com/oauth/authorize?${params.toString()}`);
});

app.get('/auth/kick/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const oauth = req.session.oauth;
    if (!code || !state || !oauth || state !== oauth.state || Date.now() - oauth.createdAt > 10 * 60 * 1000) {
      return res.status(400).send('OAuth state غير صالح أو انتهت صلاحيته.');
    }

    const redirectUri = `${APP_URL}/auth/kick/callback`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: KICK_CLIENT_ID,
      client_secret: KICK_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code_verifier: oauth.verifier,
      code: String(code)
    });

    const tokenData = await kickFetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const userData = await kickFetch('https://api.kick.com/public/v1/users', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const user = Array.isArray(userData?.data) ? userData.data[0] : userData?.data;
    if (!user?.user_id) throw new Error('لم أستطع قراءة حساب Kick من API.');

    store.owner = {
      user_id: Number(user.user_id),
      name: user.name || user.username || 'Kick User',
      email: user.email || '',
      profile_picture: user.profile_picture || ''
    };
    store.kick = {
      access_token: encrypt(tokenData.access_token),
      refresh_token: encrypt(tokenData.refresh_token),
      expires_at: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
      scope: tokenData.scope || 'user:read events:subscribe'
    };
    writeStore(store);
    req.session.kickUserId = store.owner.user_id;
    delete req.session.oauth;

    try { await subscribeModerationEvent(); }
    catch (subErr) { console.error('Subscribe error:', subErr.data || subErr.message); }

    res.redirect('/?connected=1');
  } catch (err) {
    console.error('OAuth callback error:', err.data || err);
    res.status(500).send(`فشل ربط Kick: ${err.data?.message || err.message}`);
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/status', (req, res) => {
  res.json({
    authenticated: isAuthenticated(req),
    configured: Boolean(KICK_CLIENT_ID && KICK_CLIENT_SECRET),
    connected: Boolean(store.owner && store.kick),
    owner: store.owner,
    webhook: store.webhook,
    appUrl: APP_URL,
    webhookUrl: `${APP_URL}/webhooks/kick`,
    publicHttpsReady: isLikelyPublicHttps(APP_URL)
  });
});

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json(publicSettings());
});

app.post('/api/settings', requireAuth, (req, res) => {
  const incoming = req.body || {};
  const eventType = incoming.eventType === 'banned' ? 'banned' : 'timeout';
  const current = store.settings[eventType] || (eventType === 'banned' ? DEFAULT_BANNED_SETTINGS : DEFAULT_TIMEOUT_SETTINGS);
  const defaults = eventType === 'banned' ? DEFAULT_BANNED_SETTINGS : DEFAULT_TIMEOUT_SETTINGS;
  const allowedPositions = new Set(['top', 'center', 'bottom']);
  const allowedLayouts = new Set(['card', 'fullscreen', 'media']);

  const clean = {
    layoutMode: allowedLayouts.has(incoming.layoutMode) ? incoming.layoutMode : current.layoutMode,
    durationMs: Math.min(30000, Math.max(2500, Number(incoming.durationMs) || current.durationMs)),
    soundDurationMs: Math.min(30000, Math.max(500, Number(incoming.soundDurationMs) || current.soundDurationMs || 6500)),
    position: allowedPositions.has(incoming.position) ? incoming.position : current.position,
    showAvatar: Boolean(incoming.showAvatar),
    showModerator: Boolean(incoming.showModerator),
    showReason: Boolean(incoming.showReason),
    showDuration: eventType === 'timeout' ? Boolean(incoming.showDuration) : false,
    titleTemplate: String(incoming.titleTemplate || defaults.titleTemplate).slice(0, 140),
    subtitleTemplate: String(incoming.subtitleTemplate || defaults.subtitleTemplate).slice(0, 140),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(incoming.accent)) ? String(incoming.accent) : current.accent,
    customLogoUrl: String(incoming.customLogoUrl || '').slice(0, 500),
    customSoundUrl: String(incoming.customSoundUrl || '').slice(0, 500),
    fullscreenBackgroundUrl: String(incoming.fullscreenBackgroundUrl || '').slice(0, 500),
    fullscreenMediaUrl: String(incoming.fullscreenMediaUrl || incoming.fullscreenBackgroundUrl || '').slice(0, 500),
    fullscreenDim: Math.min(0.95, Math.max(0, Number(incoming.fullscreenDim ?? current.fullscreenDim))),
    videoMuted: incoming.videoMuted !== false,
    volume: Math.min(1, Math.max(0, Number(incoming.volume)))
  };

  store.settings[eventType] = clean;
  writeStore(store);
  io.to(`overlay:${store.overlayToken}`).emit('settings-updated', store.settings);
  res.json(publicSettings());
});

app.post('/api/subscribe', requireAuth, async (_req, res) => {
  try {
    const data = await subscribeModerationEvent();
    res.json({ ok: true, data, webhook: store.webhook });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.data?.message || err.message, details: err.data || null });
  }
});

app.post('/api/diagnostics', requireAuth, async (_req, res) => {
  const result = {
    appUrl: APP_URL,
    webhookUrl: `${APP_URL}/webhooks/kick`,
    publicHttpsReady: isLikelyPublicHttps(APP_URL),
    webhook: store.webhook,
    subscription: null,
    error: null
  };
  try {
    const checked = await refreshSubscriptionStatus();
    result.subscription = checked.found || null;
    result.webhook = store.webhook;
  } catch (err) {
    result.error = err.data?.message || err.message;
  }
  res.json(result);
});

app.post('/api/regenerate-overlay-token', requireAuth, (_req, res) => {
  store.overlayToken = randomToken(24);
  writeStore(store);
  res.json({ overlayUrl: `${APP_URL}/overlay/${store.overlayToken}` });
});

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف.' });
  const url = `${APP_URL}/uploads/${encodeURIComponent(req.file.filename)}`;
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const videoExts = new Set(['.mp4','.webm','.mov','.mkv','.avi','.m4v','.mpeg','.mpg','.mpe','.ogv','.ogg','.wmv','.flv','.f4v','.3gp','.3g2','.ts','.mts','.m2ts','.mxf','.vob','.asf','.dv','.rm','.rmvb']);
  const mediaKind = String(req.file.mimetype || '').startsWith('video/') || videoExts.has(ext) ? 'video' : (String(req.file.mimetype || '').startsWith('image/') ? 'image' : 'file');
  res.json({ url, filename: req.file.filename, mimetype: req.file.mimetype, mediaKind });
});

app.post('/api/test-alert', requireAuth, (req, res) => {
  const now = new Date();
  const requestedType = req.body?.type === 'banned' ? 'banned' : 'timeout';
  const expires = new Date(now.getTime() + 10 * 60 * 1000);
  const event = {
    id: randomToken(10),
    type: requestedType,
    username: req.body?.username || 'Viewer_123',
    avatar: req.body?.avatar || 'https://kick.com/img/default-profile-pictures/default2.jpeg',
    moderator: req.body?.moderator || store.owner?.name || 'Moderator',
    reason: req.body?.reason || (requestedType === 'banned' ? 'تجربة أليرت الحظر' : 'تجربة أليرت التايم أوت'),
    createdAt: now.toISOString(),
    expiresAt: requestedType === 'timeout' ? expires.toISOString() : null,
    duration: requestedType === 'timeout' ? (req.body?.duration || '10 دقائق') : 'حظر دائم',
    broadcasterId: store.owner?.user_id || null,
    broadcaster: store.owner?.name || ''
  };
  emitModerationAlert(event);
  res.json({ ok: true, event });
});

app.get('/api/history', requireAuth, (_req, res) => {
  res.json({ history: store.history });
});

app.get('/overlay/:token', (req, res) => {
  if (req.params.token !== store.overlayToken) return res.status(404).send('Overlay not found');
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get('/api/overlay-config/:token', (req, res) => {
  if (req.params.token !== store.overlayToken) return res.status(404).json({ error: 'not found' });
  res.set('Cache-Control', 'no-store');
  res.json({ settings: store.settings });
});

io.on('connection', socket => {
  socket.on('join-overlay', token => {
    if (token === store.overlayToken) socket.join(`overlay:${store.overlayToken}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kick Timeout Alert running on ${APP_URL}`);
  console.log(`Webhook URL: ${APP_URL}/webhooks/kick`);
});
