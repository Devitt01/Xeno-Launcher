// Archivo: main.js
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
try {
  const gracefulFs = require('graceful-fs');
  gracefulFs.gracefulify(fs);
} catch {
  // graceful-fs opcional
}
const https = require('https');
const http = require('http');
const { execFile, execSync, spawn } = require('child_process');
const Store = require('electron-store');
const { Client } = require('minecraft-launcher-core');
let MCLCHandler = null;
try {
  MCLCHandler = require('minecraft-launcher-core/components/handler');
} catch {
  MCLCHandler = null;
}
const skinServer = require('./skin-server');

const APP_ID = 'com.xeno.launcher';
const APP_ICON_ICO = path.join(__dirname, 'build', 'icon.ico');
const APP_ICON_PNG = path.join(__dirname, 'Logos xeno', 'Logo_xeno.png');
const APP_ICON = fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : APP_ICON_PNG;

app.disableHardwareAcceleration();
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

const store = new Store({
  name: 'xeno-launcher',
  defaults: {
    instances: [],
    ram: 4,
    profile: null,
    elyClientToken: '',
    lastAppliedUpdateMarker: '',
    forgeMcVersions: [],
    neoforgeMcVersions: [],
    fabricMcVersions: [],
    snapshotMcVersions: [],
    skinServiceUrl: '',
    skinServiceToken: ''
  }
});

let mainWindow = null;
let splashWindow = null;
let pendingSplashStatus = {
  text: 'Buscando actualizaciones...',
  phase: 'checking',
  progress: null,
  indeterminate: true,
  showProgress: true
};
const activeLaunches = new Map();
const activeInstalls = new Map();

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const FABRIC_META_GAME_URL = 'https://meta.fabricmc.net/v2/versions/game';
const FORGE_PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN_ROOT = 'https://maven.minecraftforge.net/';
const FORGE_MAVEN_BASE = `${FORGE_MAVEN_ROOT}net/minecraftforge/forge/`;
const NEOFORGE_MAVEN_ROOT = 'https://maven.neoforged.net/releases/';
const NEOFORGE_MAVEN_BASE = `${NEOFORGE_MAVEN_ROOT}net/neoforged/neoforge/`;
const NEOFORGE_FORGE_BASE = `${NEOFORGE_MAVEN_ROOT}net/neoforged/forge/`;
const OPTIFINE_VERSION_LIST_URL = 'https://bmclapi2.bangbang93.com/optifine/versionList';
const OPTIFINE_DOWNLOAD_BASE_URL = 'https://bmclapi2.bangbang93.com/optifine';
const MODRINTH_API_BASE_URL = 'https://api.modrinth.com/v2';
const MODRINTH_SODIUM_PROJECT_ID = 'AANobbMI';
const HTTP_USER_AGENT = 'XenoLauncher/1.0';
const AUTHLIB_INJECTOR_META_URLS = [
  'https://authlib-injector.yushi.moe/artifact/latest.json',
  'https://bmclapi2.bangbang93.com/mirrors/authlib-injector/artifact/latest.json'
];
const AUTHLIB_INJECTOR_FALLBACK_URLS = [
  'https://github.com/yushijinhun/authlib-injector/releases/latest/download/authlib-injector.jar'
];
const AUTHLIB_INJECTOR_MAVEN_METADATA = 'https://repo1.maven.org/maven2/org/glavo/hmcl/authlib-injector/maven-metadata.xml';
const AUTHLIB_INJECTOR_MAVEN_BASE = 'https://repo1.maven.org/maven2/org/glavo/hmcl/authlib-injector';
const AUTHLIB_INJECTOR_FILE = 'authlib-injector.jar';
const ELY_AUTH_SERVER_URL = 'https://authserver.ely.by';
const ELY_AUTHLIB_INJECTOR_TARGET = 'ely.by';
const MCLC_ASSET_CONCURRENCY = 12;
const DEFAULT_SHARED_SKIN_SERVICE_URL = process.env.XENO_DEFAULT_SKIN_SERVICE_URL || '';
const STARTUP_MIN_SPLASH_MS = 3000;
const STARTUP_MAX_WAIT_MS = 45000;
const UPDATE_CHECK_TIMEOUT_MS = 12000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 180000;
const UPDATE_MANIFEST_URL = String(process.env.XENO_UPDATE_MANIFEST_URL || '').trim();
const UPDATE_REPO_OVERRIDE = String(process.env.XENO_UPDATE_REPO || '').trim();
const UPDATE_MODE = String(process.env.XENO_UPDATE_MODE || 'auto').trim().toLowerCase();
const UPDATE_INCLUDE_PRERELEASE = /^(1|true|yes)$/i.test(String(process.env.XENO_UPDATE_INCLUDE_PRERELEASE || '').trim());
const UPDATE_REQUIRE_APPROVAL = !/^(0|false|no)$/i.test(String(process.env.XENO_UPDATE_REQUIRE_APPROVAL || 'true').trim());
const UPDATE_ALLOW_UNAPPROVED = /^(1|true|yes)$/i.test(String(process.env.XENO_UPDATE_ALLOW_UNAPPROVED || '').trim());
const UPDATE_APPROVAL_TOKEN = String(process.env.XENO_UPDATE_APPROVAL_TOKEN || 'XENO_PUBLIC_UPDATE').trim();
const UPDATE_ALLOW_BINARY_FALLBACK = /^(1|true|yes)$/i.test(String(process.env.XENO_UPDATE_ALLOW_BINARY_FALLBACK || '').trim());
const UPDATE_MIN_ASAR_BYTES = 128 * 1024;
const ADDON_CACHE_TTL_MS = 30 * 60 * 1000;

const addonCache = {
  optifine: { checkedAt: 0, list: [] },
  sodium: new Map()
};

const sharedSkinServiceHealthCache = {
  url: '',
  ok: false,
  checkedAt: 0
};

async function runWithConcurrency(items, limit, worker) {
  if (!Array.isArray(items) || items.length === 0) return;
  const maxWorkers = Math.max(1, Math.min(limit, items.length));
  let index = 0;
  const workers = [];
  for (let i = 0; i < maxWorkers; i += 1) {
    workers.push((async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= items.length) break;
        await worker(items[current], current);
      }
    })());
  }
  await Promise.all(workers);
}

function patchMclcAssetDownload() {
  if (!MCLCHandler || !MCLCHandler.prototype || MCLCHandler.prototype.__xenoAssetPatch) return;

  const originalDownloadToDirectory = MCLCHandler.prototype.downloadToDirectory;
  const originalGetAssets = MCLCHandler.prototype.getAssets;

  MCLCHandler.prototype.downloadToDirectory = async function patchedDownloadToDirectory(directory, libraries, eventName) {
    try {
      const libs = [];
      const sourceLibraries = Array.isArray(libraries) ? libraries : [];
      const total = sourceLibraries.length;
      let completed = 0;

      this.client.emit('progress', { type: eventName, task: 0, total });

      await runWithConcurrency(sourceLibraries, MCLC_ASSET_CONCURRENCY, async (library) => {
        if (!library) return;
        if (this.parseRule(library)) return;

        const lib = library.name.split(':');
        let jarPath;
        let name;

        if (library.downloads && library.downloads.artifact && library.downloads.artifact.path) {
          const pathParts = library.downloads.artifact.path.split('/');
          name = pathParts[pathParts.length - 1];
          jarPath = path.join(directory, this.popString(library.downloads.artifact.path));
        } else {
          name = `${lib[1]}-${lib[2]}${lib[3] ? `-${lib[3]}` : ''}.jar`;
          jarPath = path.join(directory, `${lib[0].replace(/\./g, '/')}/${lib[1]}/${lib[2]}`);
        }

        const target = path.join(jarPath, name);
        const downloadLibrary = async () => {
          if (library.url) {
            const url = `${library.url}${lib[0].replace(/\./g, '/')}/${lib[1]}/${lib[2]}/${name}`;
            await this.downloadAsync(url, jarPath, name, true, eventName);
          } else if (library.downloads && library.downloads.artifact && library.downloads.artifact.url) {
            await this.downloadAsync(library.downloads.artifact.url, jarPath, name, true, eventName);
          }
        };

        if (!fs.existsSync(target)) {
          await downloadLibrary();
        }

        if (library.downloads && library.downloads.artifact && library.downloads.artifact.sha1) {
          const valid = await this.checkSum(library.downloads.artifact.sha1, target);
          if (!valid) await downloadLibrary();
        }

        completed += 1;
        this.client.emit('progress', { type: eventName, task: completed, total });
        libs.push(target);
      });

      return libs;
    } catch {
      return originalDownloadToDirectory.apply(this, arguments);
    }
  };

  MCLCHandler.prototype.getAssets = async function patchedGetAssets() {
    try {
      const assetDirectory = path.resolve(this.options.overrides.assetRoot || path.join(this.options.root, 'assets'));
      const assetId = this.options.version.custom || this.options.version.number;
      const assetIndexPath = path.join(assetDirectory, 'indexes', `${assetId}.json`);

      if (!fs.existsSync(assetIndexPath)) {
        await this.downloadAsync(this.version.assetIndex.url, path.join(assetDirectory, 'indexes'), `${assetId}.json`, true, 'asset-json');
      }

      const index = JSON.parse(fs.readFileSync(assetIndexPath, { encoding: 'utf8' }));
      const assets = Object.keys(index.objects || {});
      const total = assets.length;
      let completed = 0;

      this.client.emit('progress', { type: 'assets', task: 0, total });

      await runWithConcurrency(assets, MCLC_ASSET_CONCURRENCY, async (assetKey) => {
        const hash = index.objects[assetKey].hash;
        const subhash = hash.substring(0, 2);
        const subAsset = path.join(assetDirectory, 'objects', subhash);
        const target = path.join(subAsset, hash);

        if (!fs.existsSync(target) || !await this.checkSum(hash, target)) {
          await this.downloadAsync(`${this.options.overrides.url.resource}/${subhash}/${hash}`, subAsset, hash, true, 'assets');
        }

        completed += 1;
        this.client.emit('progress', { type: 'assets', task: completed, total });
      });

      if (this.isLegacy()) {
        const legacyDirectory = path.join(this.options.root, 'resources');
        this.client.emit('debug', `[MCLC]: Copying assets over to ${legacyDirectory}`);
        this.client.emit('progress', { type: 'assets-copy', task: 0, total });

        let copied = 0;
        await runWithConcurrency(assets, MCLC_ASSET_CONCURRENCY, async (assetKey) => {
          const hash = index.objects[assetKey].hash;
          const subhash = hash.substring(0, 2);
          const source = path.join(assetDirectory, 'objects', subhash, hash);
          const target = path.join(legacyDirectory, assetKey);
          const targetDir = path.dirname(target);

          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          if (!fs.existsSync(target)) fs.copyFileSync(source, target);

          copied += 1;
          this.client.emit('progress', { type: 'assets-copy', task: copied, total });
        });
      }

      this.client.emit('debug', '[MCLC]: Downloaded assets');
    } catch {
      // fallback al flujo original por compatibilidad
      return originalGetAssets.apply(this, arguments);
    }
  };

  MCLCHandler.prototype.__xenoAssetPatch = true;
}

patchMclcAssetDownload();

function appendFocusLog(message) {
  if (!app.isReady()) return;
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const logPath = path.join(app.getPath('userData'), 'focus-debug.log');
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // Sin romper nada si el log falla
  }
}

function attachWindowDiagnostics(win) {
  win.on('focus', () => appendFocusLog('WIN_FOCUS'));
  win.on('blur', () => appendFocusLog('WIN_BLUR'));
  if (win.webContents) {
    win.webContents.on('focus', () => appendFocusLog('WC_FOCUS'));
    win.webContents.on('blur', () => appendFocusLog('WC_BLUR'));
  }
}

function fetchJson(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': HTTP_USER_AGENT, Accept: 'application/json,*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          fetchJson(nextUrl, redirects - 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': HTTP_USER_AGENT, Accept: '*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          fetchText(nextUrl, redirects - 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function parseIndexDirs(html) {
  const dirs = [];
  const regex = /href="([^"/]+)\/"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const name = match[1];
    if (name && name !== 'Parent Directory') dirs.push(name);
  }
  return dirs;
}

function parseMavenMetadataVersions(xml) {
  const versions = [];
  const regex = /<version>([^<]+)<\/version>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    versions.push(match[1]);
  }
  return versions;
}

async function fetchMavenVersions(baseUrl) {
  const xml = await fetchText(`${baseUrl}maven-metadata.xml`);
  return parseMavenMetadataVersions(xml);
}

function parseSemverLike(v) {
  const [base, tag] = String(v).split('-', 2);
  const nums = base.split('.').map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
  return { nums, tag: tag || '' };
}

function compareSemverLike(a, b) {
  const pa = parseSemverLike(a);
  const pb = parseSemverLike(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const av = pa.nums[i] || 0;
    const bv = pb.nums[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  if (pa.tag === pb.tag) return 0;
  if (!pa.tag) return 1;
  if (!pb.tag) return -1;
  return pa.tag.localeCompare(pb.tag);
}

function sanitizeFileName(name) {
  const base = String(name || '').trim() || 'update.exe';
  return base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
}

function extractGithubRepo(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (short) return `${short[1]}/${short[2]}`;

  const full = raw.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (!full) return '';
  return `${full[1]}/${full[2]}`;
}

let cachedPackageRepo = null;
function getPackageGithubRepo() {
  if (cachedPackageRepo !== null) return cachedPackageRepo;
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const publish = Array.isArray(pkg && pkg.build && pkg.build.publish)
      ? pkg.build.publish
      : (pkg && pkg.build && pkg.build.publish ? [pkg.build.publish] : []);

    for (const entry of publish) {
      if (!entry || entry.provider !== 'github') continue;
      const owner = String(entry.owner || '').trim();
      const repo = String(entry.repo || '').trim();
      if (owner && repo) {
        cachedPackageRepo = `${owner}/${repo}`;
        return cachedPackageRepo;
      }
    }

    const repoField = typeof pkg.repository === 'string'
      ? pkg.repository
      : (pkg.repository && pkg.repository.url) ? pkg.repository.url : '';
    cachedPackageRepo = extractGithubRepo(repoField);
    return cachedPackageRepo;
  } catch {
    cachedPackageRepo = '';
    return '';
  }
}

function normalizeVersion(version) {
  return String(version || '0.0.0').trim().replace(/^v/i, '');
}

function compareAppVersions(a, b) {
  const left = normalizeVersion(a).match(/\d+/g) || [];
  const right = normalizeVersion(b).match(/\d+/g) || [];
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const lv = Number.parseInt(left[i] || '0', 10);
    const rv = Number.parseInt(right[i] || '0', 10);
    if (lv > rv) return 1;
    if (lv < rv) return -1;
  }
  return 0;
}

