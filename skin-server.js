// Archivo: skin-server.js
// Servidor Yggdrasil local para servir skins con authlib-injector
// Version mejorada para Xeno Launcher

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let server = null;
let port = 0;
const skinCache = new Map();
const skinHashes = new Map();
const skinDisplayNames = new Map();
const skinModels = new Map();
let skinDir = '';

// ==========================================
// FUNCIONES DE UUID
// ==========================================

function generateUUID(username) {
  if (!username) return '00000000-0000-0000-0000-000000000000';
  const hash = crypto.createHash('md5').update(username.toLowerCase()).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function normalizeUuid(uuid) {
  return String(uuid || '').toLowerCase().replace(/-/g, '');
}

function generateOfflineUUID(username) {
  // UUID offline de Minecraft: "OfflinePlayer:" + username
  const data = 'OfflinePlayer:' + username;
  const hash = crypto.createHash('md5').update(data).digest();
  // Set version to 3 (name-based)
  hash[6] = (hash[6] & 0x0f) | 0x30;
  // Set variant to RFC 4122
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ==========================================
// FUNCIONES DE SKIN
// ==========================================

function loadSkinsFromDirectory(dir) {
  if (!dir || !fs.existsSync(dir)) {
    console.log('[SkinServer] Directory not found:', dir);
    return 0;
  }

  skinDir = dir;
  skinCache.clear();
  skinHashes.clear();
  skinDisplayNames.clear();
  skinModels.clear();

  try {
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'));

    for (const file of files) {
      const username = path.basename(file, '.png').toLowerCase();
      const skinPath = path.join(dir, file);

      try {
        const data = fs.readFileSync(skinPath);
        const base64 = data.toString('base64');
        const hash = crypto.createHash('sha256').update(data).digest('hex').substring(0, 40);

        skinCache.set(username, base64);
        skinHashes.set(username, hash);
        skinDisplayNames.set(username, path.basename(file, '.png'));
        skinModels.set(username, 'classic');

        console.log(`[SkinServer] Loaded skin: ${username}`);
      } catch (err) {
        console.error(`[SkinServer] Error loading ${file}:`, err.message);
      }
    }

    console.log(`[SkinServer] Loaded ${skinCache.size} skins`);
    return skinCache.size;
  } catch (err) {
    console.error('[SkinServer] Error reading directory:', err.message);
    return 0;
  }
}

function setSkin(username, base64Data, model = 'classic') {
  if (!username || !base64Data) return false;

  const cleanData = base64Data.replace(/^data:image\/png;base64,/, '');

  try {
    const hash = crypto.createHash('sha256').update(Buffer.from(cleanData, 'base64')).digest('hex').substring(0, 40);

    const key = username.toLowerCase();
    skinCache.set(key, cleanData);
    skinHashes.set(key, hash);
    skinDisplayNames.set(key, String(username).trim() || username);
    skinModels.set(key, model === 'slim' ? 'slim' : 'classic');

    console.log(`[SkinServer] Set skin for: ${username}`);
    return true;
  } catch (err) {
    console.error('[SkinServer] Error setting skin:', err.message);
    return false;
  }
}

function removeSkin(username) {
  if (!username) return false;
  const key = username.toLowerCase();
  skinCache.delete(key);
  skinHashes.delete(key);
  skinDisplayNames.delete(key);
  skinModels.delete(key);
  console.log(`[SkinServer] Removed skin for: ${username}`);
  return true;
}

function hasSkin(username) {
  return skinCache.has(username.toLowerCase());
}

function getSkinsCount() {
  return skinCache.size;
}

// ==========================================
// SERVIDOR HTTP
// ==========================================

function startServer(skinsDirectory) {
  if (server) {
    console.log('[SkinServer] Already running on port:', port);
    return port;
  }

  skinDir = skinsDirectory;

  server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Log de peticiones (debug)
    console.log(`[SkinServer] ${req.method} ${pathname}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // ========================================
    // ROOT - Info del servidor (requerido por authlib-injector)
    // ========================================
    if (pathname === '/' || pathname === '') {
      const response = {
        meta: {
          serverName: 'Xeno Launcher Skin Server',
          implementationName: 'xeno-skin-server',
          implementationVersion: '1.0.0',
          links: {
            homepage: 'https://xeno-launcher.local'
          }
        },
        skinDomains: ['127.0.0.1', 'localhost']
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    // ========================================
    // STATUS - Verificar estado
    // ========================================
    if (pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        skins: skinCache.size,
        port: port
      }));
      return;
    }

    // ========================================
    // RELOAD - Recargar skins
    // ========================================
    if (pathname === '/reload') {
      const count = loadSkinsFromDirectory(skinDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        message: `Loaded ${count} skins`
      }));
      return;
    }

    // ========================================
    // TEXTURES - Servir archivos de skin por hash
    // ========================================
    if (pathname.startsWith('/textures/')) {
      const hash = pathname.replace('/textures/', '').split('?')[0];

      // Buscar en cache por hash
      let skinData = null;
      for (const [username, data] of skinCache.entries()) {
        const storedHash = skinHashes.get(username);
        if (storedHash === hash) {
          skinData = data;
          console.log(`[SkinServer] Found skin by hash: ${username}`);
          break;
        }
      }

      if (skinData) {
        const buffer = Buffer.from(skinData, 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': buffer.length,
          'Cache-Control': 'public, max-age=86400'
        });
        res.end(buffer);
        return;
      }

      console.log(`[SkinServer] Texture not found: ${hash}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Texture not found' }));
      return;
    }

    // ========================================
    // SKIN DIRECT - Obtener skin por username
    // ========================================
    if (pathname.startsWith('/skin/') && pathname.endsWith('.png')) {
      const username = path.basename(pathname, '.png').toLowerCase();
      const skinData = skinCache.get(username);

      if (skinData) {
        const buffer = Buffer.from(skinData, 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': buffer.length
        });
        res.end(buffer);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Skin not found' }));
      return;
    }

    // ========================================
    // API YGGDRASIL
    // ========================================

    // /sessionserver/session/minecraft/profile/{uuid}
    // Este es el endpoint mas importante para las skins
    if (pathname.includes('/session/minecraft/profile/')) {
      const uuid = pathname.split('/').pop().split('?')[0];
      const normalizedRequestUuid = normalizeUuid(uuid);

      console.log(`[SkinServer] Profile request for UUID: ${uuid}`);

      // Buscar usuario por UUID (offline UUID)
      let foundUser = null;
      for (const [username] of skinCache.entries()) {
        const offlineUuid = normalizeUuid(generateOfflineUUID(username));
        const normalUuid = normalizeUuid(generateUUID(username));
        if (offlineUuid === normalizedRequestUuid || normalUuid === normalizedRequestUuid) {
          foundUser = username;
          console.log(`[SkinServer] Found user: ${username} for UUID: ${uuid}`);
          break;
        }
      }

      if (foundUser) {
        const skinData = skinCache.get(foundUser);
        const skinHash = skinHashes.get(foundUser);
        const skinModel = skinModels.get(foundUser) === 'slim' ? 'slim' : 'classic';
        const offlineUuid = normalizeUuid(generateOfflineUUID(foundUser));
        const displayName = skinDisplayNames.get(foundUser) || foundUser;

        const texturesJson = {
          timestamp: Date.now(),
          profileId: offlineUuid,
          profileName: displayName,
          textures: {
            SKIN: {
              url: `http://127.0.0.1:${port}/textures/${skinHash}`
            }
          }
        };
        if (skinModel === 'slim') {
          texturesJson.textures.SKIN.metadata = { model: 'slim' };
        }

        const profile = {
          id: offlineUuid,
          name: displayName,
          properties: [
            {
              name: 'textures',
              value: Buffer.from(JSON.stringify(texturesJson)).toString('base64')
            }
          ]
        };

        console.log(`[SkinServer] Sending profile for: ${foundUser}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profile));
        return;
      }

      console.log(`[SkinServer] Profile not found for UUID: ${uuid}`);
      res.writeHead(204); // No Content - jugador no encontrado
      res.end();
      return;
    }

    // /api/profiles/minecraft
    if (pathname.endsWith('/profiles/minecraft') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const usernames = JSON.parse(body);
          const profiles = [];

          for (const username of usernames) {
            if (skinCache.has(username.toLowerCase())) {
              const offlineUuid = generateOfflineUUID(username);
              profiles.push({
                id: offlineUuid,
                name: username
              });
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(profiles));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // /api/authenticate - Para login offline
    if (pathname.endsWith('/authenticate') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const username = data.username || data.agent?.username || 'Player';
          const offlineUuid = generateOfflineUUID(username);

          const response = {
            accessToken: crypto.randomBytes(32).toString('hex'),
            clientToken: crypto.randomBytes(16).toString('hex'),
            availableProfiles: [{
              id: offlineUuid,
              name: username
            }],
            selectedProfile: {
              id: offlineUuid,
              name: username
            }
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // /api/refresh
    if (pathname.endsWith('/refresh') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const profile = data.selectedProfile || { id: generateOfflineUUID('Player'), name: 'Player' };
          const offlineUuid = generateOfflineUUID(profile.name);

          const response = {
            accessToken: crypto.randomBytes(32).toString('hex'),
            clientToken: crypto.randomBytes(16).toString('hex'),
            selectedProfile: {
              id: offlineUuid,
              name: profile.name
            }
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // 404 para otros endpoints
    console.log(`[SkinServer] 404 Not Found: ${pathname}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: pathname }));
  });

  // Escuchar en un puerto disponible
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    console.log(`[SkinServer] Running on http://127.0.0.1:${port}`);

    // Cargar skins si el directorio existe
    if (skinDir && fs.existsSync(skinDir)) {
      loadSkinsFromDirectory(skinDir);
    }
  });

  server.on('error', (err) => {
    console.error('[SkinServer] Error:', err.message);
  });

  return port;
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
    port = 0;
    skinCache.clear();
    skinHashes.clear();
    skinDisplayNames.clear();
    skinModels.clear();
    console.log('[SkinServer] Stopped');
  }
}

function getPort() {
  return port;
}

function isRunning() {
  return server !== null && port > 0;
}

function getServerUrl() {
  return port ? `http://127.0.0.1:${port}` : null;
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  startServer,
  stopServer,
  getPort,
  isRunning,
  getServerUrl,
  loadSkinsFromDirectory,
  setSkin,
  removeSkin,
  hasSkin,
  getSkinsCount,
  generateUUID,
  generateOfflineUUID
};
