require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_SECRET = process.env.COOKIE_SECRET;

if (!ADMIN_PASSWORD || !COOKIE_SECRET) {
  throw new Error('Faltan ADMIN_PASSWORD o COOKIE_SECRET en .env');
}

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database', 'efemerides.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS efemerides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha_dia INTEGER NOT NULL CHECK(fecha_dia BETWEEN 1 AND 31),
    fecha_mes INTEGER NOT NULL CHECK(fecha_mes BETWEEN 1 AND 12),
    fecha_anno INTEGER,
    titulo TEXT NOT NULL,
    resumen TEXT NOT NULL,
    imagen BLOB,
    mime_type TEXT,
    creado_en TEXT NOT NULL,
    actualizado_en TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fecha ON efemerides(fecha_mes, fecha_dia);
  CREATE INDEX IF NOT EXISTS idx_fecha_anno ON efemerides(fecha_anno);
`);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      return cb(new Error('Solo se permiten JPG, PNG, WebP o GIF.'));
    }
    cb(null, true);
  }
});

const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

async function processImage(file) {
  if (!file) return null;

  let metadata;
  try {
    metadata = await sharp(file.buffer).metadata();
  } catch {
    throw new Error('El archivo subido no es una imagen válida.');
  }

  if (!ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
    throw new Error('Solo se permiten JPG, PNG, WebP o GIF.');
  }

  try {
    return await sharp(file.buffer)
      .autoOrient()
      .resize({
        width: 1200,
        height: 1200,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new Error('No se pudo procesar la imagen subida.');
  }
}

function sign(value) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
}

function setAuthCookie(res) {
  const value = `admin:${Date.now()}`;
  const signature = sign(value);
  res.setHeader('Set-Cookie', `ef_auth=${encodeURIComponent(value + '.' + signature)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'ef_auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function isAuthenticated(req) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(v => v.trim()).find(v => v.startsWith('ef_auth='));
  if (!match) return false;
  const raw = decodeURIComponent(match.slice('ef_auth='.length));
  const lastDot = raw.lastIndexOf('.');
  if (lastDot < 0) return false;
  const value = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);
  const expected = sign(value);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) && value.startsWith('admin:');
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

function normalizeDate(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = year === '' || year === undefined || year === null ? null : Number(year);
  if (!Number.isInteger(d) || d < 1 || d > 31) throw new Error('Día inválido.');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('Mes inválido.');
  if (y !== null && (!Number.isInteger(y) || y < 1 || y > 9999)) throw new Error('Año inválido.');
  return { d, m, y };
}

function publicRecord(row, includeImage = false) {
  const record = {
    id: row.id,
    fecha_dia: row.fecha_dia,
    fecha_mes: row.fecha_mes,
    fecha_anno: row.fecha_anno,
    titulo: row.titulo,
    resumen: row.resumen,
    imagen_url: row.imagen ? `/api/efemerides/${row.id}/imagen` : null,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en
  };
  if (includeImage && row.imagen) {
    record.imagen_base64 = `data:${row.mime_type};base64,${row.imagen.toString('base64')}`;
  }
  return record;
}

// Auth
app.post('/api/auth/login', (req, res) => {
  const password = String(req.body.password || '');
  if (!crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD))) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  setAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

// Public API

// Ruta específica para obtener imagen por ID - DEBE IR ANTES de rutas genéricas
app.get('/api/efemerides/:id/imagen', (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido.' });
  }

  const row = db.prepare('SELECT imagen, mime_type FROM efemerides WHERE id = ?').get(id);

  if (!row || !row.imagen) {
    return res.status(404).json({ error: 'Imagen no encontrada.' });
  }

  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(row.imagen);
});