function resolveUpdateRepo() {
  const explicit = extractGithubRepo(UPDATE_REPO_OVERRIDE);
  if (explicit) return explicit;
  return getPackageGithubRepo();
}

function getUpdateSourceLabel() {
  if (UPDATE_MANIFEST_URL) return UPDATE_MANIFEST_URL;
  const repo = resolveUpdateRepo();
  return repo ? `github:${repo}` : '';
}

function normalizeReleaseAssets(assets) {
  if (!Array.isArray(assets)) return [];
  return assets
    .map((item) => {
      const name = String(item && item.name ? item.name : '').trim();
      const url = String(item && (item.browser_download_url || item.url) ? (item.browser_download_url || item.url) : '').trim();
      if (!name || !url) return null;
      return {
        name,
        url,
        size: Number(item && item.size ? item.size : 0) || 0
      };
    })
    .filter(Boolean);
}

function buildReleaseAssetsMarker(assets) {
  const normalized = normalizeReleaseAssets(assets);
  if (normalized.length === 0) return 'no-assets';
  const raw = normalized
    .map((item) => `${item.name}|${item.size}|${item.url}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function isReleaseApproved(payload) {
  if (!UPDATE_APPROVAL_TOKEN) return true;
  const token = UPDATE_APPROVAL_TOKEN.toLowerCase();
  const values = [
    payload && payload.approvalToken,
    payload && payload.updateApproval,
    payload && payload.rolloutToken,
    payload && payload.rollout,
    payload && payload.releaseChannel,
    payload && payload.name,
    payload && payload.tag,
    payload && payload.tag_name,
    payload && payload.body
  ];
  return values.some((value) => String(value || '').toLowerCase().includes(token));
}

function selectAsarUpdateAsset(assets) {
  const list = normalizeReleaseAssets(assets).filter((item) => /\.asar$/i.test(item.name));
  if (list.length === 0) return null;

  const score = (name) => {
    let value = 0;
    if (/xeno/i.test(name)) value += 3;
    if (/app/i.test(name)) value += 2;
    if (/update|patch/i.test(name)) value += 1;
    if (/portable|setup|installer/i.test(name)) value -= 4;
    return value;
  };

  list.sort((a, b) => {
    const byScore = score(b.name) - score(a.name);
    if (byScore !== 0) return byScore;
    return (b.size || 0) - (a.size || 0);
  });
  return list[0];
}

function selectWindowsSetupAsset(assets) {
  const list = normalizeReleaseAssets(assets).filter((item) => /\.(exe|msi)$/i.test(item.name));
  if (list.length === 0) return null;

  const score = (name) => {
    let value = 0;
    if (/setup|installer/i.test(name)) value += 5;
    if (/xeno/i.test(name)) value += 2;
    if (/portable/i.test(name)) value -= 2;
    if (/\.exe$/i.test(name)) value += 2;
    if (/\.msi$/i.test(name)) value += 1;
    return value;
  };

  list.sort((a, b) => score(b.name) - score(a.name));
  return list[0];
}

function selectWindowsPortableAsset(assets) {
  const allExe = normalizeReleaseAssets(assets).filter((item) => /\.exe$/i.test(item.name));
  if (allExe.length === 0) return null;

  const setupLike = allExe.filter((item) => /setup|installer/i.test(item.name));
  let list = allExe.filter((item) => /portable/i.test(item.name));

  if (list.length === 0) {
    const nonSetup = allExe.filter((item) => !/setup|installer/i.test(item.name));
    if (nonSetup.length === 1) return nonSetup[0];
    if (nonSetup.length > 1) list = nonSetup;
  }

  if (list.length === 0 && setupLike.length > 0 && allExe.length > setupLike.length) {
    list = allExe.filter((item) => !setupLike.includes(item));
  }

  if (list.length === 0) return null;

  const score = (name) => {
    let value = 0;
    if (/portable/i.test(name)) value += 8;
    if (/xeno/i.test(name)) value += 2;
    if (/setup|installer/i.test(name)) value -= 5;
    if (/\.exe$/i.test(name)) value += 1;
    return value;
  };

  list.sort((a, b) => {
    const byScore = score(b.name) - score(a.name);
    if (byScore !== 0) return byScore;
    return (b.size || 0) - (a.size || 0);
  });
  return list[0];
}

function isPortableRuntime() {
  if (process.platform !== 'win32') return false;
  const envHint = String(
    process.env.PORTABLE_EXECUTABLE_FILE
    || process.env.PORTABLE_EXECUTABLE_DIR
    || ''
  ).trim();
  if (envHint) return true;
  try {
    const exeName = path.basename(app.getPath('exe') || '').toLowerCase();
    return exeName.includes('portable');
  } catch {
    return false;
  }
}

function getWindowsUpdateMode() {
  return isPortableRuntime() ? 'portable' : 'setup';
}

function hasDirectoryWriteAccess(dirPath) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnDetached(command, args = []) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function launchInstaller(installerPath) {
  const ext = path.extname(String(installerPath || '')).toLowerCase();
  if (ext === '.msi') {
    return spawnDetached('msiexec', ['/i', installerPath, '/passive']);
  }

  return (
    spawnDetached(installerPath, ['/S']) ||
    spawnDetached(installerPath, ['/SILENT']) ||
    spawnDetached(installerPath, ['/silent']) ||
    spawnDetached(installerPath, [])
  );
}

function psQuote(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function launchPortableSelfUpdater(downloadedExePath) {
  try {
    const src = path.resolve(String(downloadedExePath || '').trim());
    const dst = path.resolve(app.getPath('exe'));
    if (!src || !dst || src.toLowerCase() === dst.toLowerCase()) return false;

    const script = [
      `$src=${psQuote(src)}`,
      `$dst=${psQuote(dst)}`,
      '$ok=$false',
      'for($i=0;$i -lt 120;$i++){',
      '  try {',
      '    Copy-Item -LiteralPath $src -Destination $dst -Force',
      '    $ok=$true',
      '    break',
      '  } catch {',
      '    Start-Sleep -Milliseconds 500',
      '  }',
      '}',
      'if($ok){',
      '  Start-Sleep -Milliseconds 250',
      '  Start-Process -FilePath $dst | Out-Null',
      '}'
    ].join(';');

    return spawnDetached('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-Command',
      script
    ]);
  } catch {
    return false;
  }
}

function getCurrentAppAsarPath() {
  try {
    const resources = process.resourcesPath ? String(process.resourcesPath) : '';
    if (!resources) return '';
    return path.join(resources, 'app.asar');
  } catch {
    return '';
  }
}

function launchAsarSelfUpdater(downloadedAsarPath) {
  try {
    const src = path.resolve(String(downloadedAsarPath || '').trim());
    const dst = path.resolve(getCurrentAppAsarPath());
    const exe = path.resolve(app.getPath('exe'));
    if (!src || !dst || !exe || src.toLowerCase() === dst.toLowerCase()) return false;
    const backup = `${dst}.bak`;

    const script = [
      `$src=${psQuote(src)}`,
      `$dst=${psQuote(dst)}`,
      `$bak=${psQuote(backup)}`,
      `$exe=${psQuote(exe)}`,
      '$ok=$false',
      'for($i=0;$i -lt 120;$i++){',
      '  try {',
      '    if(Test-Path -LiteralPath $bak){ Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue }',
      '    if(Test-Path -LiteralPath $dst){ Move-Item -LiteralPath $dst -Destination $bak -Force }',
      '    Copy-Item -LiteralPath $src -Destination $dst -Force',
      '    $ok=$true',
      '    break',
      '  } catch {',
      '    Start-Sleep -Milliseconds 500',
      '  }',
      '}',
      'if(-not $ok -and (Test-Path -LiteralPath $bak) -and -not (Test-Path -LiteralPath $dst)){',
      '  Move-Item -LiteralPath $bak -Destination $dst -Force',
      '}',
      'if($ok){',
      '  Start-Sleep -Milliseconds 250',
      '  Start-Process -FilePath $exe | Out-Null',
      '}'
    ].join(';');

    return spawnDetached('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-Command',
      script
    ]);
  } catch {
    return false;
  }
}

async function fetchLatestReleaseInfo() {
  if (UPDATE_MANIFEST_URL) {
    const manifest = await requestJsonWithMethod(
      'GET',
      UPDATE_MANIFEST_URL,
      null,
      { Accept: 'application/json,*/*' },
      2,
      UPDATE_CHECK_TIMEOUT_MS
    );

    const version = normalizeVersion(
      manifest.version || manifest.latestVersion || manifest.tag || manifest.tagName || ''
    );
    const assets = normalizeReleaseAssets(manifest.assets || []);
    const markerFromManifest = String(
      manifest.updateMarker
      || manifest.buildId
      || manifest.releaseId
      || manifest.marker
      || ''
    ).trim();
    const marker = markerFromManifest || `manifest:${version || '0.0.0'}:${buildReleaseAssetsMarker(assets)}`;
    const approved = manifest && manifest.approved === true
      ? true
      : isReleaseApproved(manifest);
    return {
      version,
      assets,
      marker,
      approved,
      htmlUrl: String(manifest.url || manifest.releaseUrl || '').trim(),
      source: 'manifest'
    };
  }

  const repo = resolveUpdateRepo();
  if (!repo) return null;
  let data = null;
  if (UPDATE_INCLUDE_PRERELEASE) {
    const releases = await requestJsonWithMethod(
      'GET',
      `https://api.github.com/repos/${repo}/releases?per_page=20`,
      null,
      { Accept: 'application/vnd.github+json' },
      2,
      UPDATE_CHECK_TIMEOUT_MS
    );
    if (Array.isArray(releases)) {
      data = releases.find((item) => item && item.draft !== true) || null;
    }
  } else {
    data = await requestJsonWithMethod(
      'GET',
      `https://api.github.com/repos/${repo}/releases/latest`,
      null,
      { Accept: 'application/vnd.github+json' },
      2,
      UPDATE_CHECK_TIMEOUT_MS
    );
  }

  if (!data || typeof data !== 'object') return null;

  const version = normalizeVersion(data.tag_name || data.name || '');
  const assets = normalizeReleaseAssets(data.assets || []);
  const marker = `github:${String(data.id || data.tag_name || version || 'latest')}:${buildReleaseAssetsMarker(assets)}`;
  const approved = isReleaseApproved(data);
  return {
    version,
    assets,
    marker,
    approved,
    htmlUrl: String(data.html_url || '').trim(),
    source: `github:${repo}`
  };
}

