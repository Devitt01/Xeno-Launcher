const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.XENO_SKIN_HOST || '0.0.0.0';
const PORT = Number(process.env.XENO_SKIN_PORT || process.env.PORT || 52735);
const DATA_DIR = path.resolve(process.env.XENO_SKIN_DATA_DIR || path.join(__dirname, 'skin-hub-data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TEXTURES_DIR = path.join(DATA_DIR, 'textures');
const WRITE_TOKEN = String(process.env.XENO_SKIN_TOKEN || '').trim();
const PUBLIC_BASE_URL = String(process.env.XENO_SKIN_BASE_URL || '').trim().replace(/\/+$/, '');

const usersByName = new Map();
const usersByUuid = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeUuid(uuid) {
  return String(uuid || '').toLowerCase().replace(/-/g, '');
}

function sanitizeUsername(username) {
  return String(username || '')
    .trim()
    .replace(/[^\w.-]/g, '')
    .slice(0, 32);
}

function generateOfflineUUID(username) {
  const value = `OfflinePlayer:${String(username || '').toLowerCase()}`;
  const hash = crypto.createHash('md5').update(value).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function getPngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.readUInt32BE(12) !== 0x49484452) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function isValidSkinPng(buffer) {
  const size = getPngSize(buffer);
  if (!size) return false;
  const { width, height } = size;
  if (width < 64 || height < 32) return false;
  if (width % 64 !== 0) return false;
  return height === width || height * 2 === width;
}

function decodeSkinDataUrl(skinData) {
  if (!skinData || typeof skinData !== 'string') return null;
  const match = skinData.trim().match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  try {
    return Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, filePath);
    return;
  } catch (err) {
    // Windows puede devolver EPERM al reemplazar un archivo existente.
    if (err && (err.code === 'EPERM' || err.code === 'EEXIST')) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
      fs.renameSync(tmp, filePath);
      return;
    }
    throw err;
  }
}

function saveUsers() {
  const payload = {};
  for (const [username, entry] of usersByName.entries()) {
    payload[username] = entry;
  }
  writeJsonAtomic(USERS_FILE, payload);
}

function rebuildIndexes() {
  usersByUuid.clear();
  for (const entry of usersByName.values()) {
    usersByUuid.set(normalizeUuid(entry.uuid), entry);
  }
}

function loadUsers() {
  usersByName.clear();
  if (!fs.existsSync(USERS_FILE)) return;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error('[SkinHub] Failed to read users.json:', err.message);
    return;
  }
  const list = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
  for (const item of list) {
    if (!item) continue;
    const username = sanitizeUsername(item.username || item.name || '');
    if (!username) continue;
    const lower = username.toLowerCase();
    const hash = String(item.skinHash || '').trim();
    if (!hash) continue;
    const uuid = normalizeUuid(item.uuid || generateOfflineUUID(lower));
    const entry = {
      username,
      usernameLower: lower,
      uuid,
      skinHash: hash,
      model: item.model === 'slim' ? 'slim' : 'classic',
      updatedAt: Number(item.updatedAt) || Date.now()
    };
    usersByName.set(lower, entry);
  }
  rebuildIndexes();
}

function getPublicBase(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const rawProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = rawProto || 'http';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${PORT}`).split(',')[0].trim();
  return `${protocol}://${rawHost}`.replace(/\/+$/, '');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendPng(res, buffer) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buffer.length,
    'Cache-Control': 'public, max-age=86400'
  });
  res.end(buffer);
}

function readJsonBody(req, maxSize = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Payload demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON invalido.'));
      }
    });
    req.on('error', reject);
  });
}

function hasWriteAccess(req) {
  if (!WRITE_TOKEN) return true;
  const provided = String(req.headers['x-xeno-token'] || '');
  const expectedBuf = Buffer.from(WRITE_TOKEN);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Xeno-Token');
}

function createTexturesProperty(baseUrl, entry) {
  const texturesJson = {
    timestamp: Date.now(),
    profileId: entry.uuid,
    profileName: entry.username,
    textures: {
      SKIN: {
        url: `${baseUrl}/textures/${entry.skinHash}`
      }
    }
  };
  if (entry.model === 'slim') {
    texturesJson.textures.SKIN.metadata = { model: 'slim' };
  }
  return {
    name: 'textures',
    value: Buffer.from(JSON.stringify(texturesJson)).toString('base64')
  };
}

