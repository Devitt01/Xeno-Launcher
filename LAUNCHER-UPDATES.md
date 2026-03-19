# Xeno Launcher Updates

## ES (Espanol)

### Base del sistema (estilo produccion)
- Motor por defecto: `legacy + asar` (no requiere subir a `1.0.1` para parches chicos).
- Verificacion de integridad: el launcher valida `SHA256` del parche `.asar` si existe digest en release o archivo `.sha256`.
- Anti-loop: para parches de misma version, se desactiva fallback binario automatico y se aplica cooldown de reintentos.
- Rollout controlado: se mantiene el gate de aprobacion (`XENO_PUBLIC_UPDATE`) para publicar cuando tu quieras.

### Defaults actuales
- `XENO_UPDATE_ENGINE=legacy` (default)
- `XENO_UPDATE_STRATEGY=asar` (default)
- `XENO_UPDATE_MODE=auto` (default)

### Publicar un parche pequeno (misma version)
1. Genera el asset:
```bash
npm run build:asar-asset
```
2. Sube a la release estos dos archivos:
- `XenoLauncher-App-1.0.0.asar`
- `XenoLauncher-App-1.0.0.asar.sha256`

Con eso, los clientes actualizan sin cambiar a `1.0.1`.

### Recomendacion fuerte
- No reescribas assets ya publicados en una release en produccion.
- Publica nuevos assets/builds de forma inmutable para evitar estados inconsistentes entre usuarios.

### Binarios (setup/portable)
- `XenoLauncher-Setup-1.0.0.exe` y `XenoLauncher-Portable-1.0.0.exe` quedan para reinstalacion/manual.
- En parches de misma version, el flujo principal debe ser `.asar`.

---

## EN (English)

### Production-style baseline
- Default engine: `legacy + asar` (no need to bump to `1.0.1` for small patches).
- Integrity verification: launcher validates patch `SHA256` when release digest or `.sha256` sidecar exists.
- Anti-loop: for same-version patches, automatic binary fallback is disabled and retry cooldown is applied.
- Controlled rollout: approval gate (`XENO_PUBLIC_UPDATE`) remains in place.

### Current defaults
- `XENO_UPDATE_ENGINE=legacy` (default)
- `XENO_UPDATE_STRATEGY=asar` (default)
- `XENO_UPDATE_MODE=auto` (default)

### Publish a small patch (same version)
1. Build asset:
```bash
npm run build:asar-asset
```
2. Upload both files to the release:
- `XenoLauncher-App-1.0.0.asar`
- `XenoLauncher-App-1.0.0.asar.sha256`

Clients can update without moving to `1.0.1`.

### Strong recommendation
- Do not overwrite already-published assets in production releases.
- Publish immutable build artifacts to avoid inconsistent client states.

### Binary artifacts (setup/portable)
- `XenoLauncher-Setup-1.0.0.exe` and `XenoLauncher-Portable-1.0.0.exe` remain for reinstall/manual use.
- For same-version patches, `.asar` should be the primary path.
