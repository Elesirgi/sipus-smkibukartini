const express = require('express');
const path = require('path');
const compression = require('compression');
const fs = require('fs');
const db = require('./lib/data');
const auth = require('./lib/auth');
const storage = require('./lib/storage');
const pagesRouter = require('./routes/pages');
const adminRouter = require('./routes/admin');
const authRouter = require('./routes/auth');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;

// Normalize the persistent dataset at startup. Existing admin changes are preserved.
db.normalizeUserData();
db.rehydrateMediaFiles();
db.ensureBookSlugs();
db.syncCopies();
db.recalculateAvailability();

process.on('uncaughtException', err => console.error('[SIPUS] Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('[SIPUS] Unhandled rejection:', err));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(compression());
app.use(express.urlencoded({ extended: true, limit: '128mb' }));
app.use(express.json({ limit: '128mb' }));

// Public static assets. Uploaded files are primarily served through JSON-aware endpoints below.
app.use('/uploads', express.static(storage.UPLOADS_DIR, { etag: false, maxAge: 0 }));
app.use(express.static(path.join(__dirname, 'public'), { etag: true }));

app.get('/book-cover/:id', (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!book) return res.status(404).end();
  try {
    if (book.coverData) {
      const mime = ['image/jpeg','image/png','image/webp'].includes(book.coverMime) ? book.coverMime : 'image/jpeg';
      const buffer = Buffer.from(book.coverData, 'base64');
      res.set({ 'Content-Type': mime, 'Content-Length': buffer.length, 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options':'nosniff' });
      return res.send(buffer);
    }
    const legacy = String(book.cover || '');
    if (/^\/uploads\/covers\//i.test(legacy)) {
      const filename = path.basename(legacy);
      const candidates = [
        path.join(storage.COVER_DIR, filename),
        path.join(storage.LEGACY_UPLOADS_DIR, 'covers', filename),
        path.join(storage.PROJECT_ROOT, 'public', 'uploads', 'covers', filename)
      ];
      const localPath = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (localPath) {
        const mime = storage.mimeFromExt(path.extname(localPath));
        // Backfill missing embedded cover data so an uploaded image remains portable.
        if (!book.coverData) {
          try {
            const books = db.getBooks();
            const idx = books.findIndex(b => String(b.id).trim().toLowerCase() === String(book.id).trim().toLowerCase());
            if (idx >= 0) {
              books[idx].coverData = fs.readFileSync(localPath).toString('base64');
              books[idx].coverMime = mime;
              books[idx].coverUpdatedAt = new Date().toISOString();
              db.writeDataFile('books.json', books);
            }
          } catch (syncErr) { console.error('[SIPUS] Gagal menanam cover ke JSON:', syncErr); }
        }
        res.set({ 'Content-Type': mime, 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options':'nosniff' });
        return res.sendFile(localPath);
      }
    }
    if (/^https?:\/\//i.test(legacy)) return res.redirect(302, legacy);
    return res.status(404).end();
  } catch (e) {
    console.error('[SIPUS] Cover error:', e);
    return res.status(500).end();
  }
});

app.get('/member-photo/:id', (req, res) => {
  const member = db.getMemberById(req.params.id);
  if (!member || !member.photoData) return res.status(404).end();
  try {
    const mime = ['image/jpeg','image/png','image/webp'].includes(member.photoMime) ? member.photoMime : 'image/jpeg';
    const buffer = Buffer.from(member.photoData, 'base64');
    res.set({ 'Content-Type': mime, 'Content-Length': buffer.length, 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options':'nosniff' });
    return res.send(buffer);
  } catch (e) {
    console.error('[SIPUS] Member photo error:', e);
    return res.status(500).end();
  }
});

app.use((req, res, next) => {
  res.locals.site = db.getSite();
  res.locals.currentPath = req.path;
  res.locals.formatDateID = db.formatDateID;
  res.locals.user = auth.getSessionUser(req);
  req.user = res.locals.user;
  next();
});

function requireAdmin(req, res, next) {
  if (res.locals.user?.role === 'admin') return next();
  if (!res.locals.user) return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  return res.status(403).render('404', { title: 'Akses Ditolak', message: 'Halaman ini hanya dapat diakses oleh Admin.' });
}

app.use('/', authRouter);
app.use('/admin', requireAdmin, adminRouter);
app.use('/', pagesRouter);

app.use((req, res) => res.status(404).render('404', { title: 'Halaman Tidak Ditemukan' }));
app.use((err, req, res, next) => {
  console.error('[SIPUS] Request error:', err);
  if (res.headersSent) return next(err);
  res.status(500).render('404', { title: 'Terjadi Kesalahan', message: 'Terjadi kesalahan saat memproses permintaan.' });
});

app.listen(PORT, () => console.log(`SIPUS - Sistem Informasi Perpustakaan berjalan di http://localhost:${PORT}`));
