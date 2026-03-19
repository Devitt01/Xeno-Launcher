# Xeno Launcher Updates

## ES (Espanol)

### Flujo oficial (sin cambiar version)
- El launcher usa por defecto `legacy + asar`.
- Esto permite publicar parches pequenos sin subir de `1.0.0` a `1.0.1`.
- El splash detecta cambios de build por marcador/hash del asset y aplica el parche.

### Defaults actuales
- `XENO_UPDATE_ENGINE=legacy` (default)
- `XENO_UPDATE_STRATEGY=asar` (default)
- `XENO_UPDATE_MODE=auto` (default)

### Que debes subir para un parche pequeno
1. Genera el asset del app:
```bash
npm run build:asar-asset
```
2. Sube a la release de GitHub el archivo:
- `XenoLauncher-App-1.0.0.asar`

Con eso, la app instalada puede actualizarse sin cambiar version.

### Binarios (setup/portable)
- `XenoLauncher-Setup-1.0.0.exe` y `XenoLauncher-Portable-1.0.0.exe` son para reinstalacion/manual.
- No son necesarios para un parche pequeno de codigo si ya publicaste el `.asar`.

### Modo alterno (requiere cambiar version)
- Solo si lo activas manualmente:
- `XENO_UPDATE_ENGINE=electron`
- Ese modo usa `electron-updater` y si requiere version nueva (`1.0.1`, etc).

---

## EN (English)

### Official flow (no version bump)
- The launcher now defaults to `legacy + asar`.
- This allows small patches without bumping from `1.0.0` to `1.0.1`.
- Splash detects build changes from release asset marker/hash and applies the patch.

### Current defaults
- `XENO_UPDATE_ENGINE=legacy` (default)
- `XENO_UPDATE_STRATEGY=asar` (default)
- `XENO_UPDATE_MODE=auto` (default)

### What to upload for a small patch
1. Build the app asset:
```bash
npm run build:asar-asset
```
2. Upload this file to the GitHub release:
- `XenoLauncher-App-1.0.0.asar`

Installed apps can update without changing version.

### Binary artifacts (setup/portable)
- `XenoLauncher-Setup-1.0.0.exe` and `XenoLauncher-Portable-1.0.0.exe` are for reinstall/manual usage.
- They are not required for a small code patch when `.asar` patching is used.

### Alternate mode (requires version bump)
- Only if manually enabled:
- `XENO_UPDATE_ENGINE=electron`
- This uses `electron-updater` and needs a higher app version (`1.0.1`, etc).