function upsertSkin(usernameRaw, skinData, model) {
  const username = sanitizeUsername(usernameRaw);
  if (!username) throw new Error('Username invalido.');
  const skinBuffer = decodeSkinDataUrl(skinData);
  if (!skinBuffer || !isValidSkinPng(skinBuffer)) {
    throw new Error('Skin invalida. Usa PNG (64x64, 64x32 o HD proporcional).');
  }

  const hash = crypto.createHash('sha256').update(skinBuffer).digest('hex').slice(0, 40);
  const texturePath = path.join(TEXTURES_DIR, `${hash}.png`);
  if (!fs.existsSync(texturePath)) {
    fs.writeFileSync(texturePath, skinBuffer);
  }

  const lower = username.toLowerCase();
  const uuid = normalizeUuid(generateOfflineUUID(lower));
  const entry = {
    username,
    usernameLower: lower,
    uuid,
    skinHash: hash,
    model: model === 'slim' ? 'slim' : 'classic',
    updatedAt: Date.now()
  };

  usersByName.set(lower, entry);
  usersByUuid.set(uuid, entry);
  saveUsers();
  return entry;
}

function removeSkin(usernameRaw) {
  const username = sanitizeUsername(usernameRaw);
  if (!username) return false;
  const lower = username.toLowerCase();
  const entry = usersByName.get(lower);
  if (!entry) return false;
  usersByName.delete(lower);
  usersByUuid.delete(entry.uuid);
  saveUsers();
  return true;
}

function getDomainFromHost(hostHeader) {
  return String(hostHeader || '').split(':')[0].trim();
}

