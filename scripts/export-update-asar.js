const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readPackageVersion(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = String(pkg.version || '').trim();
  if (!version) throw new Error('package.json no contiene version.');
  return version;
}

function resolveOutputDir(rootDir) {
  const raw = String(process.env.XENO_BUILD_OUTPUT_DIR || '').trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.join(rootDir, raw);
  }

  // Auto-detect newest build output when env override is not provided.
  const candidates = ['dist', 'dist-release'].map((dir) => path.join(rootDir, dir));
  let selected = null;
  for (const candidate of candidates) {
    const sourceAsar = path.join(candidate, 'win-unpacked', 'resources', 'app.asar');
    if (!fs.existsSync(sourceAsar)) continue;
    const mtimeMs = fs.statSync(sourceAsar).mtimeMs;
    if (!selected || mtimeMs > selected.mtimeMs) {
      selected = { dir: candidate, mtimeMs };
    }
  }
  if (selected) return selected.dir;

  return path.join(rootDir, 'dist');
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function newestSourceMtime(rootDir) {
  const importantFiles = [
    'main.js',
    'index.html',
    'preload.js',
    'splash.html',
    'skin-server.js',
    'package.json'
  ];
  let newest = 0;
  for (const rel of importantFiles) {
    const full = path.join(rootDir, rel);
    if (!fs.existsSync(full)) continue;
    const mtime = fs.statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function computeFileHash(filePath, algorithm) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash(algorithm).update(data).digest('hex');
}

function main() {
  const rootDir = process.cwd();
  const version = readPackageVersion(rootDir);
  const outputDir = resolveOutputDir(rootDir);
  const sourceAsar = path.join(outputDir, 'win-unpacked', 'resources', 'app.asar');

  if (!fs.existsSync(sourceAsar)) {
    throw new Error(
      `No existe el archivo fuente: ${sourceAsar}. Ejecuta primero: npm run build:win o npm run build:release:win`
    );
  }

  const asarMtime = fs.statSync(sourceAsar).mtimeMs;
  const srcMtime = newestSourceMtime(rootDir);
  if (srcMtime > asarMtime + 1000) {
    throw new Error('El app.asar esta desactualizado. Ejecuta primero: npm run build:patch:asar (o npm run build:win).');
  }

  const targetAsar = path.join(outputDir, `XenoLauncher-App-${version}.asar`);
  fs.copyFileSync(sourceAsar, targetAsar);

  const stats = fs.statSync(targetAsar);
  const sha256 = computeFileHash(targetAsar, 'sha256');
  const checksumPath = `${targetAsar}.sha256`;
  fs.writeFileSync(checksumPath, `${sha256}  ${path.basename(targetAsar)}\n`, 'utf8');

  console.log(`[build:asar-asset] Output: ${outputDir}`);
  console.log(`[build:asar-asset] Archivo creado: ${targetAsar}`);
  console.log(`[build:asar-asset] Tamano: ${formatSize(stats.size)}`);
  console.log(`[build:asar-asset] SHA256: ${sha256}`);
  console.log(`[build:asar-asset] Checksum file: ${checksumPath}`);
}

try {
  main();
} catch (err) {
  console.error(`[build:asar-asset] Error: ${err.message || String(err)}`);
  process.exitCode = 1;
}