async function checkAndInstallLauncherUpdate(reportStatus) {
  const send = typeof reportStatus === 'function' ? reportStatus : () => {};
  send({
    text: 'Buscando actualizaciones del launcher...',
    phase: 'checking',
    progress: null,
    indeterminate: true,
    showProgress: true
  });

  const updateSource = getUpdateSourceLabel();
  if (!updateSource) {
    appendFocusLog('UPDATE Source not configured');
    send({ text: 'Iniciando launcher...', showProgress: false, progress: null, indeterminate: false });
    return { skipped: true };
  }

  if (!app.isPackaged) {
    appendFocusLog(`UPDATE Skipped (dev mode) source=${updateSource}`);
    send({ text: 'Modo desarrollo detectado. Continuando...', showProgress: false, progress: null, indeterminate: false });
    return { skipped: true };
  }

  let latest = null;
  try {
    latest = await fetchLatestReleaseInfo();
  } catch (err) {
    appendFocusLog(`UPDATE Check failed: ${String(err)}`);
    send({
      text: 'No se pudo verificar actualizaciones del launcher. Continuando...',
      phase: 'error',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { skipped: true, error: String(err) };
  }

  if (!latest || (!latest.version && !latest.marker)) {
    appendFocusLog('UPDATE No release information');
    send({ text: 'No hay actualizaciones del launcher.', phase: 'up-to-date', progress: 100, indeterminate: false });
    return { skipped: true };
  }

  const current = normalizeVersion(app.getVersion());
  const latestVersion = normalizeVersion(latest.version || current);
  const hasVersionUpdate = compareAppVersions(latestVersion, current) > 0;
  const latestMarker = String(latest.marker || '').trim();
  const appliedMarker = String(store.get('lastAppliedUpdateMarker', '') || '').trim();
  const hasMarkerUpdate = !!latestMarker && latestMarker !== appliedMarker;

  if (!hasVersionUpdate && !hasMarkerUpdate) {
    appendFocusLog(`UPDATE Up to date (${current})`);
    send({ text: 'Launcher actualizado.', phase: 'up-to-date', progress: 100, indeterminate: false });
    return { upToDate: true };
  }

  if (hasVersionUpdate) {
    appendFocusLog(`UPDATE Found new version ${latestVersion} (current ${current})`);
  } else {
    appendFocusLog(`UPDATE Found same-version build marker change: ${appliedMarker || '<none>'} -> ${latestMarker}`);
  }

  const approvedForPublic = latest.approved === true;
  if (UPDATE_REQUIRE_APPROVAL && !approvedForPublic && !UPDATE_ALLOW_UNAPPROVED) {
    appendFocusLog('UPDATE Blocked by rollout approval token');
    send({
      text: 'Nueva build detectada, pero aun no fue aprobada para usuarios.',
      phase: 'up-to-date',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { blocked: true, reason: 'approval_required', version: latestVersion };
  }
  if (!approvedForPublic && UPDATE_ALLOW_UNAPPROVED) {
    appendFocusLog('UPDATE Unapproved rollout allowed by local override');
  }

  send({
    text: hasVersionUpdate
      ? `Nueva version del launcher ${latestVersion} encontrada...`
      : 'Nueva compilacion del launcher encontrada...',
    phase: 'downloading',
    progress: 0,
    indeterminate: false,
    showProgress: true
  });

  if (process.platform !== 'win32') {
    send({
      text: 'Actualizacion del launcher disponible. Instala manualmente.',
      phase: 'manual',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { updateAvailable: true, manual: true, version: latestVersion, url: latest.htmlUrl || null };
  }

  const asarAsset = selectAsarUpdateAsset(latest.assets);
  const currentAsarPath = getCurrentAppAsarPath();
  const canWriteAsar = !!currentAsarPath && hasDirectoryWriteAccess(path.dirname(currentAsarPath));
  if (asarAsset && canWriteAsar) {
    const updatesDir = path.join(app.getPath('userData'), 'updates');
    ensureDir(updatesDir);
    const patchPath = path.join(updatesDir, sanitizeFileName(asarAsset.name));
    appendFocusLog(`UPDATE Asset selected (asar): ${asarAsset.name}`);
    try {
      if (fs.existsSync(patchPath)) fs.unlinkSync(patchPath);
    } catch {
      // ignore
    }

    let lastPercent = -1;
    send({
      text: 'Descargando parche del launcher... 0%',
      phase: 'downloading',
      progress: 0,
      indeterminate: false,
      showProgress: true
    });

    const downloadPromise = downloadFile(asarAsset.url, patchPath, (ratio) => {
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (pct === lastPercent) return;
      if (pct < 100 && pct - lastPercent < 2) return;
      lastPercent = pct;
      send({
        text: `Descargando parche del launcher... ${pct}%`,
        phase: 'downloading',
        progress: pct,
        indeterminate: false,
        showProgress: true
      });
    });

    try {
      await Promise.race([
        downloadPromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout de descarga.')), UPDATE_DOWNLOAD_TIMEOUT_MS);
        })
      ]);
    } catch (err) {
      appendFocusLog(`UPDATE ASAR download failed: ${String(err)}`);
      send({
        text: 'Fallo la descarga del parche del launcher. Continuando...',
        phase: 'error',
        showProgress: false,
        progress: null,
        indeterminate: false
      });
      return { updateAvailable: true, failed: true, error: String(err) };
    }

    try {
      const stat = fs.statSync(patchPath);
      const ext = path.extname(patchPath).toLowerCase();
      if (ext !== '.asar' || stat.size < UPDATE_MIN_ASAR_BYTES) {
        throw new Error('Parche ASAR invalido.');
      }
    } catch (err) {
      appendFocusLog(`UPDATE ASAR validation failed: ${String(err)}`);
      send({
        text: 'El parche del launcher no es valido. Continuando...',
        phase: 'error',
        showProgress: false,
        progress: null,
        indeterminate: false
      });
      return { updateAvailable: true, failed: true, error: String(err) };
    }

    send({
      text: 'Aplicando parche del launcher...',
      phase: 'installing',
      progress: 100,
      indeterminate: true,
      showProgress: true
    });

    const launched = launchAsarSelfUpdater(patchPath);
    if (!launched) {
      appendFocusLog(`UPDATE Could not launch ASAR updater: ${patchPath}`);
      send({
        text: 'No se pudo aplicar el parche del launcher.',
        phase: 'error',
        showProgress: false,
        progress: null,
        indeterminate: false
      });
      return { updateAvailable: true, failed: true, error: 'No se pudo iniciar actualizacion ASAR.' };
    }

    appendFocusLog(`UPDATE ASAR updater launched: ${patchPath}`);
    if (latestMarker) {
      store.set('lastAppliedUpdateMarker', latestMarker);
    }
    send({
      text: 'Parche aplicado. Reiniciando launcher...',
      phase: 'installing',
      progress: 100,
      indeterminate: true,
      showProgress: true
    });
    return { installing: true, version: latestVersion, mode: 'asar' };
  }

  if (asarAsset && !canWriteAsar) {
    appendFocusLog(`UPDATE ASAR asset found but no write access: ${currentAsarPath || '<unknown>'}`);
    if (!UPDATE_ALLOW_BINARY_FALLBACK) {
      send({
        text: 'No hay permisos para aplicar el parche del launcher en esta instalacion.',
        phase: 'manual',
        showProgress: false,
        progress: null,
        indeterminate: false
      });
      return { updateAvailable: true, manual: true, version: latestVersion, url: latest.htmlUrl || null };
    }
  }

  if (!asarAsset && !UPDATE_ALLOW_BINARY_FALLBACK) {
    appendFocusLog('UPDATE Missing ASAR patch asset (binary fallback disabled)');
    send({
      text: 'Release sin parche .asar. Update pausado hasta que publiques parche.',
      phase: 'manual',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { updateAvailable: true, manual: true, version: latestVersion, url: latest.htmlUrl || null };
  }

  const winUpdateMode = getWindowsUpdateMode();
  appendFocusLog(`UPDATE Windows mode=${winUpdateMode}`);

  const selectedAsset = winUpdateMode === 'portable'
    ? selectWindowsPortableAsset(latest.assets)
    : selectWindowsSetupAsset(latest.assets);

  if (!selectedAsset) {
    appendFocusLog(`UPDATE No Windows asset found for mode=${winUpdateMode}`);
    const manualText = winUpdateMode === 'portable'
      ? 'No hay binario portable en la release. Actualiza manualmente.'
      : 'Actualizacion del launcher disponible. Instala manualmente.';
    send({
      text: manualText,
      phase: 'manual',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { updateAvailable: true, manual: true, version: latestVersion, url: latest.htmlUrl || null };
  }

  const selectedExt = path.extname(String(selectedAsset.name || '')).toLowerCase();
  const validAssetForMode = winUpdateMode === 'portable'
    ? selectedExt === '.exe'
    : (selectedExt === '.exe' || selectedExt === '.msi');
  if (!validAssetForMode) {
    appendFocusLog(`UPDATE Invalid asset for mode=${winUpdateMode}: ${selectedAsset.name}`);
    send({
      text: 'La release no tiene un archivo de actualizacion compatible.',
      phase: 'manual',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { updateAvailable: true, manual: true, version: latestVersion, url: latest.htmlUrl || null };
  }

  if (winUpdateMode === 'portable') {
    let currentExeDir = '';
    try {
      currentExeDir = path.dirname(app.getPath('exe'));
    } catch {
      currentExeDir = '';
    }
    if (!currentExeDir || !hasDirectoryWriteAccess(currentExeDir)) {
      appendFocusLog(`UPDATE Portable mode without write access to exe dir: ${currentExeDir || '<unknown>'}`);
      send({
        text: 'No hay permisos para actualizar el portable en esta carpeta. Actualiza manualmente.',
        phase: 'manual',
        showProgress: false,
        progress: null,
        indeterminate: false
      });
      return { updateAvailable: true, manual: true, version: latestVersion, url: latest.htmlUrl || null };
    }
  }

  const updatesDir = path.join(app.getPath('userData'), 'updates');
  ensureDir(updatesDir);
  const installerPath = path.join(updatesDir, sanitizeFileName(selectedAsset.name));
  appendFocusLog(`UPDATE Asset selected (${winUpdateMode}): ${selectedAsset.name}`);
  try {
    if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath);
  } catch {
    // ignore
  }

  let lastPercent = -1;
  send({
    text: 'Descargando actualizacion del launcher... 0%',
    phase: 'downloading',
    progress: 0,
    indeterminate: false,
    showProgress: true
  });

  const downloadPromise = downloadFile(selectedAsset.url, installerPath, (ratio) => {
    const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
    if (pct === lastPercent) return;
    if (pct < 100 && pct - lastPercent < 2) return;
    lastPercent = pct;
    send({
      text: `Descargando actualizacion del launcher... ${pct}%`,
      phase: 'downloading',
      progress: pct,
      indeterminate: false,
      showProgress: true
    });
  });

  try {
    await Promise.race([
      downloadPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout de descarga.')), UPDATE_DOWNLOAD_TIMEOUT_MS);
      })
    ]);
  } catch (err) {
    appendFocusLog(`UPDATE Download failed: ${String(err)}`);
    send({
      text: 'Fallo la descarga de actualizacion del launcher. Continuando...',
      phase: 'error',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { updateAvailable: true, failed: true, error: String(err) };
  }

  try {
    const stat = fs.statSync(installerPath);
    const ext = path.extname(installerPath).toLowerCase();
    const isValidExt = winUpdateMode === 'portable'
      ? ext === '.exe'
      : (ext === '.exe' || ext === '.msi');
    if (!isValidExt || stat.size < 1024 * 1024) {
      throw new Error('Instalador descargado invalido.');
    }
  } catch (err) {
    appendFocusLog(`UPDATE Downloaded installer validation failed: ${String(err)}`);
    send({
      text: 'La actualizacion descargada no es valida. Continuando...',
      phase: 'error',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { updateAvailable: true, failed: true, error: String(err) };
  }

  send({
    text: winUpdateMode === 'portable'
      ? 'Aplicando actualizacion portable...'
      : 'Instalando actualizacion del launcher...',
    phase: 'installing',
    progress: 100,
    indeterminate: true,
    showProgress: true
  });
  const launched = winUpdateMode === 'portable'
    ? launchPortableSelfUpdater(installerPath)
    : launchInstaller(installerPath);
  if (!launched) {
    appendFocusLog(`UPDATE Could not launch installer ${installerPath}`);
    send({
      text: 'No se pudo iniciar el instalador.',
      phase: 'error',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    return { updateAvailable: true, failed: true, error: 'No se pudo iniciar el instalador.' };
  }

  appendFocusLog(`UPDATE Installer launched: ${installerPath}`);
  if (latestMarker) {
    store.set('lastAppliedUpdateMarker', latestMarker);
  }
  send({
    text: winUpdateMode === 'portable'
      ? 'Actualizacion portable lista. Reiniciando...'
      : 'Actualizacion del launcher lista. Reiniciando...',
    phase: 'installing',
    progress: 100,
    indeterminate: true,
    showProgress: true
  });
  return { installing: true, version: latestVersion, mode: winUpdateMode };
}

function extractForgeMcVersions(promos) {
  const keys = Object.keys(promos || {});
  const set = new Set();
  for (const key of keys) {
    const mc = key.split('-')[0];
    if (mc) set.add(mc);
  }
  return Array.from(set).sort(compareMcVersionsDesc);
}

function mapNeoForgeToMc(version) {
  const base = String(version).split('-')[0];
  const parts = base.split('.');
  if (parts.length < 2) return null;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  if (major < 20) return null;
  return minor === 0 ? `1.${major}` : `1.${major}.${minor}`;
}

async function fetchForgeMcVersions() {
  const promos = await fetchJson(FORGE_PROMOS_URL);
  const data = promos && promos.promos ? promos.promos : {};
  return extractForgeMcVersions(data);
}

async function fetchFabricMcVersions() {
  const data = await fetchJson(FABRIC_META_GAME_URL);
  if (!Array.isArray(data)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of data) {
    if (!entry || !entry.version) continue;
    if (entry.stable !== true) continue;
    const v = String(entry.version);
    if (seen.has(v)) continue;
    seen.add(v);
    result.push(v);
  }
  return result;
}

async function fetchSnapshotMcVersions() {
  const manifest = await fetchJson(MANIFEST_URL);
  const list = Array.isArray(manifest.versions)
    ? manifest.versions.filter(v => v.type === 'snapshot').map(v => v.id)
    : [];
  return list;
}

async function fetchNeoForgeMcVersions() {
  const set = new Set();
  const bases = [NEOFORGE_MAVEN_BASE, NEOFORGE_FORGE_BASE];
  for (const base of bases) {
    try {
      const versions = await fetchMavenVersions(base);
      versions.forEach((v) => {
        const mc = mapNeoForgeToMc(v);
        if (mc) set.add(mc);
      });
    } catch {
      // ignore
    }
  }
  if (set.size === 0) {
    for (const base of bases) {
      try {
        const html = await fetchText(base);
        const dirs = parseIndexDirs(html);
        dirs.forEach((v) => {
          const mc = mapNeoForgeToMc(v);
          if (mc) set.add(mc);
        });
      } catch {
        // ignore
      }
    }
  }
  return Array.from(set).sort(compareMcVersionsDesc);
}

function downloadFile(url, dest, onProgress, redirects = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': HTTP_USER_AGENT, Accept: '*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadFile(nextUrl, dest, onProgress, redirects - 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          done += chunk.length;
          if (total > 0 && onProgress) onProgress(done / total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          try { fs.unlinkSync(dest); } catch {}
          reject(err);
        });
      })
      .on('error', reject);
  });
}

function getInstances() {
  const list = store.get('instances', []);
  return list.map(i => ({
    ...i,
    installed: !!i.installed,
    installedAt: i.installedAt || null
  }));
}

function setInstances(list) {
  const normalized = list.map(i => ({
    ...i,
    installed: !!i.installed,
    installedAt: i.installedAt || null
  }));
  store.set('instances', normalized);
}

function parseVersionParts(v) {
  return String(v)
    .split('.')
    .map(n => parseInt(n, 10))
    .filter(n => Number.isFinite(n));
}

function compareMcVersionsDesc(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return -1;
    if (av < bv) return 1;
  }
  return 0;
}

function isAtLeast(version, target) {
  const a = parseVersionParts(version);
  const b = parseVersionParts(target);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}

function normalizeAddonSelection(addons) {
  const src = addons && typeof addons === 'object' ? addons : {};
  return {
    optifine: !!src.optifine,
    sodium: !!src.sodium
  };
}

function sanitizeAddonFileName(name, fallbackName) {
  return sanitizeFileName(String(name || '').trim() || fallbackName);
}

function decodeUrlFileName(url, fallbackName) {
  try {
    const pathname = new URL(url).pathname || '';
    const raw = pathname.split('/').filter(Boolean).pop() || '';
    return sanitizeAddonFileName(decodeURIComponent(raw), fallbackName);
  } catch {
    return sanitizeAddonFileName('', fallbackName);
  }
}

function scoreOptiFineCandidate(entry) {
  const patch = String(entry && entry.patch ? entry.patch : '').trim();
  const filename = String(entry && entry.filename ? entry.filename : '').trim().toLowerCase();
  const preMatch = /^pre(\d+)$/i.exec(patch);
  const stableWeight = preMatch ? 0 : 1;
  const letterMatch = /^([A-Za-z])/.exec(patch);
  const letterWeight = letterMatch ? letterMatch[1].toUpperCase().charCodeAt(0) : 0;
  const numMatch = /(\d+)$/.exec(patch);
  const numWeight = numMatch ? parseInt(numMatch[1], 10) : 0;
  const previewPenalty = filename.startsWith('preview_') ? -1 : 0;
  const preWeight = preMatch ? parseInt(preMatch[1], 10) : 0;
  return {
    stableWeight,
    letterWeight,
    numWeight,
    previewPenalty,
    preWeight,
    patchLex: patch.toLowerCase()
  };
}

function compareOptiFineCandidates(a, b) {
  const sa = scoreOptiFineCandidate(a);
  const sb = scoreOptiFineCandidate(b);
  if (sa.stableWeight !== sb.stableWeight) return sb.stableWeight - sa.stableWeight;
  if (sa.previewPenalty !== sb.previewPenalty) return sb.previewPenalty - sa.previewPenalty;
  if (sa.letterWeight !== sb.letterWeight) return sb.letterWeight - sa.letterWeight;
  if (sa.numWeight !== sb.numWeight) return sb.numWeight - sa.numWeight;
  if (sa.preWeight !== sb.preWeight) return sb.preWeight - sa.preWeight;
  return sb.patchLex.localeCompare(sa.patchLex);
}

async function fetchOptiFineVersionList() {
  const now = Date.now();
  if (
    addonCache.optifine.list.length > 0
    && now - addonCache.optifine.checkedAt < ADDON_CACHE_TTL_MS
  ) {
    return addonCache.optifine.list;
  }
  const data = await fetchJson(OPTIFINE_VERSION_LIST_URL);
  const list = Array.isArray(data) ? data : [];
  addonCache.optifine = { checkedAt: now, list };
  return list;
}

async function resolveOptiFineArtifact(mcVersion) {
  const list = await fetchOptiFineVersionList();
  const candidates = list
    .filter((entry) => entry && String(entry.mcversion || '').trim() === String(mcVersion || '').trim())
    .filter((entry) => entry.type && entry.patch);
  if (candidates.length === 0) return null;

  candidates.sort(compareOptiFineCandidates);
  const chosen = candidates[0];
  const safeVersion = encodeURIComponent(String(chosen.mcversion).trim());
  const safeType = encodeURIComponent(String(chosen.type).trim());
  const safePatch = encodeURIComponent(String(chosen.patch).trim());
  const url = `${OPTIFINE_DOWNLOAD_BASE_URL}/${safeVersion}/${safeType}/${safePatch}`;
  const fallbackName = `OptiFine_${chosen.mcversion}_${chosen.type}_${chosen.patch}.jar`;
  const fileName = sanitizeAddonFileName(chosen.filename, fallbackName);
  return {
    url,
    fileName,
    title: `OptiFine ${chosen.type} ${chosen.patch}`
  };
}

async function resolveSodiumArtifact(mcVersion) {
  const key = String(mcVersion || '').trim();
  if (!key) return null;

  const cached = addonCache.sodium.get(key);
  if (cached && Date.now() - cached.checkedAt < ADDON_CACHE_TTL_MS) {
    return cached.artifact;
  }

  const params = new URLSearchParams({
    loaders: JSON.stringify(['fabric']),
    game_versions: JSON.stringify([key])
  });
  const url = `${MODRINTH_API_BASE_URL}/project/${MODRINTH_SODIUM_PROJECT_ID}/version?${params.toString()}`;
  const data = await fetchJson(url);
  const versions = Array.isArray(data) ? data : [];
  if (versions.length === 0) {
    addonCache.sodium.set(key, { checkedAt: Date.now(), artifact: null });
    return null;
  }

  const selectedVersion = versions.find((v) => v && v.version_type === 'release') || versions[0];
  const file = (selectedVersion.files || []).find((f) => f && f.primary) || (selectedVersion.files || [])[0];
  if (!file || !file.url) {
    addonCache.sodium.set(key, { checkedAt: Date.now(), artifact: null });
    return null;
  }

  const fileName = sanitizeAddonFileName(
    file.filename,
    decodeUrlFileName(file.url, `sodium-fabric-${key}.jar`)
  );
  const artifact = {
    url: String(file.url).trim(),
    fileName,
    title: `Sodium ${selectedVersion.version_number || key}`
  };
  addonCache.sodium.set(key, { checkedAt: Date.now(), artifact });
  return artifact;
}

function isAddonCompatibleWithLoader(addonKey, loader) {
  if (addonKey === 'optifine') return loader === 'Forge';
  if (addonKey === 'sodium') return loader === 'Fabric';
  return false;
}

async function installOptionalAddons(event, inst, root, progressStart = 0, progressWeight = 0) {
  const selection = normalizeAddonSelection(inst.addons);
  inst.addons = selection;

  const requested = [];
  if (selection.optifine) requested.push({ key: 'optifine', label: 'OptiFine' });
  if (selection.sodium) requested.push({ key: 'sodium', label: 'Sodium' });
  if (requested.length === 0 || progressWeight <= 0) return [];

  const loader = String(inst.loader || 'Vanilla');
  const compatible = [];
  const warnings = [];
  for (const addon of requested) {
    if (isAddonCompatibleWithLoader(addon.key, loader)) {
      compatible.push(addon);
    } else {
      warnings.push(`${addon.label} requiere ${addon.key === 'optifine' ? 'Forge' : 'Fabric'}.`);
    }
  }
  if (compatible.length === 0) return warnings;

  const modsDir = path.join(root, 'mods');
  ensureDir(modsDir);
  const taskWeight = progressWeight / compatible.length;
  let doneWeight = 0;

  for (const addon of compatible) {
    const taskStart = progressStart + doneWeight;
    const taskEnd = progressStart + doneWeight + taskWeight;
    const stagePrefix = `Instalando ${addon.label}...`;
    let taskSucceeded = false;
    event.sender.send('install-progress', {
      id: inst.id,
      progress: Math.floor(taskStart),
      stage: stagePrefix
    });

    try {
      let artifact = null;
      if (addon.key === 'optifine') artifact = await resolveOptiFineArtifact(inst.version);
      if (addon.key === 'sodium') artifact = await resolveSodiumArtifact(inst.version);
      if (!artifact || !artifact.url) {
        warnings.push(`${addon.label} no disponible para ${inst.version}.`);
        doneWeight += taskWeight;
        event.sender.send('install-progress', {
          id: inst.id,
          progress: Math.floor(taskEnd),
          stage: `${addon.label} no disponible, continuando...`
        });
        continue;
      }

      const target = path.join(modsDir, sanitizeAddonFileName(artifact.fileName, `${addon.key}-${inst.version}.jar`));
      if (!fs.existsSync(target)) {
        await downloadFile(artifact.url, target, (ratio) => {
          const clamped = Math.max(0, Math.min(1, ratio || 0));
          const mapped = taskStart + (taskWeight * clamped);
          event.sender.send('install-progress', {
            id: inst.id,
            progress: Math.floor(mapped),
            stage: stagePrefix
          });
        });
      }

      inst.addonsInstalled = inst.addonsInstalled && typeof inst.addonsInstalled === 'object'
        ? inst.addonsInstalled
        : {};
      inst.addonsInstalled[addon.key] = {
        file: path.basename(target),
        title: artifact.title || addon.label,
        at: Date.now()
      };
      taskSucceeded = true;
    } catch (err) {
      warnings.push(`${addon.label} no se pudo instalar: ${String(err)}`);
    } finally {
      doneWeight += taskWeight;
      event.sender.send('install-progress', {
        id: inst.id,
        progress: Math.floor(taskEnd),
        stage: taskSucceeded ? `${addon.label} listo.` : `${addon.label} omitido.`
      });
    }
  }

  return warnings;
}

function requiredJavaMajor(version) {
  if (isAtLeast(version, '1.20.5')) return 21;
  if (isAtLeast(version, '1.18')) return 17;
  if (isAtLeast(version, '1.17')) return 16;
  return 8;
}

function maxJavaMajor(version) {
  if (!isAtLeast(version, '1.17')) return 8;
  if (isAtLeast(version, '1.17') && !isAtLeast(version, '1.18')) return 16;
  return null;
}

function resolveVersionType(loader) {
  return loader === 'Snapshots' ? 'snapshot' : 'release';
}

function resolveJavaPath() {
  const saved = store.get('javaPath', '');
  if (saved && fs.existsSync(saved)) return saved;

  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const candidate = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    if (process.platform === 'win32') {
      const out = execSync('where java', { encoding: 'utf8' });
      const first = out.split(/\r?\n/).find(Boolean);
      if (first) return first.trim();
    } else {
      const out = execSync('which java', { encoding: 'utf8' });
      const first = out.split(/\r?\n/).find(Boolean);
      if (first) return first.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

function addCandidate(list, seen, candidate) {
  if (!candidate) return;
  const normalized = path.normalize(candidate);
  if (seen.has(normalized)) return;
  if (!fs.existsSync(normalized)) return;
  seen.add(normalized);
  list.push(normalized);
}

function scanJavaDir(root, list, seen) {
  if (!root || !fs.existsSync(root)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const javaPath = path.join(root, entry.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    addCandidate(list, seen, javaPath);
  }
}

function getJavaCandidates() {
  const list = [];
  const seen = new Set();

  // Prefer saved Java path
  addCandidate(list, seen, store.get('javaPath', ''));

  // JAVA_HOME / JDK_HOME / JRE_HOME
  const envHomes = [process.env.JAVA_HOME, process.env.JDK_HOME, process.env.JRE_HOME].filter(Boolean);
  for (const home of envHomes) {
    addCandidate(list, seen, path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  }

  // From PATH
  try {
    if (process.platform === 'win32') {
      const out = execSync('where java', { encoding: 'utf8' });
      out.split(/\r?\n/).filter(Boolean).forEach(p => addCandidate(list, seen, p.trim()));
    } else {
      const out = execSync('which -a java', { encoding: 'utf8' });
      out.split(/\r?\n/).filter(Boolean).forEach(p => addCandidate(list, seen, p.trim()));
    }
  } catch {
    // ignore
  }

  // Common Windows install locations
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    const roots = [
      path.join(programFiles, 'Java'),
      path.join(programFiles, 'Eclipse Adoptium'),
      path.join(programFiles, 'Adoptium'),
      path.join(programFiles, 'Zulu'),
      path.join(programFiles, 'Azul'),
      path.join(programFiles, 'Amazon Corretto'),
      path.join(programFiles, 'Microsoft', 'Java'),
      path.join(programFiles, 'Microsoft', 'jdk'),
      path.join(programFiles, 'OpenJDK'),
      path.join(programFilesX86, 'Java'),
      path.join(programFilesX86, 'Eclipse Adoptium'),
      path.join(programFilesX86, 'Adoptium'),
      path.join(programFilesX86, 'Zulu'),
      path.join(programFilesX86, 'Azul'),
      path.join(programFilesX86, 'Amazon Corretto'),
      path.join(programFilesX86, 'Microsoft', 'Java'),
      path.join(programFilesX86, 'Microsoft', 'jdk'),
      path.join(programFilesX86, 'OpenJDK'),
      localAppData ? path.join(localAppData, 'Programs', 'Eclipse Adoptium') : null,
      localAppData ? path.join(localAppData, 'Programs', 'Adoptium') : null,
      localAppData ? path.join(localAppData, 'Programs', 'Zulu') : null,
      localAppData ? path.join(localAppData, 'Programs', 'Amazon Corretto') : null
    ].filter(Boolean);
    for (const root of roots) {
      scanJavaDir(root, list, seen);
    }
  }

  return list;
}

async function selectJavaForVersion(mcVersion) {
  const required = requiredJavaMajor(mcVersion);
  const maxAllowed = maxJavaMajor(mcVersion);
  const candidates = getJavaCandidates();
  let best = null;

  for (const candidate of candidates) {
    const info = await checkJava(candidate);
    if (!info.ok || !info.major) continue;
    if (info.major < required) continue;
    if (maxAllowed && info.major > maxAllowed) continue;
    if (!best || info.major < best.major) {
      best = { path: candidate, major: info.major };
    }
  }

  return { path: best ? best.path : null, major: best ? best.major : null, required, maxAllowed };
}

function parseJavaMajor(output) {
  if (!output) return null;
  const m = output.match(/version\s+"([^"]+)"/i);
  if (!m) return null;
  const ver = m[1];
  const parts = ver.split('.');
  if (parts[0] === '1' && parts[1]) return parseInt(parts[1], 10);
  return parseInt(parts[0], 10);
}

function checkJava(javaPath) {
  return new Promise((resolve) => {
    const cmd = javaPath || 'java';
    execFile(cmd, ['-version'], (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, message: err.message || 'Java no disponible' });
        return;
      }
      const output = `${stderr || ''}\n${stdout || ''}`;
      resolve({ ok: true, output, major: parseJavaMajor(output) });
    });
  });
}

function getInstanceRoot(instanceId) {
  return path.join(app.getPath('userData'), 'instances', String(instanceId));
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    return err;
  }
}

function getSkinsDir() {
  return path.join(app.getPath('userData'), 'skins');
}

function getAuthlibInjectorPath() {
  return path.join(app.getPath('userData'), AUTHLIB_INJECTOR_FILE);
}

function sanitizeSkinKey(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, 32);
}

function skinFilePath(username) {
  const key = sanitizeSkinKey(username);
  if (!key) return null;
  return path.join(getSkinsDir(), `${key}.png`);
}

function decodeSkinDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.trim().match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const normalized = match[1].replace(/\s+/g, '');
  if (!normalized) return null;
  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
}

function isValidSkinPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return false;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) return false;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width === 64 && (height === 64 || height === 32);
}

function applySkinForUser(username, skinData, model = 'classic') {
  const normalizedUser = String(username || '').trim();
  if (!normalizedUser) return false;
  const key = sanitizeSkinKey(normalizedUser);
  if (!key) return false;
  const filePath = skinFilePath(username);
  if (!filePath) return false;

  const buffer = decodeSkinDataUrl(skinData);
  if (!buffer || !isValidSkinPng(buffer)) return false;

  const ensured = ensureDir(path.dirname(filePath));
  if (ensured !== true) return false;

  fs.writeFileSync(filePath, buffer);
  skinServer.setSkin(normalizedUser, `data:image/png;base64,${buffer.toString('base64')}`, model);
  return true;
}

function removeSkinForUser(username) {
  const normalizedUser = String(username || '').trim();
  if (!normalizedUser) return;
  const cacheUser = normalizedUser.toLowerCase();
  const key = sanitizeSkinKey(normalizedUser);
  if (!key) return;
  const filePath = skinFilePath(username);
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
  skinServer.removeSkin(cacheUser);
}

function compactUuid(value) {
  return String(value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
}

function formatUuid(value) {
  const compact = compactUuid(value);
  if (compact.length !== 32) return null;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
}

function createRandomUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function getElyClientToken() {
  let token = String(store.get('elyClientToken', '') || '').trim();
  if (!formatUuid(token)) {
    token = createRandomUuid();
    store.set('elyClientToken', token);
  }
  return token;
}

function normalizeProfileData(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const name = String(profile.name || '').trim();
  if (!name) return null;

  const normalized = {
    name,
    authType: profile.authType === 'ely' ? 'ely' : 'offline',
    avatarData: profile.avatarData ? String(profile.avatarData) : null,
    skinData: profile.skinData ? String(profile.skinData) : null,
    skinModel: profile.skinModel === 'slim' ? 'slim' : (profile.skinModel === 'classic' ? 'classic' : null),
    updatedAt: Number(profile.updatedAt) || Date.now()
  };

  if (normalized.authType === 'ely') {
    normalized.uuid = formatUuid(profile.uuid || '');
    normalized.accessToken = String(profile.accessToken || '').trim();
    normalized.clientToken = formatUuid(profile.clientToken || '') || getElyClientToken();
  }

  return normalized;
}

function getStoredProfile() {
  const profile = normalizeProfileData(store.get('profile', null));
  if (!profile) return null;
  return profile;
}

async function ensureSkinServerUrl() {
  const skinsDir = getSkinsDir();
  const ensured = ensureDir(skinsDir);
  if (ensured !== true) throw new Error('No se pudo preparar la carpeta de skins.');

  if (!skinServer.isRunning()) {
    skinServer.startServer(skinsDir);
  } else {
    skinServer.loadSkinsFromDirectory(skinsDir);
  }

  for (let i = 0; i < 80; i += 1) {
    const url = skinServer.getServerUrl();
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('No se pudo iniciar el servidor de skins.');
}

function normalizeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeHttpOrHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.hash = '';
    const text = parsed.toString();
    return text.endsWith('/') ? text.slice(0, -1) : text;
  } catch {
    return null;
  }
}

function getSkinServiceConfig() {
  const storedUrl = normalizeHttpOrHttpsUrl(store.get('skinServiceUrl', ''));
  const envUrl = normalizeHttpOrHttpsUrl(process.env.XENO_SKIN_SERVICE_URL || '');
  const defaultUrl = normalizeHttpOrHttpsUrl(DEFAULT_SHARED_SKIN_SERVICE_URL || '');
  const url = storedUrl || envUrl || defaultUrl;
  if (!url) return null;
  const storedToken = String(store.get('skinServiceToken', '') || '').trim();
  const envToken = String(process.env.XENO_SKIN_SERVICE_TOKEN || '').trim();
  const token = storedToken || envToken || '';
  return { url, token };
}

function requestJsonWithMethod(method, targetUrl, body = null, extraHeaders = {}, redirects = 3, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new Error('URL invalida.'));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    if (!isHttps && parsed.protocol !== 'http:') {
      reject(new Error(`Protocolo no soportado: ${parsed.protocol}`));
      return;
    }

    const transport = isHttps ? https : http;
    const payload = body == null ? null : JSON.stringify(body);
    const headers = {
      'User-Agent': HTTP_USER_AGENT,
      Accept: 'application/json,*/*',
      ...extraHeaders
    };

    if (payload != null) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: String(method || 'GET').toUpperCase(),
        headers
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && redirects > 0) {
          const nextUrl = new URL(location, targetUrl).toString();
          res.resume();
          requestJsonWithMethod(method, nextUrl, body, extraHeaders, redirects - 1, timeoutMs).then(resolve).catch(reject);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8').trim();
          let parsedJson = null;
          if (text) {
            try {
              parsedJson = JSON.parse(text);
            } catch {
              if (status >= 200 && status < 300) {
                resolve({});
                return;
              }
            }
          }

          if (status >= 200 && status < 300) {
            resolve(parsedJson || {});
            return;
          }

          const msg = parsedJson && parsedJson.error
            ? String(parsedJson.error)
            : (text || `HTTP ${status}`);
          reject(new Error(`HTTP ${status}: ${msg}`));
        });
      }
    );

    req.setTimeout(Math.max(300, Number(timeoutMs) || 10000), () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

async function authenticateElyByCredentials(login, password) {
  const username = String(login || '').trim();
  const pwd = String(password || '');
  if (!username || !pwd) {
    throw new Error('Debes ingresar usuario y contrasena de Ely.by.');
  }

  const clientToken = getElyClientToken();
  const payload = {
    username,
    password: pwd,
    clientToken,
    requestUser: true,
    agent: {
      name: 'Minecraft',
      version: 1
    }
  };

  const response = await requestJsonWithMethod(
    'POST',
    `${ELY_AUTH_SERVER_URL}/auth/authenticate`,
    payload,
    { 'Content-Type': 'application/json' },
    2,
    12000
  );

  const selectedProfile = response && response.selectedProfile
    ? response.selectedProfile
    : (Array.isArray(response && response.availableProfiles) ? response.availableProfiles[0] : null);

  const profileName = selectedProfile && selectedProfile.name ? String(selectedProfile.name).trim() : '';
  const profileUuid = formatUuid(selectedProfile && selectedProfile.id ? selectedProfile.id : '');
  const accessToken = String(response && response.accessToken ? response.accessToken : '').trim();
  const responseClientToken = formatUuid(response && response.clientToken ? response.clientToken : '') || clientToken;

  if (!profileName || !profileUuid || !accessToken) {
    throw new Error('Respuesta invalida del servidor Ely.by.');
  }

  store.set('elyClientToken', responseClientToken);
  return {
    name: profileName,
    uuid: profileUuid,
    accessToken,
    clientToken: responseClientToken
  };
}

async function validateElyToken(profile) {
  if (!profile || !profile.accessToken) return false;
  const clientToken = formatUuid(profile.clientToken || '') || getElyClientToken();
  try {
    await requestJsonWithMethod(
      'POST',
      `${ELY_AUTH_SERVER_URL}/auth/validate`,
      {
        accessToken: String(profile.accessToken).trim(),
        clientToken
      },
      { 'Content-Type': 'application/json' },
      1,
      6000
    );
    return true;
  } catch {
    return false;
  }
}

async function refreshElySession(profile) {
  if (!profile || !profile.accessToken) {
    throw new Error('Sesion Ely.by invalida.');
  }
  const clientToken = formatUuid(profile.clientToken || '') || getElyClientToken();
  const requestBody = {
    accessToken: String(profile.accessToken).trim(),
    clientToken,
    requestUser: true
  };

  const selectedUuid = compactUuid(profile.uuid || '');
  const selectedName = String(profile.name || '').trim();
  if (selectedUuid && selectedName) {
    requestBody.selectedProfile = {
      id: selectedUuid,
      name: selectedName
    };
  }

  const response = await requestJsonWithMethod(
    'POST',
    `${ELY_AUTH_SERVER_URL}/auth/refresh`,
    requestBody,
    { 'Content-Type': 'application/json' },
    2,
    12000
  );

  const selectedProfile = response && response.selectedProfile
    ? response.selectedProfile
    : (selectedUuid && selectedName ? { id: selectedUuid, name: selectedName } : null);

  const nextName = selectedProfile && selectedProfile.name
    ? String(selectedProfile.name).trim()
    : selectedName;
  const nextUuid = formatUuid(selectedProfile && selectedProfile.id ? selectedProfile.id : selectedUuid);
  const nextAccessToken = String(response && response.accessToken ? response.accessToken : '').trim();
  const nextClientToken = formatUuid(response && response.clientToken ? response.clientToken : '') || clientToken;

  if (!nextName || !nextUuid || !nextAccessToken) {
    throw new Error('No se pudo refrescar la sesion de Ely.by.');
  }

  store.set('elyClientToken', nextClientToken);
  return {
    ...profile,
    authType: 'ely',
    name: nextName,
    uuid: nextUuid,
    accessToken: nextAccessToken,
    clientToken: nextClientToken,
    updatedAt: Date.now()
  };
}

async function ensureLaunchProfileAuth(profile, fallbackName = 'Offline') {
  const normalized = normalizeProfileData(profile);
  if (!normalized || normalized.authType !== 'ely') {
    const resolvedName = normalized && normalized.name
      ? normalized.name
      : String(fallbackName || 'Offline');
    const auth = buildOfflineAuth(resolvedName);
    return {
      profile: {
        name: auth.name,
        authType: 'offline'
      },
      authType: 'offline',
      authorization: auth
    };
  }

  if (await validateElyToken(normalized)) {
    return {
      profile: normalized,
      authType: 'ely',
      authorization: {
        access_token: normalized.accessToken,
        client_token: normalized.clientToken || getElyClientToken(),
        uuid: normalized.uuid,
        name: normalized.name,
        user_properties: '{}'
      }
    };
  }

  try {
    const refreshed = await refreshElySession(normalized);
    store.set('profile', refreshed);
    return {
      profile: refreshed,
      authType: 'ely',
      authorization: {
        access_token: refreshed.accessToken,
        client_token: refreshed.clientToken || getElyClientToken(),
        uuid: refreshed.uuid,
        name: refreshed.name,
        user_properties: '{}'
      }
    };
  } catch (err) {
    throw new Error(`La sesion Ely.by expiro. Inicia sesion otra vez. Detalle: ${String(err)}`);
  }
}

async function isSharedSkinServiceReachable(config) {
  if (!config || !config.url) return false;
  const now = Date.now();
  if (
    sharedSkinServiceHealthCache.url === config.url &&
    now - sharedSkinServiceHealthCache.checkedAt < 30000
  ) {
    return sharedSkinServiceHealthCache.ok;
  }

  let ok = false;
  try {
    await requestJsonWithMethod('GET', `${config.url}/status`, null, {}, 1, 900);
    ok = true;
  } catch {
    try {
      await requestJsonWithMethod('GET', config.url, null, {}, 1, 900);
      ok = true;
    } catch {
      ok = false;
    }
  }

  sharedSkinServiceHealthCache.url = config.url;
  sharedSkinServiceHealthCache.ok = ok;
  sharedSkinServiceHealthCache.checkedAt = now;
  return ok;
}

function readSkinDataUrlFromDisk(username) {
  const filePath = skinFilePath(username);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const data = fs.readFileSync(filePath);
    if (!isValidSkinPng(data)) return null;
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

async function syncSkinToSharedService(username, skinData, model = 'classic') {
  const config = getSkinServiceConfig();
  if (!config || !config.url) return false;
  const targetUser = String(username || '').trim();
  if (!targetUser) return false;
  const buffer = decodeSkinDataUrl(skinData);
  if (!buffer || !isValidSkinPng(buffer)) return false;

  const headers = {};
  if (config.token) headers['X-Xeno-Token'] = config.token;
  await requestJsonWithMethod('PUT', `${config.url}/xeno/skins/${encodeURIComponent(targetUser)}`, {
    skinData: `data:image/png;base64,${buffer.toString('base64')}`,
    model: model === 'slim' ? 'slim' : 'classic'
  }, headers, 1, 3000);
  return true;
}

async function deleteSkinFromSharedService(username) {
  const config = getSkinServiceConfig();
  if (!config || !config.url) return false;
  const targetUser = String(username || '').trim();
  if (!targetUser) return false;

  const headers = {};
  if (config.token) headers['X-Xeno-Token'] = config.token;
  await requestJsonWithMethod('DELETE', `${config.url}/xeno/skins/${encodeURIComponent(targetUser)}`, null, headers, 1, 3000);
  return true;
}

async function checkSharedUsernameConflict(username) {
  const config = getSkinServiceConfig();
  if (!config || !config.url) {
    return { checked: false, exists: false, serviceUrl: null };
  }

  const targetUser = String(username || '').trim();
  if (!targetUser) {
    return { checked: false, exists: false, serviceUrl: config.url };
  }

  const reachable = await isSharedSkinServiceReachable(config);
  if (!reachable) {
    return { checked: false, exists: false, serviceUrl: config.url, reachable: false };
  }

  try {
    await requestJsonWithMethod(
      'GET',
      `${config.url}/xeno/skins/${encodeURIComponent(targetUser)}`,
      null,
      {},
      1,
      1200
    );
    return { checked: true, exists: true, serviceUrl: config.url, reachable: true };
  } catch (err) {
    const msg = err ? String(err) : '';
    if (msg.includes('HTTP 404')) {
      return { checked: true, exists: false, serviceUrl: config.url, reachable: true };
    }
    return { checked: false, exists: false, serviceUrl: config.url, reachable: true, error: msg };
  }
}

function parseAuthlibVersionFromMetadata(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return null;
  const latest = xmlText.match(/<latest>\s*([^<\s]+)\s*<\/latest>/i);
  if (latest && latest[1]) return latest[1].trim();
  const release = xmlText.match(/<release>\s*([^<\s]+)\s*<\/release>/i);
  if (release && release[1]) return release[1].trim();
  const versions = [...xmlText.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/ig)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

async function resolveAuthlibDownloadUrls() {
  const urls = [];
  const addUrl = (value) => {
    const normalized = normalizeHttpsUrl(value);
    if (!normalized) return;
    if (!urls.includes(normalized)) urls.push(normalized);
  };

  for (const metaUrl of AUTHLIB_INJECTOR_META_URLS) {
    try {
      const meta = await fetchJson(metaUrl);
      if (meta && typeof meta === 'object') {
        addUrl(meta.download_url);
      }
    } catch {
      // ignore
    }
  }

  try {
    const metadataXml = await fetchText(AUTHLIB_INJECTOR_MAVEN_METADATA);
    const version = parseAuthlibVersionFromMetadata(metadataXml);
    if (version) {
      addUrl(`${AUTHLIB_INJECTOR_MAVEN_BASE}/${version}/authlib-injector-${version}.jar`);
    }
  } catch {
    // ignore
  }

  AUTHLIB_INJECTOR_FALLBACK_URLS.forEach(addUrl);
  return urls;
}

async function ensureAuthlibInjectorJar() {
  const target = getAuthlibInjectorPath();
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (stat.size > 1024) {
      appendFocusLog(`SKIN Authlib existente: ${target}`);
      return target;
    }
  }

  const bundled = path.join(__dirname, AUTHLIB_INJECTOR_FILE);
  if (fs.existsSync(bundled)) {
    const stat = fs.statSync(bundled);
    if (stat.size > 1024) {
      ensureDir(path.dirname(target));
      fs.copyFileSync(bundled, target);
      appendFocusLog(`SKIN Authlib copiado desde bundle: ${bundled}`);
      return target;
    }
  }

  const ensured = ensureDir(path.dirname(target));
  if (ensured !== true) throw new Error('No se pudo crear la carpeta para authlib-injector.');

  const temp = `${target}.tmp`;
  let lastErr = null;
  const urls = await resolveAuthlibDownloadUrls();
  if (urls.length === 0) {
    throw new Error('No se encontraron URLs para descargar authlib-injector.');
  }
  const errors = [];

  for (const url of urls) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      await downloadFile(url, temp);
      const stat = fs.statSync(temp);
      if (stat.size <= 1024) throw new Error('Archivo authlib-injector invalido.');
      fs.renameSync(temp, target);
      appendFocusLog(`SKIN Authlib descargado: ${url}`);
      return target;
    } catch (err) {
      lastErr = err;
      errors.push(`${url} -> ${String(err)}`);
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch {
        // ignore
      }
    }
  }

  const details = errors.length > 0 ? `\n${errors.join('\n')}` : '';
  throw new Error(lastErr ? `${String(lastErr)}${details}` : `No se pudo descargar authlib-injector.${details}`);
}

