# Efemérides Cristianas

Proyecto ligero para administrar efemérides cristianas históricas y ofrecerlas mediante una API pública.

## Stack

- Node.js
- Express
- SQLite (`better-sqlite3`)
- Sharp para normalizar las imágenes a WebP
- HTML/CSS/JavaScript puro

## Estructura

- `app.js`: servidor, API y creación automática de SQLite.
- `database/efemerides.db`: base de datos con las efemérides e imágenes BLOB.
- `public/`: frontend y panel de administración.
- `scripts/backup-github.sh`: publicación diaria de la base en GitHub.

## Instalación

```bash
npm install
node app.js
```

Abrir `http://IP-DEL-VPS:3000/` y el panel en `http://IP-DEL-VPS:3000/admin`.

La contraseña inicial está en `.env` y debe cambiarse antes de publicar el servidor.

Las imágenes subidas desde el panel pueden ser JPEG/JPG, PNG, WebP o GIF. Antes de
guardarlas como BLOB, el servidor limita sus dimensiones a 1200 px conservando la
proporción y las convierte a WebP con calidad 80.

## API

```text
GET /api/efemerides/hoy
GET /api/efemerides/08/12
GET /api/efemerides/08/12/1515
GET /api/efemerides/anno/1515
GET /api/efemerides?mes=8&dia=12
GET /api/efemerides?anno=1515
GET /api/efemerides/15/imagen
```

## GitHub

El repositorio debe configurarse con un remoto `origin` y autenticación SSH. El script diario solo hace commit si `database/efemerides.db` cambió.
