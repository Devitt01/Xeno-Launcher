# Xeno Skin Hub - Guia / Guide

## ES (Espanol)

Si quieres skins compartidas para todos (no-premium), necesitas un servicio online.

### Opcion A: sin servidor (mas facil)

- No haces nada.
- El launcher funciona en modo local.
- No hay skins compartidas globales.

### Opcion B: servidor publico (recomendado si quieres skins globales)

#### 1) Despliegue rapido (ejemplo Render)

1. Sube este proyecto a GitHub.
2. En Render crea un **Web Service** desde tu repo.
3. Configura:
   - Build Command: `npm install`
   - Start Command: `node skin-hub-server.js`
4. Variables de entorno:
   - `XENO_SKIN_HOST=0.0.0.0`
   - `XENO_SKIN_TOKEN=pon_un_token_largo` (opcional pero recomendado)
5. Deploy.
6. Copia tu URL publica (ejemplo: `https://xeno-skin-hub.onrender.com`).

Nota: el servidor ya soporta `PORT` automaticamente.

#### 2) Probar que el hub funciona

Abre en navegador:

- `https://TU_URL/status`

Debe responder JSON con `status: "ok"`.

#### 3) Conectar launcher al hub

En Xeno Launcher > Configuracion:

- Servicio de skins compartidas (URL): `https://TU_URL`
- Token de escritura: el mismo que pusiste en `XENO_SKIN_TOKEN` (si usaste token)
- Guardar.

#### 4) Comportamiento actual

- Si un username ya existe en skins compartidas: login bloqueado.
- Si no puede verificarse el servicio y configuraste URL manual: bloquea login para evitar suplantacion.
- Si no configuras URL manual: el launcher puede seguir en modo local.

### Variables disponibles

- `XENO_SKIN_PORT` (opcional, default: `PORT` o `52735`)
- `XENO_SKIN_HOST` (default: `0.0.0.0`)
- `XENO_SKIN_DATA_DIR` (default: `./skin-hub-data`)
- `XENO_SKIN_TOKEN` (protege escrituras)
- `XENO_SKIN_BASE_URL` (si quieres forzar URL publica de texturas)

---

## EN (English)

If you want shared skins for everyone (non-premium), you need an online service.

### Option A: no server (easiest)

- Do nothing.
- The launcher works in local mode.
- No global shared skins.

### Option B: public server (recommended for global shared skins)

#### 1) Quick deploy (Render example)

1. Push this project to GitHub.
2. In Render, create a **Web Service** from your repo.
3. Configure:
   - Build Command: `npm install`
   - Start Command: `node skin-hub-server.js`
4. Environment variables:
   - `XENO_SKIN_HOST=0.0.0.0`
   - `XENO_SKIN_TOKEN=use_a_long_token` (optional but recommended)
5. Deploy.
6. Copy your public URL (example: `https://xeno-skin-hub.onrender.com`).

Note: the server already supports `PORT` automatically.

#### 2) Verify hub is running

Open in browser:

- `https://YOUR_URL/status`

It should return JSON with `status: "ok"`.

#### 3) Connect launcher to the hub

In Xeno Launcher > Settings:

- Shared skin service URL: `https://YOUR_URL`
- Write token: same value as `XENO_SKIN_TOKEN` (if used)
- Save.

#### 4) Current behavior

- If a username already exists in shared skins: login is blocked.
- If service verification fails and a manual URL is configured: login is blocked to prevent impersonation.
- If no manual URL is configured: launcher can continue in local mode.

### Available environment variables

- `XENO_SKIN_PORT` (optional, default: `PORT` or `52735`)
- `XENO_SKIN_HOST` (default: `0.0.0.0`)
- `XENO_SKIN_DATA_DIR` (default: `./skin-hub-data`)
- `XENO_SKIN_TOKEN` (protects write operations)
- `XENO_SKIN_BASE_URL` (force public textures base URL if needed)