async function attachSkinLaunchArgs(opts, username, authType = 'offline') {
  const targetUser = String(username || '').trim();
  if (!targetUser) return 'disabled';

  if (authType === 'ely') {
    const authlibJar = await ensureAuthlibInjectorJar();
    const arg = `-javaagent:${authlibJar}=${ELY_AUTHLIB_INJECTOR_TARGET}`;
    if (!Array.isArray(opts.customArgs)) opts.customArgs = [];
    if (!opts.customArgs.includes(arg)) opts.customArgs.push(arg);
    appendFocusLog(`SKIN Auth mode=ely url=${ELY_AUTH_SERVER_URL}`);
    return 'ely';
  }

  const profile = getStoredProfile();
  const profileSkin = profile && profile.skinData ? String(profile.skinData) : null;
  const profileModel = profile && profile.skinModel === 'slim' ? 'slim' : 'classic';
  const localSkin = profileSkin || readSkinDataUrlFromDisk(targetUser);
  const sharedConfig = getSkinServiceConfig();

  let authServerUrl = null;
  let skinMode = 'local';

  if (sharedConfig && sharedConfig.url) {
    const sharedReachable = await isSharedSkinServiceReachable(sharedConfig);
    if (sharedReachable) {
      authServerUrl = sharedConfig.url;
      skinMode = 'shared';
    } else {
      appendFocusLog(`SKIN Shared service unavailable: ${sharedConfig.url}`);
    }

    if (localSkin && sharedReachable) {
      try {
        await syncSkinToSharedService(targetUser, localSkin, profileModel);
        appendFocusLog(`SKIN Shared upload ok: ${targetUser}`);
      } catch (err) {
        appendFocusLog(`SKIN Shared upload failed (${targetUser}): ${String(err)}`);
      }
    }
  }

  if (!authServerUrl) {
    if (localSkin) {
      applySkinForUser(targetUser, localSkin, profileModel);
    } else {
      const filePath = skinFilePath(targetUser);
      if (filePath && fs.existsSync(filePath)) {
        try {
          const data = fs.readFileSync(filePath);
          if (isValidSkinPng(data)) {
            skinServer.setSkin(targetUser, `data:image/png;base64,${data.toString('base64')}`);
          }
        } catch {
          // ignore
        }
      }
    }
    authServerUrl = await ensureSkinServerUrl();
  }

  const authlibJar = await ensureAuthlibInjectorJar();
  const arg = `-javaagent:${authlibJar}=${authServerUrl}`;

  if (!Array.isArray(opts.customArgs)) opts.customArgs = [];
  if (!opts.customArgs.includes(arg)) opts.customArgs.push(arg);
  appendFocusLog(`SKIN Auth mode=${skinMode} url=${authServerUrl}`);
  return skinMode;
}

