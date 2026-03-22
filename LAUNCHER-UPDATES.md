# Xeno Launcher Updates

## ES (Espanol)

### Base del sistema (produccion)
- Motor por defecto: `legacy + binary` (setup/portable), pensado para evitar fallos de parcheo en caliente.
- Deteccion de update: por `marker` de assets (misma version `1.0.0` permitida).
- Integridad: se valida `SHA256` cuando el release trae digest/archivo `.sha256`.
- Rollout controlado: se mantiene gate de aprobacion (`XENO_PUBLIC_UPDATE`).

### Defaults actuales
- `XENO_UPDATE_ENGINE=legacy` (default)
- `XENO_UPDATE_STRATEGY=binary` (default)
- `XENO_UPDATE_MODE=auto` (default)

### Flujo recomendado (misma version)
1. Genera build de release:
```bash
npm run build:release:win
```
2. Sube a la release:
- `XenoLauncher-Setup-1.0.0.exe`
- `XenoLauncher-Portable-1.0.0.exe` (si usas portable)
3. El launcher descargara el binario en segundo plano y aplicara update sin subir a `1.0.1`.

### Opcional: parche ASAR
- Sigue soportado con `XENO_UPDATE_STRATEGY=asar`.
- Solo recomendado para entornos controlados.

### Recomendacion fuerte
- No reescribas assets ya publicados en produccion.
- Publica artifacts inmutables para evitar inconsistencias entre usuarios.

---

## EN (English)

### Production baseline
- Default engine: `legacy + binary` (setup/portable) to avoid hot-patch instability.
- Update detection: asset-based `marker` (same version `1.0.0` is supported).
- Integrity: `SHA256` verification is used when digest/sidecar `.sha256` exists.
- Controlled rollout: approval gate (`XENO_PUBLIC_UPDATE`) remains enabled.

### Current defaults
- `XENO_UPDATE_ENGINE=legacy` (default)
- `XENO_UPDATE_STRATEGY=binary` (default)
- `XENO_UPDATE_MODE=auto` (default)

### Recommended flow (same version)
1. Build release:
```bash
npm run build:release:win
```
2. Upload to release:
- `XenoLauncher-Setup-1.0.0.exe`
- `XenoLauncher-Portable-1.0.0.exe` (if portable mode is used)
3. Launcher downloads binary in background and updates without bumping to `1.0.1`.

### Optional: ASAR patching
- Still supported with `XENO_UPDATE_STRATEGY=asar`.
- Recommended only for controlled environments.

### Strong recommendation
- Do not overwrite already-published assets in production.
- Publish immutable artifacts to avoid inconsistent client state.