ensureDir(DATA_DIR);
ensureDir(TEXTURES_DIR);
loadUsers();

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let parsed = null;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch {
    sendJson(res, 400, { error: 'Bad request' });
    return;
  }

  const pathname = parsed.pathname;
  const baseUrl = getPublicBase(req);

  try {
    if (pathname === '/' || pathname === '') {
      const domain = getDomainFromHost(req.headers.host);
      sendJson(res, 200, {
        meta: {
          serverName: 'Xeno Skin Hub',
          implementationName: 'xeno-skin-hub',
          implementationVersion: '1.0.0'
        },
        skinDomains: ['127.0.0.1', 'localhost', domain].filter(Boolean)
      });
      return;
    }

    if (pathname === '/status') {
      sendJson(res, 200, {
        status: 'ok',
        users: usersByName.size,
        textures: fs.existsSync(TEXTURES_DIR) ? fs.readdirSync(TEXTURES_DIR).length : 0
      });
      return;
    }

    if (pathname.startsWith('/textures/')) {
      const hash = path.basename(pathname).toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(hash)) {
        sendJson(res, 400, { error: 'Hash invalido.' });
        return;
      }
      const filePath = path.join(TEXTURES_DIR, `${hash}.png`);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'Texture not found' });
        return;
      }
      const buffer = fs.readFileSync(filePath);
      sendPng(res, buffer);
      return;
    }

    const profileMatch = pathname.match(/\/session\/minecraft\/profile\/([^/]+)$/);
    if (profileMatch) {
      const reqUuid = normalizeUuid(profileMatch[1]);
      const entry = usersByUuid.get(reqUuid);
      if (!entry) {
        res.writeHead(204);
        res.end();
        return;
      }
      sendJson(res, 200, {
        id: entry.uuid,
        name: entry.username,
        properties: [createTexturesProperty(baseUrl, entry)]
      });
      return;
    }

    if (pathname.endsWith('/profiles/minecraft') && req.method === 'POST') {
      const body = await readJsonBody(req, 512 * 1024);
      const usernames = Array.isArray(body) ? body : [];
      const profiles = [];
      for (const raw of usernames) {
        const normalized = sanitizeUsername(raw).toLowerCase();
        if (!normalized) continue;
        const entry = usersByName.get(normalized);
        if (entry) {
          profiles.push({ id: entry.uuid, name: entry.username });
        }
      }
      sendJson(res, 200, profiles);
      return;
    }

    if (pathname.endsWith('/authenticate') && req.method === 'POST') {
      const body = await readJsonBody(req, 512 * 1024);
      const requested = sanitizeUsername(body.username || body.agent?.username || 'Player') || 'Player';
      const lower = requested.toLowerCase();
      const known = usersByName.get(lower);
      const uuid = known ? known.uuid : normalizeUuid(generateOfflineUUID(lower));
      sendJson(res, 200, {
        accessToken: crypto.randomBytes(32).toString('hex'),
        clientToken: crypto.randomBytes(16).toString('hex'),
        availableProfiles: [{ id: uuid, name: known ? known.username : requested }],
        selectedProfile: { id: uuid, name: known ? known.username : requested }
      });
      return;
    }

    if (pathname.endsWith('/refresh') && req.method === 'POST') {
      const body = await readJsonBody(req, 512 * 1024);
      const selected = body.selectedProfile || {};
      const requested = sanitizeUsername(selected.name || 'Player') || 'Player';
      const lower = requested.toLowerCase();
      const known = usersByName.get(lower);
      const uuid = known ? known.uuid : normalizeUuid(generateOfflineUUID(lower));
      sendJson(res, 200, {
        accessToken: crypto.randomBytes(32).toString('hex'),
        clientToken: crypto.randomBytes(16).toString('hex'),
        selectedProfile: { id: uuid, name: known ? known.username : requested }
      });
      return;
    }

    if (pathname.endsWith('/validate') && req.method === 'POST') {
      res.writeHead(204);
      res.end();
      return;
    }

    if ((pathname.endsWith('/invalidate') || pathname.endsWith('/signout')) && req.method === 'POST') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname.startsWith('/xeno/skins/')) {
      const username = decodeURIComponent(pathname.slice('/xeno/skins/'.length));

      if (req.method === 'GET') {
        const entry = usersByName.get(sanitizeUsername(username).toLowerCase());
        if (!entry) {
          sendJson(res, 404, { error: 'Skin no encontrada.' });
          return;
        }
        sendJson(res, 200, {
          username: entry.username,
          uuid: entry.uuid,
          skinHash: entry.skinHash,
          model: entry.model,
          updatedAt: entry.updatedAt,
          textureUrl: `${baseUrl}/textures/${entry.skinHash}`
        });
        return;
      }

      if (req.method === 'PUT') {
        if (!hasWriteAccess(req)) {
          sendJson(res, 401, { error: 'Token invalido.' });
          return;
        }
        const body = await readJsonBody(req);
        const skinData = body && body.skinData ? String(body.skinData) : '';
        const model = body && body.model ? String(body.model) : 'classic';
        const entry = upsertSkin(username, skinData, model);
        sendJson(res, 200, {
          ok: true,
          username: entry.username,
          uuid: entry.uuid,
          skinHash: entry.skinHash,
          model: entry.model,
          textureUrl: `${baseUrl}/textures/${entry.skinHash}`
        });
        return;
      }

      if (req.method === 'DELETE') {
        if (!hasWriteAccess(req)) {
          sendJson(res, 401, { error: 'Token invalido.' });
          return;
        }
        const deleted = removeSkin(username);
        sendJson(res, 200, { ok: true, deleted });
        return;
      }
    }

    if (pathname === '/xeno/users') {
      const users = Array.from(usersByName.values())
        .sort((a, b) => a.username.localeCompare(b.username))
        .map((entry) => ({
          username: entry.username,
          uuid: entry.uuid,
          skinHash: entry.skinHash,
          model: entry.model,
          updatedAt: entry.updatedAt
        }));
      sendJson(res, 200, { total: users.length, users });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[SkinHub] Request error:', err.message);
    sendJson(res, 500, { error: err.message || 'Internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[SkinHub] Running on http://${HOST}:${PORT}`);
  console.log(`[SkinHub] Data dir: ${DATA_DIR}`);
  if (WRITE_TOKEN) {
    console.log('[SkinHub] Write token enabled (X-Xeno-Token required).');
  } else {
    console.log('[SkinHub] Write token disabled.');
  }
});