function buildOfflineAuth(username) {
  const rawName = String(username || '').trim() || 'Player';
  const lookupName = rawName.toLowerCase();
  const uuid = skinServer.generateOfflineUUID(lookupName);
  return {
    access_token: uuid,
    client_token: uuid,
    uuid,
    name: rawName,
    user_properties: '{}'
  };
}

function isVersionInstalled(root, version) {
  const versionDir = path.join(root, 'versions', version);
  const jarPath = path.join(versionDir, `${version}.jar`);
  const jsonPath = path.join(versionDir, `${version}.json`);
  return fs.existsSync(jarPath) && fs.existsSync(jsonPath);
}

async function resolveForgeInstaller(mcVersion, storedVersion) {
  let forgeVersion = storedVersion && String(storedVersion).startsWith(`${mcVersion}-`)
    ? String(storedVersion)
    : null;
  if (!forgeVersion) {
    const promos = await fetchJson(FORGE_PROMOS_URL);
    const data = promos && promos.promos ? promos.promos : {};
    const rec = data[`${mcVersion}-recommended`];
    const latest = data[`${mcVersion}-latest`];
    const build = rec || latest;
    if (!build) throw new Error('No hay versiones Forge recomendadas o latest para esta version.');
    forgeVersion = `${mcVersion}-${build}`;
  }
  const useInstaller = isAtLeast(mcVersion, '1.13');
  const suffix = useInstaller ? 'installer' : 'universal';
  const fileName = `forge-${forgeVersion}-${suffix}.jar`;
  const url = `${FORGE_MAVEN_BASE}${forgeVersion}/${fileName}`;
  return { forgeVersion, fileName, url };
}

