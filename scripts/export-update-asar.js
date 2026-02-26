const fs = require('fs');
const path = require('path');

function readPackageVersion(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = String(pkg.version || '').trim();
  if (!version) throw new Error('package.json no contiene version.');
  return version;
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

function main() {
  const rootDir = process.cwd();
  const version = readPackageVersion(rootDir);
  const sourceAsar = path.join(rootDir, 'dist', 'win-unpacked', 'resources', 'app.asar');

  if (!fs.existsSync(sourceAsar)) {
    throw new Error(`No existe el archivo fuente: ${sourceAsar}`);
  }

  const asarMtime = fs.statSync(sourceAsar).mtimeMs;
  const srcMtime = newestSourceMtime(rootDir);
  if (srcMtime > asarMtime + 1000) {
    throw new Error('El app.asar esta desactualizado. Ejecuta primero: npm run build:win');
  }

  const targetAsar = path.join(rootDir, 'dist', `XenoLauncher-App-${version}.asar`);
  fs.copyFileSync(sourceAsar, targetAsar);

  const stats = fs.statSync(targetAsar);
  console.log(`[build:asar-asset] Archivo creado: ${targetAsar}`);
  console.log(`[build:asar-asset] Tamano: ${formatSize(stats.size)}`);
}

try {
  main();
} catch (err) {
  console.error(`[build:asar-asset] Error: ${err.message || String(err)}`);
  process.exitCode = 1;
}
