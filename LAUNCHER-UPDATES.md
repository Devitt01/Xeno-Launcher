# Xeno Launcher Updates (Setup + Portable)

## ES (Espanol)

El launcher ya soporta actualizacion real al iniciar para builds empaquetadas (`app.isPackaged`) en **dos modos**:
- `setup` (instalado con NSIS)
- `portable` (ejecutable portable)

### Como decide el update

1. Resuelve fuente de update (orden):
   - `XENO_UPDATE_MANIFEST_URL`
   - `XENO_UPDATE_REPO`
   - `repository` en `package.json`
2. Compara `app.getVersion()` vs ultima release.
3. Si hay version nueva:
   - En modo `setup`: busca asset instalador (`Setup/Installer .exe/.msi`).
   - En modo `portable`: busca asset portable (`Portable .exe`).
4. Descarga, valida, instala/aplica y reinicia launcher.

### Importante

- Esto **no** actualiza Windows.
- Esto solo actualiza **Xeno Launcher**.
- No publica nada automaticamente. Publicar release sigue siendo manual.
- En `portable`, si no hay permisos de escritura en la carpeta del `.exe`, se fuerza update manual.

### Modo auto/manual

- Auto (default): revisa updates al iniciar.
- Manual: no revisa updates.

Forzar manual:

```powershell
$env:XENO_UPDATE_MODE="manual"
npm start
```

Forzar auto:

```powershell
$env:XENO_UPDATE_MODE="auto"
npm start
```

Permitir pre-releases:

```powershell
$env:XENO_UPDATE_INCLUDE_PRERELEASE="true"
npm start
```

### Como publicar para que actualice Setup y Portable

1. Subir cambios a GitHub.
2. Subir version en `package.json` (ejemplo `1.0.1`).
3. Compilar ambos artefactos:

```bash
npm install
npm run build:release:win
```

4. Crear release con tag `v<version>` (ejemplo `v1.0.1`).
5. Adjuntar ambos archivos de `dist/`:
   - `XenoLauncher-Setup-<version>.exe`
   - `XenoLauncher-Portable-<version>.exe`
6. Publicar release (no `draft`).
7. En el proximo inicio:
   - Usuarios setup -> update setup.
   - Usuarios portable -> update portable.

---

## EN (English)

The launcher now supports real startup updates for packaged builds (`app.isPackaged`) in **two modes**:
- `setup` (NSIS installed app)
- `portable` (portable executable)

### How update detection works

1. It resolves update source (order):
   - `XENO_UPDATE_MANIFEST_URL`
   - `XENO_UPDATE_REPO`
   - `repository` in `package.json`
2. It compares `app.getVersion()` with the latest release.
3. If a newer version exists:
   - In `setup` mode: it looks for setup installer asset (`Setup/Installer .exe/.msi`).
   - In `portable` mode: it looks for portable asset (`Portable .exe`).
4. It downloads, validates, applies/installs, and restarts.

### Important

- This does **not** update Windows.
- It only updates **Xeno Launcher**.
- Nothing is published automatically. Release publishing is still manual.
- In `portable` mode, if write permission is missing on the current `.exe` folder, update falls back to manual.

### Auto/manual mode

- Auto (default): checks updates on startup.
- Manual: skips update checks.

Force manual:

```powershell
$env:XENO_UPDATE_MODE="manual"
npm start
```

Force auto:

```powershell
$env:XENO_UPDATE_MODE="auto"
npm start
```

Allow pre-releases:

```powershell
$env:XENO_UPDATE_INCLUDE_PRERELEASE="true"
npm start
```

### Release flow so Setup and Portable both update

1. Push changes to GitHub.
2. Bump `package.json` version (example `1.0.1`).
3. Build both artifacts:

```bash
npm install
npm run build:release:win
```

4. Create release tag `v<version>` (example `v1.0.1`).
5. Upload both files from `dist/`:
   - `XenoLauncher-Setup-<version>.exe`
   - `XenoLauncher-Portable-<version>.exe`
6. Publish release (not `draft`).
7. On next launcher start:
   - Setup users get setup update.
   - Portable users get portable update.