async function resolveNeoForgeInstaller(mcVersion, storedVersion, storedArtifact, storedBase) {
  if (storedVersion) {
    const artifact = storedArtifact || 'neoforge';
    const baseUrl = storedBase || NEOFORGE_MAVEN_BASE;
    const fileName = `${artifact}-${storedVersion}-installer.jar`;
    const url = `${baseUrl}${storedVersion}/${fileName}`;
    return { neoVersion: storedVersion, fileName, url, artifact, baseUrl };
  }

  let baseUrl = NEOFORGE_MAVEN_BASE;
  let artifact = 'neoforge';
  let versions = [];
  try {
    versions = await fetchMavenVersions(NEOFORGE_MAVEN_BASE);
  } catch {
    versions = [];
  }

  if (versions.length === 0) {
    baseUrl = NEOFORGE_FORGE_BASE;
    artifact = 'forge';
    versions = await fetchMavenVersions(NEOFORGE_FORGE_BASE);
  }

  const candidates = versions.filter(v => mapNeoForgeToMc(v) === mcVersion);
  if (candidates.length === 0) {
    throw new Error('No hay versiones NeoForge para esta version de Minecraft.');
  }
  candidates.sort(compareSemverLike);
  const neoVersion = candidates[candidates.length - 1];
  const fileName = `${artifact}-${neoVersion}-installer.jar`;
  const url = `${baseUrl}${neoVersion}/${fileName}`;
  return { neoVersion, fileName, url, artifact, baseUrl };
}

function stageLabel(type) {
  switch (type) {
    case 'assets':
      return 'Descargando assets...';
    case 'assets-copy':
      return 'Preparando assets...';
    case 'libraries':
      return 'Descargando librerías...';
    case 'classes':
      return 'Descargando clases...';
    case 'classes-custom':
      return 'Descargando clases...';
    case 'classes-maven-custom':
      return 'Descargando clases...';
    case 'natives':
      return 'Extrayendo nativos...';
    default:
      return 'Preparando archivos...';
  }
}

function computeOverallProgress(stages) {
  const weights = {
    assets: 45,
    'assets-copy': 5,
    libraries: 20,
    classes: 15,
    'classes-custom': 15,
    'classes-maven-custom': 10,
    natives: 15
  };
  let totalWeight = 0;
  let doneWeight = 0;
  for (const [type, value] of Object.entries(stages)) {
    const w = weights[type] || 10;
    totalWeight += w;
    doneWeight += w * Math.min(1, Math.max(0, value));
  }
  if (totalWeight === 0) return 0;
  return Math.floor((doneWeight / totalWeight) * 100);
}

function applyLoaderOverrides(opts, loader) {
  if (loader === 'Forge') {
    opts.overrides = {
      ...(opts.overrides || {}),
      url: {
        ...(opts.overrides ? opts.overrides.url : null),
        mavenForge: FORGE_MAVEN_ROOT
      }
    };
  } else if (loader === 'NeoForge') {
    opts.overrides = {
      ...(opts.overrides || {}),
      url: {
        ...(opts.overrides ? opts.overrides.url : null),
        mavenForge: NEOFORGE_MAVEN_ROOT
      }
    };
  }
}

async function runInstallOnly(event, inst, list, options = {}) {
  const loader = String(inst.loader || 'Vanilla');
  if (!['Vanilla', 'Forge', 'NeoForge', 'Fabric', 'Snapshots'].includes(loader)) {
    throw new Error('Este loader no está soportado por ahora.');
  }

  inst.addons = normalizeAddonSelection(inst.addons);

  const javaSelection = await selectJavaForVersion(inst.version);
  if (!javaSelection.path) {
    event.sender.send('java-guide', {
      version: inst.version,
      required: javaSelection.required,
      maxAllowed: javaSelection.maxAllowed
    });
    throw new Error(`No se encontró un Java compatible para Minecraft ${inst.version}.`);
  }
  const javaPath = javaSelection.path;

  const root = getInstanceRoot(inst.id);
  const ensured = ensureDir(root);
  if (ensured !== true) {
    throw new Error(`No se pudo crear la carpeta de la instancia.\nDetalle: ${String(ensured)}`);
  }

  let loaderJar = null;
  let loaderWeight = 0;
  let preInstallWeight = 0;
  let addonWarnings = [];
  try {
    if (loader === 'Forge') {
      const resolved = await resolveForgeInstaller(inst.version, inst.loaderVersion);
      inst.loaderVersion = resolved.forgeVersion;
      const loaderDir = path.join(root, 'loader');
      ensureDir(loaderDir);
      loaderJar = path.join(loaderDir, resolved.fileName);
      if (!fs.existsSync(loaderJar)) {
        loaderWeight = 20;
        event.sender.send('install-progress', { id: inst.id, progress: 0, stage: 'Descargando Forge...' });
        await downloadFile(resolved.url, loaderJar, (ratio) => {
          const pct = Math.floor(Math.max(0, Math.min(1, ratio)) * loaderWeight);
          event.sender.send('install-progress', { id: inst.id, progress: pct, stage: 'Descargando Forge...' });
        });
      }
    } else if (loader === 'NeoForge') {
      const resolved = await resolveNeoForgeInstaller(inst.version, inst.loaderVersion, inst.loaderArtifact, inst.loaderBase);
      inst.loaderVersion = resolved.neoVersion;
      inst.loaderArtifact = resolved.artifact;
      inst.loaderBase = resolved.baseUrl;
      const loaderDir = path.join(root, 'loader');
      ensureDir(loaderDir);
      loaderJar = path.join(loaderDir, resolved.fileName);
      if (!fs.existsSync(loaderJar)) {
        loaderWeight = 20;
        event.sender.send('install-progress', { id: inst.id, progress: 0, stage: 'Descargando NeoForge...' });
        await downloadFile(resolved.url, loaderJar, (ratio) => {
          const pct = Math.floor(Math.max(0, Math.min(1, ratio)) * loaderWeight);
          event.sender.send('install-progress', { id: inst.id, progress: pct, stage: 'Descargando NeoForge...' });
        });
      }
    }
  } catch (err) {
    throw err;
  }

  const addonSelectionCount = Number(inst.addons.optifine) + Number(inst.addons.sodium);
  const addonWeight = addonSelectionCount > 0 ? Math.min(20, addonSelectionCount * 10) : 0;
  if (addonWeight > 0) {
    addonWarnings = await installOptionalAddons(event, inst, root, loaderWeight, addonWeight);
  }
  preInstallWeight = Math.min(95, loaderWeight + addonWeight);

  const launcher = new Client();
  const stageState = {};
  let lastDebug = '';

  launcher.on('progress', (e) => {
    if (!e || !e.type || !e.total) return;
    stageState[e.type] = e.total > 0 ? (e.task / e.total) : 0;
    const overall = computeOverallProgress(stageState);
    const mapped = preInstallWeight > 0
      ? Math.min(100, preInstallWeight + Math.floor((100 - preInstallWeight) * (overall / 100)))
      : overall;
    event.sender.send('install-progress', {
      id: inst.id,
      progress: mapped,
      stage: stageLabel(e.type)
    });
  });

  launcher.on('debug', (e) => {
    lastDebug = String(e);
    appendFocusLog(`MCLC ${e}`);
  });

  launcher.startMinecraft = () => {
    launcher.emit('debug', '[MCLC]: Install-only, skipping launch');
    setTimeout(() => launcher.emit('close', 0), 0);
    return { on: () => {} };
  };

  const auth = buildOfflineAuth(inst.username || 'Offline');

  const ram = Number(store.get('ram', 4));
  const maxRam = Number.isFinite(ram) && ram > 0 ? ram : 4;
  const minRam = Math.max(1, maxRam - 1);

  const opts = {
    authorization: auth,
    root,
    version: {
      number: inst.version,
      type: resolveVersionType(loader)
    },
    memory: {
      max: `${maxRam}G`,
      min: `${minRam}G`
    },
    javaPath: javaPath || undefined
  };
  if (loaderJar) {
    opts.forge = loaderJar;
  }
  applyLoaderOverrides(opts, loader);

  const startPct = preInstallWeight > 0 ? preInstallWeight : 0;
  event.sender.send('install-progress', { id: inst.id, progress: startPct, stage: 'Preparando descarga...' });

  const child = await launcher.launch(opts);
  if (!child) {
    const details = lastDebug ? `\nDetalle: ${lastDebug}` : '';
    throw new Error(`No se pudo iniciar la descarga.${details}`);
  }

  inst.installed = true;
  inst.installedAt = Date.now();
  const idx = list.findIndex(i => i.id === inst.id);
  if (idx >= 0) list[idx] = inst;
  setInstances(list);
  event.sender.send('instances-list', list);
  event.sender.send('install-finished', {
    id: inst.id,
    firstInstall: true,
    installOnly: true,
    source: options.source || 'create',
    addonWarnings
  });
}

