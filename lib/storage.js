const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const LEGACY_DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LEGACY_UPLOADS_DIR = path.join(PROJECT_ROOT, 'public', 'uploads');

// Persistent data lives outside the application folder so replacing the ZIP
// does not delete the library's data or uploaded images.
const STORAGE_DIR = process.env.SIPUS_DATA_DIR
  ? path.resolve(process.env.SIPUS_DATA_DIR)
  : path.join(os.homedir(), 'SIPUS-SMK-Ibu-Kartini-data');

const DATA_DIR = path.join(STORAGE_DIR, 'data');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const COVER_DIR = path.join(UPLOADS_DIR, 'covers');
const MEMBER_DIR = path.join(UPLOADS_DIR, 'members');
const MIGRATION_VERSION = 5;
const MARKER = path.join(STORAGE_DIR, '.migration');

const DATA_FILES = [
  'books.json', 'members.json', 'loans.json', 'copies.json',
  'categories.json', 'users.json', 'sessions.json', 'audit.json',
  'site.json', 'registration_requests.json'
];

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function safeReadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function atomicWrite(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function copyIfMissing(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
  return true;
}
function copyTreeIfMissing(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const s = path.join(sourceDir, entry.name);
    const t = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyTreeIfMissing(s, t);
    else if (entry.isFile()) copyIfMissing(s, t);
  }
}
function mimeFromExt(ext) {
  return ({ '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' })[String(ext).toLowerCase()] || 'application/octet-stream';
}
function migrateEmbeddedImages() {
  const booksFile = path.join(DATA_DIR, 'books.json');
  const books = safeReadJSON(booksFile, []);
  let changed = false;
  for (const book of books) {
    if (book.coverData) continue;
    const cover = String(book.cover || '');
    if (!/^\/uploads\/covers\//i.test(cover)) continue;
    const filename = path.basename(cover);
    const candidates = [
      path.join(COVER_DIR, filename),
      path.join(LEGACY_UPLOADS_DIR, 'covers', filename)
    ];
    const file = candidates.find(fs.existsSync);
    if (!file) continue;
    try {
      book.coverData = fs.readFileSync(file).toString('base64');
      book.coverMime = mimeFromExt(path.extname(file));
      book.coverUpdatedAt = new Date().toISOString();
      changed = true;
      copyIfMissing(file, path.join(COVER_DIR, filename));
    } catch (_) {}
  }
  if (changed) atomicWrite(booksFile, books);

  const membersFile = path.join(DATA_DIR, 'members.json');
  const members = safeReadJSON(membersFile, []);
  changed = false;
  for (const member of members) {
    if (member.photoData) continue;
    const photo = String(member.photo || '');
    if (!/^\/uploads\/members\//i.test(photo)) continue;
    const filename = path.basename(photo);
    const candidates = [
      path.join(MEMBER_DIR, filename),
      path.join(LEGACY_UPLOADS_DIR, 'members', filename)
    ];
    const file = candidates.find(fs.existsSync);
    if (!file) continue;
    try {
      member.photoData = fs.readFileSync(file).toString('base64');
      member.photoMime = mimeFromExt(path.extname(file));
      member.photoUpdatedAt = new Date().toISOString();
      changed = true;
      copyIfMissing(file, path.join(MEMBER_DIR, filename));
    } catch (_) {}
  }
  if (changed) atomicWrite(membersFile, members);
}
function normalizeUsers() {
  const file = path.join(DATA_DIR, 'users.json');
  let users = safeReadJSON(file, []);
  let admins = users.filter(u => u?.role === 'admin');
  const petugas = users.filter(u => u?.role === 'petugas');
  // Keep exactly one built-in admin. If the persistent file is empty/corrupt,
  // recover the seeded admin from the application package.
  if (!admins.length) {
    const seedUsers = safeReadJSON(path.join(LEGACY_DATA_DIR, 'users.json'), []);
    const seededAdmin = seedUsers.find(u => u?.role === 'admin');
    if (seededAdmin) admins = [seededAdmin];
  }
  if (admins.length > 1) admins = [admins[0]];
  const normalized = [...admins, ...petugas];
  if (JSON.stringify(users) !== JSON.stringify(normalized)) atomicWrite(file, normalized);
}
function clearSessions() { atomicWrite(path.join(DATA_DIR, 'sessions.json'), {}); }
function clearPublicRegistration() { atomicWrite(path.join(DATA_DIR, 'registration_requests.json'), []); }

function initStorage() {
  ensureDir(STORAGE_DIR); ensureDir(DATA_DIR); ensureDir(COVER_DIR); ensureDir(MEMBER_DIR);
  for (const file of DATA_FILES) copyIfMissing(path.join(LEGACY_DATA_DIR, file), path.join(DATA_DIR, file));
  copyTreeIfMissing(LEGACY_UPLOADS_DIR, UPLOADS_DIR);
  migrateEmbeddedImages();
  normalizeUsers();
  // The latest project design does not expose member self-registration.
  clearPublicRegistration();
  // Clear stale sessions when a newer application build is installed.
  const marker = safeReadJSON(MARKER, { version: 0 });
  if (Number(marker.version || 0) < MIGRATION_VERSION) {
    clearSessions();
    atomicWrite(MARKER, { migratedAt: new Date().toISOString(), version: MIGRATION_VERSION });
  }
}

initStorage();

module.exports = {
  PROJECT_ROOT, LEGACY_DATA_DIR, LEGACY_UPLOADS_DIR,
  STORAGE_DIR, DATA_DIR, UPLOADS_DIR, COVER_DIR, MEMBER_DIR,
  DATA_FILES, initStorage, atomicWrite, ensureDir, mimeFromExt
};
