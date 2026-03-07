# Xeno Launcher Updates

## ES (Espanol)

### Objetivo
- Los usuarios actualizan desde el splash, sin descargar manualmente setup/portable.
- **No se publica ni se activa update global sin tu permiso.**

### Como funciona ahora
Al iniciar (si `XENO_UPDATE_MODE=auto`), el launcher busca updates y aplica este orden:

0. Fuente de update (prioridad):
   - `XENO_UPDATE_MANIFEST_URL`
   - `XENO_UPDATE_REPO`
   - `build.publish` (provider github) en `package.json`
   - `repository` en `package.json`
1. **Setup/Portable (preferido por defecto)**
   - Estrategia default: `XENO_UPDATE_STRATEGY=binary`.
   - Usa `Setup` para instalaciones normales y `Portable` para runtime portable.
   - Aplica update y reinicia el launcher automaticamente.
2. Parche ASAR (opcional)
   - Solo se usa como principal si configuras `XENO_UPDATE_STRATEGY=asar` o `auto`.
   - En `auto`, intenta ASAR y puede recuperar con binario si detecta fallos repetidos.

### Bloqueo de rollout (permiso manual)
Por defecto, la app **no aplica** una release nueva para usuarios si no esta aprobada.

Aprobacion por token:
- Token default: `XENO_PUBLIC_UPDATE`
- La release queda aprobada si ese token aparece en:
  - titulo de release, o
  - tag, o
  - descripcion/body.

Si el token no aparece:
- Los usuarios ven la app normal (no se actualizan).
- El log marca que la build fue bloqueada por aprobacion.

Override solo para pruebas locales del owner:
```powershell
$env:XENO_UPDATE_ALLOW_UNAPPROVED="true"
npm start
```

### Variables utiles
- `XENO_UPDATE_MODE=auto|manual`
- `XENO_UPDATE_STRATEGY=binary|asar|auto` (default: `binary`)
- `XENO_UPDATE_REQUIRE_APPROVAL=true|false` (default: `true`)
- `XENO_UPDATE_APPROVAL_TOKEN=...` (default: `XENO_PUBLIC_UPDATE`)
- `XENO_UPDATE_ALLOW_UNAPPROVED=true` (solo local)
- `XENO_UPDATE_ALLOW_BINARY_FALLBACK=true` (default: `false`)
- `XENO_UPDATE_ALLOW_ASAR_ELEVATION=true|false` (default: `true`)
- `XENO_UPDATE_ENABLE_BINARY_RECOVERY=true|false` (default: `true`)
- `XENO_UPDATE_BINARY_RECOVERY_ATTEMPTS=<n>` (default: `3`)

### Flujo recomendado de release
1. Compilar:
```bash
npm install
npm run build:release:win
```
2. Eso genera en `dist/`:
- `XenoLauncher-Setup-<version>.exe`
- `XenoLauncher-Portable-<version>.exe`
- `XenoLauncher-App-<version>.asar`
3. Crear release en GitHub y subir assets.
4. Pruebas privadas:
- deja la release sin token de aprobacion.
5. Publicar para todos:
- agrega `XENO_PUBLIC_UPDATE` en el body/titulo/tag de la release.

---

## EN (English)

### Goal
- Users update directly from splash, without manually re-downloading setup/portable.
- **No global rollout happens without your permission.**

### Current behavior
On startup (if `XENO_UPDATE_MODE=auto`), launcher checks updates in this order:

0. Update source priority:
   - `XENO_UPDATE_MANIFEST_URL`
   - `XENO_UPDATE_REPO`
   - `build.publish` (github provider) in `package.json`
   - `repository` in `package.json`
1. **Setup/Portable (preferred by default)**
   - Default strategy: `XENO_UPDATE_STRATEGY=binary`.
   - Uses `Setup` for normal installs and `Portable` for portable runtime.
   - Applies update and restarts launcher automatically.
2. ASAR patch (optional)
   - Used as primary only if `XENO_UPDATE_STRATEGY=asar` or `auto`.
   - In `auto`, launcher can still recover to binary update after repeated ASAR failures.

### Rollout lock (manual permission)
By default, app **does not apply** new release for users unless it is approved.

Approval token:
- Default token: `XENO_PUBLIC_UPDATE`
- Release is approved when token exists in:
  - release title, or
  - tag, or
  - release body.

If token is missing:
- Users are not updated.
- Log records update blocked by approval.

Owner-only local testing override:
```powershell
$env:XENO_UPDATE_ALLOW_UNAPPROVED="true"
npm start
```

### Useful env vars
- `XENO_UPDATE_MODE=auto|manual`
- `XENO_UPDATE_STRATEGY=binary|asar|auto` (default: `binary`)
- `XENO_UPDATE_REQUIRE_APPROVAL=true|false` (default: `true`)
- `XENO_UPDATE_APPROVAL_TOKEN=...` (default: `XENO_PUBLIC_UPDATE`)
- `XENO_UPDATE_ALLOW_UNAPPROVED=true` (local only)
- `XENO_UPDATE_ALLOW_BINARY_FALLBACK=true` (default: `false`)
- `XENO_UPDATE_ALLOW_ASAR_ELEVATION=true|false` (default: `true`)
- `XENO_UPDATE_ENABLE_BINARY_RECOVERY=true|false` (default: `true`)
- `XENO_UPDATE_BINARY_RECOVERY_ATTEMPTS=<n>` (default: `3`)

### Recommended release flow
1. Build:
```bash
npm install
npm run build:release:win
```
2. This produces in `dist/`:
- `XenoLauncher-Setup-<version>.exe`
- `XenoLauncher-Portable-<version>.exe`
- `XenoLauncher-App-<version>.asar`
3. Create GitHub release and upload assets.
4. Private testing:
- keep release without approval token.
5. Public rollout:
- add `XENO_PUBLIC_UPDATE` to release body/title/tag.