app.get('/api/efemerides', (req, res) => {
  const { mes, dia, anno, limite } = req.query;
  let sql = 'SELECT * FROM efemerides';
  const where = [];
  const params = {};

  if (mes !== undefined) { where.push('fecha_mes = @mes'); params.mes = Number(mes); }
  if (dia !== undefined) { where.push('fecha_dia = @dia'); params.dia = Number(dia); }
  if (anno !== undefined) { where.push('fecha_anno = @anno'); params.anno = Number(anno); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY fecha_mes, fecha_dia, fecha_anno';
  if (limite !== undefined) sql += ' LIMIT ' + Math.min(Math.max(Number(limite) || 1, 1), 1000);

  const rows = db.prepare(sql).all(params);
  res.json({ total: rows.length, efemerides: rows.map(r => publicRecord(r)) });
});

app.get('/api/efemerides/hoy', (req, res) => {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const rows = db.prepare(`SELECT * FROM efemerides WHERE fecha_dia = ? AND fecha_mes = ? ORDER BY fecha_anno`).all(day, month);
  res.json({ fecha: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`, total: rows.length, efemerides: rows.map(r => publicRecord(r)) });
});

app.get('/api/efemerides/anno/:anno', (req, res) => {
  const anno = Number(req.params.anno);
  if (!Number.isInteger(anno) || anno < 1 || anno > 9999) return res.status(400).json({ error: 'Año inválido.' });
  const rows = db.prepare('SELECT * FROM efemerides WHERE fecha_anno = ? ORDER BY fecha_mes, fecha_dia').all(anno);
  res.json({ anno, total: rows.length, efemerides: rows.map(r => publicRecord(r)) });
});

app.get('/api/efemerides/:mes/:dia/:anno', (req, res) => {
  const month = Number(req.params.mes);
  const day = Number(req.params.dia);
  const year = Number(req.params.anno);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31 || year < 1 || year > 9999) {
    return res.status(400).json({ error: 'Fecha inválida.' });
  }
  const rows = db.prepare('SELECT * FROM efemerides WHERE fecha_mes = ? AND fecha_dia = ? AND fecha_anno = ? ORDER BY id').all(month, day, year);
  res.json({ fecha: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`, total: rows.length, efemerides: rows.map(r => publicRecord(r)) });
});

app.get('/api/efemerides/:mes/:dia', (req, res) => {
  const month = Number(req.params.mes);
  const day = Number(req.params.dia);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return res.status(400).json({ error: 'Fecha inválida.' });
  const rows = db.prepare('SELECT * FROM efemerides WHERE fecha_dia = ? AND fecha_mes = ? ORDER BY fecha_anno').all(day, month);
  res.json({ fecha: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`, total: rows.length, efemerides: rows.map(r => publicRecord(r)) });
});

// Admin API
app.get('/api/admin/efemerides', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, fecha_dia, fecha_mes, fecha_anno, titulo, resumen, mime_type, creado_en, actualizado_en, imagen IS NOT NULL AS tiene_imagen FROM efemerides ORDER BY fecha_mes, fecha_dia, fecha_anno DESC').all();
  res.json({ total: rows.length, efemerides: rows });
});

app.post('/api/admin/efemerides', requireAuth, upload.single('imagen'), async (req, res) => {
  try {
    const { d, m, y } = normalizeDate(req.body.fecha_dia, req.body.fecha_mes, req.body.fecha_anno);
    const titulo = String(req.body.titulo || '').trim();
    const resumen = String(req.body.resumen || '').trim();
    if (!titulo || !resumen) return res.status(400).json({ error: 'Título y resumen son obligatorios.' });
    const imagen = await processImage(req.file);
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO efemerides (fecha_dia, fecha_mes, fecha_anno, titulo, resumen, imagen, mime_type, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d, m, y, titulo, resumen, imagen, imagen ? 'image/webp' : null, now, now);
    res.status(201).json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/efemerides/:id', requireAuth, upload.single('imagen'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM efemerides WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'Efeméride no encontrada.' });
    const { d, m, y } = normalizeDate(req.body.fecha_dia, req.body.fecha_mes, req.body.fecha_anno);
    const titulo = String(req.body.titulo || '').trim();
    const resumen = String(req.body.resumen || '').trim();
    if (!titulo || !resumen) return res.status(400).json({ error: 'Título y resumen son obligatorios.' });
    const now = new Date().toISOString();
    const processedImage = await processImage(req.file);
    const imagen = processedImage || current.imagen;
    const mime = processedImage ? 'image/webp' : current.mime_type;
    db.prepare(`UPDATE efemerides SET fecha_dia=?, fecha_mes=?, fecha_anno=?, titulo=?, resumen=?, imagen=?, mime_type=?, actualizado_en=? WHERE id=?`).run(d, m, y, titulo, resumen, imagen, mime, now, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/efemerides/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM efemerides WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Efeméride no encontrada.' });
  res.json({ ok: true });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) return res.status(400).json({ error: err.message || 'Error de servidor.' });
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Efemérides escuchando en http://0.0.0.0:${PORT}`);
});