function normalizeSplashPayload(payload) {
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return null;
    return { text };
  }
  if (!payload || typeof payload !== 'object') return null;

  const normalized = {};
  if (typeof payload.text === 'string' && payload.text.trim()) normalized.text = payload.text.trim();
  if (typeof payload.phase === 'string' && payload.phase.trim()) normalized.phase = payload.phase.trim();
  if (typeof payload.indeterminate === 'boolean') normalized.indeterminate = payload.indeterminate;
  if (typeof payload.showProgress === 'boolean') normalized.showProgress = payload.showProgress;

  if (payload.progress === null) {
    normalized.progress = null;
  } else if (Number.isFinite(payload.progress)) {
    normalized.progress = Math.max(0, Math.min(100, Math.round(payload.progress)));
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function sendSplashStatus(payload) {
  const normalized = normalizeSplashPayload(payload);
  if (!normalized) return;

  pendingSplashStatus = {
    ...pendingSplashStatus,
    ...normalized
  };

  const logMsg = pendingSplashStatus.progress === null
    ? pendingSplashStatus.text
    : `${pendingSplashStatus.text} (${pendingSplashStatus.progress}%)`;
  appendFocusLog(`SPLASH ${logMsg}`);

  try {
    if (splashWindow && !splashWindow.isDestroyed() && splashWindow.webContents) {
      splashWindow.webContents.send('splash-status', pendingSplashStatus);
    }
  } catch {
    // ignore
  }
}

async function initializeLauncherRuntime() {
  const baseInstances = path.join(app.getPath('userData'), 'instances');
  ensureDir(baseInstances);

  const skinsDir = getSkinsDir();
  ensureDir(skinsDir);

  try {
    skinServer.startServer(skinsDir);
  } catch {
    // ignore
  }

  const storedProfile = getStoredProfile();
  if (storedProfile && storedProfile.authType !== 'ely' && storedProfile.skinData) {
    const storedModel = storedProfile.skinModel === 'slim' ? 'slim' : 'classic';
    applySkinForUser(storedProfile.name, storedProfile.skinData, storedModel);
    syncSkinToSharedService(storedProfile.name, storedProfile.skinData, storedModel)
      .then((ok) => {
        if (ok) appendFocusLog(`SKIN Shared startup sync ok: ${storedProfile.name}`);
      })
      .catch((err) => appendFocusLog(`SKIN Shared startup sync failed: ${String(err)}`));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0f',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.setMenuBarVisibility(false);
  mainWindow = win;
  attachWindowDiagnostics(win);
}

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 680,
    height: 420,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#0a0a0f',
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.webContents.on('did-finish-load', () => {
    if (pendingSplashStatus) {
      try {
        splash.webContents.send('splash-status', pendingSplashStatus);
      } catch {
        // ignore
      }
    }
  });
  splash.once('ready-to-show', () => {
    if (!splash.isDestroyed()) splash.show();
  });
  return splash;
}

app.whenReady().then(() => {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }
  splashWindow = createSplashWindow();
  const splashStart = Date.now();
  let splashDone = false;
  let splashTimer = null;
  let mainReady = false;
  let startupReady = false;
  let quittingForUpdate = false;

  createWindow();
  appendFocusLog('APP_READY');

  const finishSplash = () => {
    if (splashDone) return;
    splashDone = true;
    if (splashTimer) {
      clearTimeout(splashTimer);
      splashTimer = null;
    }
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
    if (!quittingForUpdate && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const maybeFinishSplash = () => {
    if (splashDone || quittingForUpdate) return;
    if (!mainReady || !startupReady) return;
    const elapsed = Date.now() - splashStart;
    const delay = Math.max(0, STARTUP_MIN_SPLASH_MS - elapsed);
    if (splashTimer) clearTimeout(splashTimer);
    splashTimer = setTimeout(finishSplash, delay);
  };

  if (mainWindow) {
    mainWindow.once('ready-to-show', () => {
      mainReady = true;
      maybeFinishSplash();
    });
  }

  (async () => {
    if (UPDATE_MODE === 'auto') {
      try {
        const update = await checkAndInstallLauncherUpdate(sendSplashStatus);
        if (update && update.installing) {
          quittingForUpdate = true;
          setTimeout(() => app.quit(), 300);
          return;
        }
      } catch (err) {
        appendFocusLog(`UPDATE Fatal check error: ${String(err)}`);
        sendSplashStatus({
          text: 'No se pudo verificar actualizaciones del launcher. Continuando...',
          phase: 'error',
          showProgress: false,
          progress: null,
          indeterminate: false
        });
      }
    } else {
      appendFocusLog('UPDATE Auto-check disabled (manual mode)');
      sendSplashStatus({
        text: 'Actualizaciones del launcher en modo manual.',
        phase: 'manual',
        showProgress: false,
        progress: null,
        indeterminate: false
      });
    }

    if (quittingForUpdate) return;

    try {
      sendSplashStatus({
        text: 'Preparando launcher...',
        phase: 'loading',
        showProgress: false,
        progress: null,
        indeterminate: false
      });
      await initializeLauncherRuntime();
    } catch (err) {
      appendFocusLog(`STARTUP Init failed: ${String(err)}`);
    }

    sendSplashStatus({
      text: 'Cargando interfaz...',
      phase: 'ready',
      showProgress: false,
      progress: null,
      indeterminate: false
    });
    startupReady = true;
    maybeFinishSplash();
  })();

  setTimeout(() => {
    if (splashDone || quittingForUpdate) return;
    appendFocusLog('SPLASH Timeout fallback');
    mainReady = true;
    startupReady = true;
    maybeFinishSplash();
  }, STARTUP_MAX_WAIT_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    skinServer.stopServer();
  } catch {
    // ignore
  }
});

// --- IPC ---

ipcMain.on('focus-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.webContents) mainWindow.webContents.focus();
});

ipcMain.on('focus-debug', (event, data) => {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  appendFocusLog(`RENDERER ${payload}`);
});

ipcMain.on('get-vanilla-versions', async (event) => {
  try {
    const manifest = await fetchJson(MANIFEST_URL);
    const releases = Array.isArray(manifest.versions)
      ? manifest.versions.filter(v => v.type === 'release').map(v => v.id)
      : [];

    if (releases.length > 0) {
      store.set('vanillaVersions', releases);
      store.set('vanillaVersionsFetchedAt', Date.now());
      event.reply('vanilla-versions', releases);
      return;
    }

    event.reply('vanilla-versions-error', 'No hay versiones en el manifest.');
  } catch (err) {
    const cached = store.get('vanillaVersions', []);
    if (cached.length > 0) {
      event.reply('vanilla-versions', cached);
      return;
    }
    event.reply('vanilla-versions-error', 'No se pudo obtener la lista de versiones.');
  }
});

ipcMain.on('get-forge-versions', async (event) => {
  try {
    const list = await fetchForgeMcVersions();
    if (list.length > 0) {
      store.set('forgeMcVersions', list);
      event.reply('forge-versions', list);
      return;
    }
    event.reply('forge-versions-error', 'No hay versiones Forge disponibles.');
  } catch (err) {
    const cached = store.get('forgeMcVersions', []);
    if (cached.length > 0) {
      event.reply('forge-versions', cached);
      return;
    }
    event.reply('forge-versions-error', 'No se pudo obtener la lista de Forge.');
  }
});

ipcMain.on('get-fabric-versions', async (event) => {
  try {
    const list = await fetchFabricMcVersions();
    if (list.length > 0) {
      store.set('fabricMcVersions', list);
      event.reply('fabric-versions', list);
      return;
    }
    event.reply('fabric-versions-error', 'No hay versiones Fabric disponibles.');
  } catch (err) {
    const cached = store.get('fabricMcVersions', []);
    if (cached.length > 0) {
      event.reply('fabric-versions', cached);
      return;
    }
    event.reply('fabric-versions-error', 'No se pudo obtener la lista de Fabric.');
  }
});

ipcMain.on('get-snapshot-versions', async (event) => {
  try {
    const list = await fetchSnapshotMcVersions();
    if (list.length > 0) {
      store.set('snapshotMcVersions', list);
      event.reply('snapshot-versions', list);
      return;
    }
    event.reply('snapshot-versions-error', 'No hay snapshots disponibles.');
  } catch (err) {
    const cached = store.get('snapshotMcVersions', []);
    if (cached.length > 0) {
      event.reply('snapshot-versions', cached);
      return;
    }
    event.reply('snapshot-versions-error', 'No se pudo obtener la lista de snapshots.');
  }
});

ipcMain.on('get-neoforge-versions', async (event) => {
  try {
    const list = await fetchNeoForgeMcVersions();
    if (list.length > 0) {
      store.set('neoforgeMcVersions', list);
      event.reply('neoforge-versions', list);
      return;
    }
    event.reply('neoforge-versions-error', 'No hay versiones NeoForge disponibles.');
  } catch (err) {
    const cached = store.get('neoforgeMcVersions', []);
    if (cached.length > 0) {
      event.reply('neoforge-versions', cached);
      return;
    }
    event.reply('neoforge-versions-error', 'No se pudo obtener la lista de NeoForge.');
  }
});

ipcMain.on('get-instances', (event) => {
  event.reply('instances-list', getInstances());
});

ipcMain.on('get-profile', (event) => {
  event.reply('profile-data', getStoredProfile());
});

ipcMain.on('ely-login', async (event, data) => {
  const requestId = data && data.requestId ? String(data.requestId) : null;
  const login = data && data.login ? String(data.login) : '';
  const password = data && data.password ? String(data.password) : '';

  try {
    const authData = await authenticateElyByCredentials(login, password);
    const previous = getStoredProfile();

    const profile = {
      name: authData.name,
      authType: 'ely',
      uuid: authData.uuid,
      accessToken: authData.accessToken,
      clientToken: authData.clientToken,
      avatarData: previous && previous.avatarData ? previous.avatarData : null,
      skinData: null,
      skinModel: null,
      updatedAt: Date.now()
    };

    store.set('profile', profile);
    event.sender.send('profile-data', profile);
    event.sender.send('ely-login-result', {
      requestId,
      ok: true,
      profile: {
        name: profile.name,
        authType: profile.authType
      }
    });
    appendFocusLog(`ELY Login ok: ${profile.name}`);
  } catch (err) {
    const msg = err ? String(err) : 'No se pudo iniciar sesion con Ely.by.';
    event.sender.send('ely-login-result', {
      requestId,
      ok: false,
      error: msg
    });
    appendFocusLog(`ELY Login failed: ${msg}`);
  }
});

ipcMain.on('save-profile', (event, data) => {
  if (!data || !data.name) return;
  const previous = getStoredProfile();
  const incomingName = String(data.name).trim();
  if (!incomingName) return;

  const requestedAuthType = data.authType === 'ely' ? 'ely' : 'offline';
  const effectiveAuthType = previous && previous.authType === 'ely'
    ? 'ely'
    : requestedAuthType;
  const profileName = effectiveAuthType === 'ely' && previous && previous.name
    ? String(previous.name).trim()
    : incomingName;
  if (!profileName) return;

  const profile = {
    name: profileName,
    authType: effectiveAuthType,
    avatarData: data.avatarData ? String(data.avatarData) : null,
    skinData: data.skinData ? String(data.skinData) : null,
    skinModel: data.skinModel === 'slim' ? 'slim' : 'classic',
    updatedAt: Date.now()
  };

  if (profile.authType === 'ely') {
    profile.uuid = previous && previous.uuid ? formatUuid(previous.uuid) : null;
    profile.accessToken = previous && previous.accessToken ? String(previous.accessToken).trim() : '';
    profile.clientToken = previous && previous.clientToken
      ? formatUuid(previous.clientToken)
      : getElyClientToken();
  } else {
    if (profile.skinData) {
      const ok = applySkinForUser(profile.name, profile.skinData, profile.skinModel);
      if (!ok) profile.skinData = null;
    }

    if (!profile.skinData) {
      removeSkinForUser(profile.name);
      profile.skinModel = null;
    }

    if (
      previous &&
      previous.name &&
      String(previous.name).trim().toLowerCase() !== profile.name.toLowerCase()
    ) {
      removeSkinForUser(previous.name);
    }
  }

  store.set('profile', profile);
  event.reply('profile-data', profile);

  if (profile.authType !== 'ely') {
    if (profile.skinData) {
      syncSkinToSharedService(profile.name, profile.skinData, profile.skinModel)
        .then((ok) => {
          if (ok) appendFocusLog(`SKIN Shared profile sync ok: ${profile.name}`);
        })
        .catch((err) => appendFocusLog(`SKIN Shared profile sync failed: ${String(err)}`));
    } else {
      deleteSkinFromSharedService(profile.name)
        .catch((err) => appendFocusLog(`SKIN Shared delete failed (${profile.name}): ${String(err)}`));
    }
  }

  if (
    previous &&
    previous.name &&
    String(previous.name).trim().toLowerCase() !== profile.name.toLowerCase()
  ) {
    deleteSkinFromSharedService(previous.name)
      .catch((err) => appendFocusLog(`SKIN Shared delete failed (${previous.name}): ${String(err)}`));
  }
});

ipcMain.on('clear-profile', () => {
  const previous = getStoredProfile();
  if (previous && previous.name) removeSkinForUser(previous.name);
  store.set('profile', null);
  if (previous && previous.name) {
    deleteSkinFromSharedService(previous.name)
      .catch((err) => appendFocusLog(`SKIN Shared delete failed (${previous.name}): ${String(err)}`));
  }
});

ipcMain.on('set-ram', (event, val) => {
  const num = Number(val);
  if (!Number.isNaN(num)) store.set('ram', num);
});

ipcMain.on('get-settings', (event) => {
  event.reply('settings-data', {
    ram: store.get('ram', 4),
    skinServiceUrl: store.get('skinServiceUrl', ''),
    skinServiceToken: store.get('skinServiceToken', '')
  });
});

ipcMain.on('set-skin-service-settings', (event, data) => {
  if (!data || typeof data !== 'object') return;

  const normalizedUrl = normalizeHttpOrHttpsUrl(data.url || '');
  const token = String(data.token || '').trim();

  store.set('skinServiceUrl', normalizedUrl || '');
  store.set('skinServiceToken', token);
  sharedSkinServiceHealthCache.url = '';
  sharedSkinServiceHealthCache.ok = false;
  sharedSkinServiceHealthCache.checkedAt = 0;

  event.reply('settings-data', {
    ram: store.get('ram', 4),
    skinServiceUrl: store.get('skinServiceUrl', ''),
    skinServiceToken: store.get('skinServiceToken', '')
  });
});

ipcMain.on('check-username-conflict', async (event, data) => {
  const requestId = data && data.requestId ? String(data.requestId) : null;
  const username = data && data.username ? String(data.username) : '';
  let result = { checked: false, exists: false, serviceUrl: null };
  try {
    result = await checkSharedUsernameConflict(username);
  } catch (err) {
    result = {
      checked: false,
      exists: false,
      serviceUrl: getSkinServiceConfig() ? getSkinServiceConfig().url : null,
      error: err ? String(err) : 'Unknown error'
    };
  }
  event.sender.send('username-conflict-result', {
    requestId,
    username,
    ...result
  });
});

ipcMain.on('install-instance', async (event, data) => {
  if (!data || !data.name || !data.version) {
    event.sender.send('install-error', 'Datos inválidos');
    return;
  }

  const clean = {
    id: Number(data.id),
    name: String(data.name).trim(),
    version: String(data.version).trim(),
    loader: String(data.loader || 'Vanilla'),
    username: String(data.username || 'Offline'),
    addons: normalizeAddonSelection(data.addons)
  };

  const list = getInstances();
  const idx = list.findIndex(i => i.id === clean.id);
  const prev = idx >= 0 ? list[idx] : null;
  const merged = {
    ...clean,
    installed: prev ? !!prev.installed : false,
    installedAt: prev ? prev.installedAt || null : null,
    addonsInstalled: prev && prev.addonsInstalled && typeof prev.addonsInstalled === 'object'
      ? prev.addonsInstalled
      : {}
  };
  if (idx === -1) list.push(merged);
  else list[idx] = merged;

  setInstances(list);
  event.sender.send('instances-list', list);

  const downloadNow = data.downloadNow !== false;
  if (!downloadNow) {
    event.sender.send('install-complete');
    return;
  }

  if (activeInstalls.has(clean.id)) {
    event.sender.send('install-error', 'Esta instancia ya se está descargando.');
    return;
  }

  activeInstalls.set(clean.id, true);
  try {
    await runInstallOnly(event, merged, list, { source: 'create' });
  } catch (err) {
    const msg = err ? String(err) : 'No se pudo descargar Minecraft.';
    event.sender.send('install-error', msg);
  } finally {
    activeInstalls.delete(clean.id);
  }
});

ipcMain.on('delete-instance', (event, id) => {
  const list = getInstances().filter(i => i.id !== id);
  setInstances(list);
  event.sender.send('instances-list', list);
});

ipcMain.on('open-instance-folder', async (event, id) => {
  if (id === undefined || id === null) return;
  const root = getInstanceRoot(id);
  if (!fs.existsSync(root)) {
    event.sender.send('open-instance-folder-error', 'La carpeta de la instancia no existe.');
    return;
  }
  try {
    const result = await shell.openPath(root);
    if (result) {
      event.sender.send('open-instance-folder-error', `No se pudo abrir la carpeta: ${result}`);
    }
  } catch (err) {
    event.sender.send('open-instance-folder-error', 'No se pudo abrir la carpeta.');
  }
});

ipcMain.on('open-external', async (event, url) => {
  if (!url || typeof url !== 'string') return;
  try {
    await shell.openExternal(url);
  } catch {
    // ignore
  }
});

ipcMain.on('launch-game', async (event, instanceId) => {
  if (activeLaunches.has(instanceId)) {
    event.sender.send('launch-error', 'Ya se está abriendo esta instancia.');
    return;
  }
  if (activeInstalls.has(instanceId)) {
    event.sender.send('launch-error', 'La instancia todavía se está descargando.');
    return;
  }

  const list = getInstances();
  const inst = list.find(i => i.id === instanceId);
  if (!inst) {
    event.sender.send('launch-error', 'Instancia no encontrada.');
    return;
  }

  const loader = String(inst.loader || 'Vanilla');
  if (!['Vanilla', 'Forge', 'NeoForge', 'Fabric', 'Snapshots'].includes(loader)) {
    event.sender.send('launch-error', 'Este loader no está soportado por ahora.');
    return;
  }

  const javaSelection = await selectJavaForVersion(inst.version);
  if (!javaSelection.path) {
    event.sender.send('java-guide', {
      version: inst.version,
      required: javaSelection.required,
      maxAllowed: javaSelection.maxAllowed
    });
    event.sender.send('launch-error', `No se encontró un Java compatible para Minecraft ${inst.version}.`);
    return;
  }
  const javaPath = javaSelection.path;

  const root = getInstanceRoot(inst.id);
  const ensured = ensureDir(root);
  if (ensured !== true) {
    event.sender.send('launch-error', `No se pudo crear la carpeta de la instancia.\nDetalle: ${String(ensured)}`);
    return;
  }

  let needsInstall = !isVersionInstalled(root, inst.version) || !inst.installed;
  if (!needsInstall && (loader === 'Forge' || loader === 'NeoForge')) {
    if (!inst.loaderVersion) {
      needsInstall = true;
    } else {
      const loaderDir = path.join(root, 'loader');
      if (loader === 'Forge') {
        const suffix = isAtLeast(inst.version, '1.13') ? 'installer' : 'universal';
        const expected = path.join(loaderDir, `forge-${inst.loaderVersion}-${suffix}.jar`);
        if (!fs.existsSync(expected)) needsInstall = true;
      } else if (loader === 'NeoForge') {
        const artifact = inst.loaderArtifact || 'neoforge';
        const expected = path.join(loaderDir, `${artifact}-${inst.loaderVersion}-installer.jar`);
        if (!fs.existsSync(expected)) needsInstall = true;
      }
    }
  }

  if (needsInstall) {
    if (activeInstalls.has(inst.id)) {
      event.sender.send('launch-error', 'La instancia todavía se está descargando.');
      return;
    }
    activeInstalls.set(inst.id, true);
    try {
      await runInstallOnly(event, inst, list, { source: 'launch' });
    } catch (err) {
      const msg = err ? String(err) : 'No se pudo descargar Minecraft.';
      event.sender.send('launch-error', msg);
    } finally {
      activeInstalls.delete(inst.id);
    }
    return;
  }

  let loaderJar = null;
  let loaderWeight = 0;
  let loaderDidInstall = false;
  try {
    if (loader === 'Forge') {
      const resolved = await resolveForgeInstaller(inst.version, inst.loaderVersion);
      inst.loaderVersion = resolved.forgeVersion;
      const loaderDir = path.join(root, 'loader');
      ensureDir(loaderDir);
      loaderJar = path.join(loaderDir, resolved.fileName);
      if (!fs.existsSync(loaderJar)) {
        loaderWeight = 20;
        event.sender.send('install-progress', { id: inst.id, progress: 0, stage: 'Descargando Forge...' });
        await downloadFile(resolved.url, loaderJar, (ratio) => {
          const pct = Math.floor(Math.max(0, Math.min(1, ratio)) * loaderWeight);
          event.sender.send('install-progress', { id: inst.id, progress: pct, stage: 'Descargando Forge...' });
        });
        loaderDidInstall = true;
      }
    } else if (loader === 'NeoForge') {
      const resolved = await resolveNeoForgeInstaller(inst.version, inst.loaderVersion, inst.loaderArtifact, inst.loaderBase);
      inst.loaderVersion = resolved.neoVersion;
      inst.loaderArtifact = resolved.artifact;
      inst.loaderBase = resolved.baseUrl;
      const loaderDir = path.join(root, 'loader');
      ensureDir(loaderDir);
      loaderJar = path.join(loaderDir, resolved.fileName);
      if (!fs.existsSync(loaderJar)) {
        loaderWeight = 20;
        event.sender.send('install-progress', { id: inst.id, progress: 0, stage: 'Descargando NeoForge...' });
        await downloadFile(resolved.url, loaderJar, (ratio) => {
          const pct = Math.floor(Math.max(0, Math.min(1, ratio)) * loaderWeight);
          event.sender.send('install-progress', { id: inst.id, progress: pct, stage: 'Descargando NeoForge...' });
        });
        loaderDidInstall = true;
      }
    }
  } catch (err) {
    const msg = err ? String(err) : 'No se pudo preparar el loader.';
    event.sender.send('launch-error', msg);
    return;
  }

  const needsInstallNow = loaderDidInstall;

  const launcher = new Client();
  const stageState = {};
  let lastDebug = '';
  let startedSignalSent = false;
  const launchStart = Date.now();

  const sendGameStarted = () => {
    if (startedSignalSent) return;
    startedSignalSent = true;
    event.sender.send('game-started', { id: inst.id });
  };

  launcher.on('progress', (e) => {
    if (!needsInstallNow) return;
    if (!e || !e.type || !e.total) return;
    const percent = Math.max(0, Math.min(100, Math.floor((e.task / e.total) * 100)));
    stageState[e.type] = e.total > 0 ? (e.task / e.total) : 0;
    const overall = computeOverallProgress(stageState);
    const mapped = loaderWeight > 0
      ? Math.min(100, loaderWeight + Math.floor((100 - loaderWeight) * (overall / 100)))
      : overall;
    event.sender.send('install-progress', {
      id: inst.id,
      progress: mapped,
      stage: stageLabel(e.type)
    });
  });

  launcher.on('debug', (e) => {
    lastDebug = String(e);
    appendFocusLog(`MCLC ${e}`);
  });

  launcher.on('data', (e) => {
    if (!startedSignalSent) sendGameStarted();
    event.sender.send('game-log', String(e));
  });

  const ram = Number(store.get('ram', 4));
  const maxRam = Number.isFinite(ram) && ram > 0 ? ram : 4;
  const minRam = Math.max(1, maxRam - 1);

  let launchAuth = null;
  try {
    launchAuth = await ensureLaunchProfileAuth(getStoredProfile(), inst.username || 'Offline');
  } catch (err) {
    event.sender.send('launch-error', err ? String(err) : 'No se pudo validar la sesion.');
    return;
  }
  const auth = launchAuth.authorization;
  const authType = launchAuth.authType;
  const launchUsername = launchAuth && launchAuth.profile && launchAuth.profile.name
    ? String(launchAuth.profile.name)
    : String(inst.username || 'Offline');

  const opts = {
    authorization: auth,
    root,
    version: {
      number: inst.version,
      type: resolveVersionType(loader)
    },
    memory: {
      max: `${maxRam}G`,
      min: `${minRam}G`
    },
    javaPath: javaPath || undefined
  };
  if (loaderJar) {
    opts.forge = loaderJar;
  }
  applyLoaderOverrides(opts, loader);
  try {
    const skinMode = await attachSkinLaunchArgs(opts, launchUsername, authType);
    if (skinMode === 'ely') {
      event.sender.send('game-log', '[Skin] Ely.by activado.');
    } else if (skinMode === 'shared') {
      event.sender.send('game-log', '[Skin] Modo compartido activado (usuarios Xeno).');
    } else if (skinMode === 'local') {
      event.sender.send('game-log', '[Skin] Modo local activado.');
    } else {
      event.sender.send('game-log', '[Skin] Sistema de skins activado.');
    }
  } catch (err) {
    const msg = err ? String(err) : 'No se pudo activar el sistema de skins.';
    appendFocusLog(`SKIN ${msg}`);
    event.sender.send('game-log', `[Skin] ${msg}`);
  }

  if (needsInstallNow) {
    const startPct = loaderWeight > 0 ? loaderWeight : 0;
    event.sender.send('install-progress', { id: inst.id, progress: startPct, stage: 'Preparando descarga...' });
  } else {
    event.sender.send('game-starting', { id: inst.id });
  }

  const startedFallback = setTimeout(() => {
    sendGameStarted();
  }, 15000);

  launcher.launch(opts)
    .then((child) => {
      if (!child) {
        clearTimeout(startedFallback);
        const details = lastDebug ? `\nDetalle: ${lastDebug}` : '';
        event.sender.send('launch-error', `No se pudo iniciar Minecraft.${details}`);
        return;
      }
      activeLaunches.set(inst.id, child);
      child.on('close', (code) => {
        activeLaunches.delete(inst.id);
        clearTimeout(startedFallback);
        const early = Date.now() - launchStart < 15000;
        if (early) {
          const details = lastDebug ? `\nDetalle: ${lastDebug}` : '';
          event.sender.send('launch-error', `Minecraft se cerró al iniciar (código ${code}).${details}`);
        }
      });
      child.on('error', (err) => {
        activeLaunches.delete(inst.id);
        clearTimeout(startedFallback);
        const details = lastDebug ? `\nDetalle: ${lastDebug}` : '';
        event.sender.send('launch-error', err ? `${String(err)}${details}` : `Error al iniciar.${details}`);
      });

      inst.installed = true;
      inst.installedAt = Date.now();
      const idx = list.findIndex(i => i.id === inst.id);
      if (idx >= 0) list[idx] = inst;
      setInstances(list);
      event.sender.send('instances-list', list);
      if (needsInstallNow) {
        event.sender.send('install-finished', { id: inst.id, firstInstall: true });
        event.sender.send('game-starting', { id: inst.id, firstInstall: true });
      }
      if (!needsInstallNow) {
        // Si ya estaba instalado, dejamos que 'data' o el fallback disparen game-started
        // para que la ventana de "Abriendo" no se cierre antes de tiempo.
      }
    })
    .catch((err) => {
      activeLaunches.delete(inst.id);
      clearTimeout(startedFallback);
      const details = lastDebug ? `\nDetalle: ${lastDebug}` : '';
      event.sender.send('launch-error', err ? `${String(err)}${details}` : `Error al iniciar.${details}`);
    });
});
