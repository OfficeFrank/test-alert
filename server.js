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
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  theme: 'royal',
  layoutMode: 'card',
  durationMs: 6500,
  position: 'center',
  showAvatar: true,
  showModerator: true,
  showReason: true,
  showDuration: true,
  titleTemplate: 'تم إعطاء {username} تايم أوت',
  subtitleTemplate: '{duration} • بواسطة {moderator}',
  accent: '#53FC18',
  customLogoUrl: '',
  customSoundUrl: '',
  fullscreenBackgroundUrl: '',
  fullscreenDim: 0.68,
  volume: 0.75
};

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function initialStore() {
  return {
    overlayToken: randomToken(24),
    owner: null,
    kick: null,
    settings: { ...DEFAULT_SETTINGS },
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
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
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
    ...store.settings,
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

function normalizeTimeoutEvent(payload) {
  const md = payload.metadata || {};
  return {
    id: randomToken(10),
    type: 'timeout',
    username: payload.banned_user?.username || 'مستخدم',
    avatar: payload.banned_user?.profile_picture || '',
    userId: payload.banned_user?.user_id || null,
    moderator: payload.moderator?.username || 'Moderator',
    moderatorAvatar: payload.moderator?.profile_picture || '',
    reason: md.reason || 'بدون سبب',
    createdAt: md.created_at || new Date().toISOString(),
    expiresAt: md.expires_at,
    duration: humanDuration(md.created_at, md.expires_at),
    broadcasterId: payload.broadcaster?.user_id || null,
    broadcaster: payload.broadcaster?.username || ''
  };
}

function emitTimeoutAlert(event) {
  io.to(`overlay:${store.overlayToken}`).emit('timeout-alert', event);
  store.history.unshift(event);
  store.history = store.history.slice(0, 50);
  store.webhook.lastEventAt = new Date().toISOString();
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
      const isTimeout = Boolean(payload.metadata?.expires_at);
      if (isOurChannel && isTimeout) {
        emitTimeoutAlert(normalizeTimeoutEvent(payload));
      } else if (!isOurChannel) {
        store.webhook.lastRejectedAt = new Date().toISOString();
        store.webhook.lastRejectedReason = `وصل moderation.banned لقناة مختلفة (${broadcasterId || 'unknown'})`;
        writeStore(store);
      } else if (!isTimeout) {
        store.webhook.lastRejectedAt = new Date().toISOString();
        store.webhook.lastRejectedReason = 'وصل Ban دائم وليس Timeout؛ لم يتم عرض أليرت';
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
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${randomToken(8)}${ext}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024 }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

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
  const allowedThemes = new Set(['royal', 'swat', 'neon', 'minimal']);
  const allowedPositions = new Set(['top', 'center', 'bottom']);
  const allowedLayouts = new Set(['card', 'fullscreen']);
  const clean = {
    theme: allowedThemes.has(incoming.theme) ? incoming.theme : store.settings.theme,
    layoutMode: allowedLayouts.has(incoming.layoutMode) ? incoming.layoutMode : store.settings.layoutMode,
    durationMs: Math.min(15000, Math.max(2500, Number(incoming.durationMs) || store.settings.durationMs)),
    position: allowedPositions.has(incoming.position) ? incoming.position : store.settings.position,
    showAvatar: Boolean(incoming.showAvatar),
    showModerator: Boolean(incoming.showModerator),
    showReason: Boolean(incoming.showReason),
    showDuration: Boolean(incoming.showDuration),
    titleTemplate: String(incoming.titleTemplate || DEFAULT_SETTINGS.titleTemplate).slice(0, 140),
    subtitleTemplate: String(incoming.subtitleTemplate || DEFAULT_SETTINGS.subtitleTemplate).slice(0, 140),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(incoming.accent)) ? String(incoming.accent) : store.settings.accent,
    customLogoUrl: String(incoming.customLogoUrl || '').slice(0, 500),
    customSoundUrl: String(incoming.customSoundUrl || '').slice(0, 500),
    fullscreenBackgroundUrl: String(incoming.fullscreenBackgroundUrl || '').slice(0, 500),
    fullscreenDim: Math.min(0.95, Math.max(0, Number(incoming.fullscreenDim ?? store.settings.fullscreenDim))),
    volume: Math.min(1, Math.max(0, Number(incoming.volume)))
  };
  store.settings = clean;
  writeStore(store);
  io.to(`overlay:${store.overlayToken}`).emit('settings-updated', clean);
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
  res.json({ url, filename: req.file.filename });
});

app.post('/api/test-alert', requireAuth, (req, res) => {
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000);
  const event = {
    id: randomToken(10),
    type: 'timeout',
    username: req.body?.username || 'Viewer_123',
    avatar: req.body?.avatar || 'https://kick.com/img/default-profile-pictures/default2.jpeg',
    moderator: req.body?.moderator || store.owner?.name || 'Moderator',
    reason: req.body?.reason || 'تجربة أليرت التايم أوت',
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    duration: req.body?.duration || '10 دقائق',
    broadcasterId: store.owner?.user_id || null,
    broadcaster: store.owner?.name || ''
  };
  io.to(`overlay:${store.overlayToken}`).emit('timeout-alert', event);
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
