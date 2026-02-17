# Xeno Launcher Updates (Real Workflow)

## ES (Espanol)

Este launcher ya soporta actualizacion real en arranque para versiones empaquetadas (`app.isPackaged`).

### Como decide si hay update

1. Busca fuente de update en este orden:
   - `XENO_UPDATE_MANIFEST_URL`
   - `XENO_UPDATE_REPO`
   - `repository` en `package.json`
2. Compara version actual vs ultima version publicada.
3. Si hay una version nueva:
   - descarga instalador `.exe` o `.msi`
   - valida el instalador descargado
   - ejecuta instalador
   - cierra launcher para actualizar

### Importante

- Esto **no** actualiza Windows.
- Solo actualiza **Xeno Launcher**.
- No publica nada automaticamente. Publicar release sigue siendo manual.

### Modo manual / auto

- Auto (default): revisa updates al iniciar.
- Manual: no revisa updates.

Para forzar manual:

```powershell
$env:XENO_UPDATE_MODE="manual"
npm start
```

Para forzar auto:

```powershell
$env:XENO_UPDATE_MODE="auto"
npm start
```

Para permitir actualizar desde pre-releases:

```powershell
$env:XENO_UPDATE_INCLUDE_PRERELEASE="true"
npm start
```

### Requisito para que funcione a tus usuarios

Debes publicar releases con version mayor a la instalada (ej: `1.0.1`, `1.0.2`) y adjuntar instalador Windows.

### Flujo recomendado (GitHub Releases)

1. Sube el repo a GitHub.
2. Define `repository` en `package.json` con tu repo.
3. Sube cambios de version en `package.json` (ej: `1.0.1`).
4. Compila instalador:

```bash
npm install
npm run build:win
```

5. Crea release en GitHub con tag `v<version>` (ej: `v1.0.1`).
6. Adjunta `dist/XenoLauncher-Setup-<version>.exe` a la release.
7. Marca la release como publicada (no `draft`).
8. Al abrir launcher, tus usuarios reciben la actualizacion.

---

## EN (English)

This launcher already supports real startup updates for packaged builds (`app.isPackaged`).

### How it decides updates

1. It resolves an update source in this order:
   - `XENO_UPDATE_MANIFEST_URL`
   - `XENO_UPDATE_REPO`
   - `repository` from `package.json`
2. It compares current version vs latest published version.
3. If a newer version exists:
   - downloads `.exe` or `.msi`
   - validates the downloaded installer
   - launches installer
   - closes launcher to update

### Important

- This does **not** update Windows.
- It only updates **Xeno Launcher**.
- Nothing is published automatically. Releasing is still manual.

### Manual / auto mode

- Auto (default): checks updates at startup.
- Manual: no update checks.

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

Allow updates from pre-releases:

```powershell
$env:XENO_UPDATE_INCLUDE_PRERELEASE="true"
npm start
```

### Requirement for users to receive updates

You must publish releases with a higher version than installed (e.g. `1.0.1`, `1.0.2`) and attach a Windows installer.

### Recommended flow (GitHub Releases)

1. Push repo to GitHub.
2. Set `repository` in `package.json`.
3. Bump version in `package.json` (e.g. `1.0.1`).
4. Build installer:

```bash
npm install
npm run build:win
```

5. Create release tag `v<version>` (e.g. `v1.0.1`).
6. Attach `dist/XenoLauncher-Setup-<version>.exe` to release assets.
7. Publish the release (not `draft`).
8. On next launcher start, users get the update.
