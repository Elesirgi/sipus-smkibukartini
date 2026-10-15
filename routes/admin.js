const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const router = express.Router();
const db = require('../lib/data');
const auth = require('../lib/auth');
const storage = require('../lib/storage');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('File harus berupa JPG, PNG, atau WEBP.'));
  }
});
const coverUpload = imageUpload.single('coverFile');
const memberPhotoUpload = imageUpload.single('photoFile');

function saveUploadedImage(file, dir, prefix) {
  const ext = storage.mimeFromExt(file.mimetype === 'image/jpeg' ? '.jpg' : `.${file.mimetype.split('/')[1]}`);
  const extension = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : '.webp';
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
  const filePath = require('path').join(dir, filename);
  storage.ensureDir(dir);
  fs.writeFileSync(filePath, file.buffer);
  return { filename, path: `/uploads/${dir === storage.COVER_DIR ? 'covers' : 'members'}/${filename}`, data: file.buffer.toString('base64'), mime: file.mimetype, updatedAt: new Date().toISOString() };
}
function renderBookForm(res, { book = null, error = null, formAction }) {
  return res.status(error ? 400 : 200).render('admin/buku-form', {
    title: `${book ? 'Edit Buku' : 'Tambah Buku'} — ${res.locals.site.libraryName}`,
    book, categories: db.getCategories(), formAction, error
  });
}
function renderMemberForm(res, { member = null, error = null, formAction }) {
  return res.status(error ? 400 : 200).render('admin/anggota-form', {
    title: `${member ? 'Edit Anggota' : 'Tambah Anggota Baru'} — ${res.locals.site.libraryName}`,
    member, error, formAction
  });
}

router.get('/', (req, res) => {
  const stats = db.getStats();
  const loans = db.getEnrichedLoans();
  res.render('admin/home', {
    title: `Panel Admin — ${res.locals.site.libraryName}`,
    stats,
    overdueLoans: loans.filter(l => l.status === 'terlambat').slice(0, 6)
  });
});

router.get('/petugas', (req, res) => {
  const users = auth.getUsers().map(u => ({ username: u.username, name: u.name, role: u.role, active: u.active !== false }));
  res.render('admin/petugas', { title: `Kelola Petugas — ${res.locals.site.libraryName}`, users, error: null });
});
router.post('/petugas/tambah', (req, res) => {
  const result = auth.registerStaff(req.body);
  if (result.error) return res.status(400).render('admin/petugas', { title: `Kelola Petugas — ${res.locals.site.libraryName}`, users: auth.getUsers(), error: result.error });
  db.addAudit(res.locals.user, 'Tambah Petugas', result.user.username);
  res.redirect('/admin/petugas');
});
router.post('/petugas/:username/status', (req, res) => {
  if (req.params.username === 'admin') return res.redirect('/admin/petugas');
  auth.updateUser(req.params.username, { active: req.body.active === 'true' });
  db.addAudit(res.locals.user, 'Ubah Status Petugas', req.params.username);
  res.redirect('/admin/petugas');
});
router.post('/petugas/:username/reset', (req, res) => {
  const pwd = String(req.body.password || '');
  if (pwd.length < 6) return res.redirect('/admin/petugas');
  auth.updateUser(req.params.username, { passwordHash: auth.hashPassword(pwd), active: true });
  db.addAudit(res.locals.user, 'Reset Password Petugas', req.params.username);
  res.redirect('/admin/petugas');
});

router.get('/kategori', (req, res) => res.render('admin/kategori', {
  title: `Kelola Kategori — ${res.locals.site.libraryName}`,
  categories: db.getCategories(), error: req.query.error || null
}));
router.post('/kategori/tambah', (req, res) => {
  const result = db.addCategory(req.body);
  if (result.error) return res.redirect(`/admin/kategori?error=${encodeURIComponent(result.error)}`);
  db.addAudit(res.locals.user, 'Tambah Kategori', result.category.name);
  res.redirect('/admin/kategori');
});
router.post('/kategori/:slug/hapus', (req, res) => {
  const category = db.getCategoryBySlug(req.params.slug);
  if (!category) return res.redirect('/admin/kategori');
  if (db.getBooks().some(b => b.category === category.slug)) return res.redirect(`/admin/kategori?error=${encodeURIComponent('Kategori masih digunakan oleh buku.')}`);
  const rows = db.getCategories().filter(c => c.slug !== category.slug);
  db.writeDataFile('categories.json', rows);
  db.addAudit(res.locals.user, 'Hapus Kategori', category.name);
  res.redirect('/admin/kategori');
});

const SORTABLE_FIELDS = {
  title: b => String(b.title || '').toLowerCase(), author: b => String(b.author || '').toLowerCase(),
  category: b => String(b.category || '').toLowerCase(), stock: b => Number(b.availableCopies || 0),
  shelfLocation: b => String(b.shelfLocation || '').toLowerCase(), dateAdded: b => b.dateAdded || ''
};
router.get('/buku', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const sort = SORTABLE_FIELDS[req.query.sort] ? req.query.sort : 'title';
  const dir = req.query.dir === 'desc' ? 'desc' : 'asc';
  const copies = db.syncCopies();
  let books = db.getBooks().map(b => ({ ...b, borrowedCopies: copies.filter(c => c.bookId === b.id && c.status === 'dipinjam').length }));
  if (q) books = books.filter(b => [b.title,b.author,b.isbn,b.inventoryCode,b.shelfLocation,b.subject,b.grade].join(' ').toLowerCase().includes(q));
  const key = SORTABLE_FIELDS[sort];
  books.sort((a,b) => key(a) < key(b) ? (dir === 'asc' ? -1 : 1) : key(a) > key(b) ? (dir === 'asc' ? 1 : -1) : 0);
  res.render('admin/buku-list', { title: `Kelola Buku — ${res.locals.site.libraryName}`, books, sort, dir, query: q, error: req.query.error || null });
});
router.get('/buku/tambah', (req, res) => renderBookForm(res, { formAction: '/admin/buku/tambah' }));
router.get('/buku/:id', (req, res, next) => {
  const identifier = String(req.params.id || '').trim();
  const book = db.getBookById(identifier) || db.getBookBySlug(identifier);
  if (!book) return next();
  return res.redirect(`/admin/buku/${encodeURIComponent(book.id)}/edit`);
});
router.post('/buku/tambah', coverUpload, (req, res) => {
  try {
    if (!req.file) return renderBookForm(res, { book: req.body, formAction: '/admin/buku/tambah', error: 'Cover buku wajib diupload.' });
    const media = saveUploadedImage(req.file, storage.COVER_DIR, 'cover');
    const book = db.addBook({ ...req.body, cover: media.path, coverData: media.data, coverMime: media.mime, coverUpdatedAt: media.updatedAt });
    if (book?.error) return renderBookForm(res, { book: req.body, formAction: '/admin/buku/tambah', error: book.error });
    db.addAudit(res.locals.user, 'Tambah Buku', book.title);
    res.redirect('/admin/buku');
  } catch (e) {
    console.error('[SIPUS] Gagal tambah buku:', e);
    renderBookForm(res, { book: req.body, formAction: '/admin/buku/tambah', error: e.message || 'Gagal menambah buku.' });
  }
});
router.get('/buku/:id/edit', (req, res) => {
  const identifier = String(req.params.id || '').trim();
  const book = db.getBookById(identifier) || db.getBookBySlug(identifier);
  if (!book) return res.redirect(`/admin/buku?error=${encodeURIComponent(`Buku ${identifier} tidak ditemukan. Periksa daftar buku yang sedang tersimpan.`)}`);
  renderBookForm(res, { book, formAction: `/admin/buku/${encodeURIComponent(book.id)}/edit` });
});
router.post('/buku/:id/edit', coverUpload, (req, res) => {
  const identifier = String(req.params.id || '').trim();
  const bookBefore = db.getBookById(identifier) || db.getBookBySlug(identifier);
  if (!bookBefore) return res.redirect(`/admin/buku?error=${encodeURIComponent(`Buku ${identifier} tidak ditemukan. Tidak ada perubahan yang disimpan.`)}`);
  try {
    const payload = { ...req.body };
    if (req.file) {
      const media = saveUploadedImage(req.file, storage.COVER_DIR, 'cover');
      payload.cover = media.path; payload.coverData = media.data; payload.coverMime = media.mime; payload.coverUpdatedAt = media.updatedAt;
    }
    const book = db.updateBook(req.params.id, payload);
    db.addAudit(res.locals.user, 'Edit Buku', book.id);
    res.redirect('/admin/buku');
  } catch (e) {
    console.error('[SIPUS] Gagal edit buku:', e);
    renderBookForm(res, { book: { ...bookBefore, ...req.body }, formAction: `/admin/buku/${encodeURIComponent(bookBefore.id)}/edit`, error: e.message || 'Gagal menyimpan buku.' });
  }
});
router.post('/buku/:id/hapus', (req, res) => {
  const ok = db.deleteBook(req.params.id);
  if (ok) db.addAudit(res.locals.user, 'Hapus Buku', req.params.id);
  res.redirect(`/admin/buku${ok ? '' : `?error=${encodeURIComponent('Buku tidak dapat dihapus karena memiliki riwayat transaksi.')}`}`);
});
router.get('/buku/:id/eksemplar', (req, res, next) => {
  const book = db.getBookById(req.params.id); if (!book) return next();
  res.render('admin/eksemplar', { title: `Eksemplar — ${book.title}`, book, copies: db.syncCopies().filter(c => c.bookId === book.id), error: req.query.error || null, message: req.query.success || null });
});
router.post('/buku/:id/eksemplar/jumlah', (req, res) => {
  const result = db.resizeBookCopies(req.params.id, req.body.totalCopies);
  if (result.error) return res.redirect(`/admin/buku/${encodeURIComponent(req.params.id)}/eksemplar?error=${encodeURIComponent(result.error)}`);
  db.addAudit(res.locals.user, 'Ubah Jumlah Eksemplar', `${result.book.id} → ${result.book.totalCopies}`);
  res.redirect(`/admin/buku/${encodeURIComponent(req.params.id)}/eksemplar?success=${encodeURIComponent(`Jumlah eksemplar: ${result.book.totalCopies}.`)}`);
});
router.post('/eksemplar/:copyId/kondisi', (req, res) => {
  db.setCopyCondition(req.params.copyId, req.body.condition, res.locals.user);
  res.redirect(req.get('referer') || '/admin/buku');
});

router.get('/anggota', (req, res) => {
  const q=String(req.query.q||'').trim().toLowerCase(); let members=db.getMembers();
  if(q)members=members.filter(m=>[m.name,m.id,m.kelas,m.role,m.nisn,m.email].join(' ').toLowerCase().includes(q));
  res.render('admin/anggota-list',{title:`Kelola Anggota — ${res.locals.site.libraryName}`,members,query:q,error:req.query.error||null});
});
router.get('/anggota/tambah', (req,res)=>renderMemberForm(res,{formAction:'/admin/anggota/tambah'}));
router.post('/anggota/tambah', memberPhotoUpload, (req,res)=>{
  try{
    if(!req.file)return renderMemberForm(res,{member:req.body,formAction:'/admin/anggota/tambah',error:'Foto anggota wajib diupload.'});
    const media=saveUploadedImage(req.file,storage.MEMBER_DIR,'member');
    const member=db.addMember({...req.body,photo:media.path,photoData:media.data,photoMime:media.mime,photoUpdatedAt:media.updatedAt});
    if(member?.error)return renderMemberForm(res,{member:req.body,formAction:'/admin/anggota/tambah',error:member.error});
    db.addAudit(res.locals.user,'Tambah Anggota',`${member.id} / ${member.name}`);res.redirect('/admin/anggota');
  }catch(e){console.error('[SIPUS] Gagal tambah anggota:',e);renderMemberForm(res,{member:req.body,formAction:'/admin/anggota/tambah',error:e.message||'Gagal menambah anggota.'});}
});
router.get('/anggota/:id/edit',(req,res,next)=>{const member=db.getMemberById(req.params.id);if(!member)return next();renderMemberForm(res,{member,formAction:`/admin/anggota/${encodeURIComponent(member.id)}/edit`});});
router.post('/anggota/:id/edit',memberPhotoUpload,(req,res)=>{
  const before=db.getMemberById(req.params.id); if(!before)return res.redirect('/admin/anggota');
  try{const payload={...req.body};if(req.file){const media=saveUploadedImage(req.file,storage.MEMBER_DIR,'member');payload.photo=media.path;payload.photoData=media.data;payload.photoMime=media.mime;payload.photoUpdatedAt=media.updatedAt;}const member=db.updateMember(req.params.id,payload);if(!member)throw new Error('Anggota tidak ditemukan.');db.addAudit(res.locals.user,'Edit Anggota',member.id);res.redirect('/admin/anggota');}catch(e){renderMemberForm(res,{member:{...before,...req.body},formAction:`/admin/anggota/${encodeURIComponent(before.id)}/edit`,error:e.message||'Gagal menyimpan anggota.'});}
});
router.post('/anggota/:id/hapus',(req,res)=>{const ok=db.deleteMember(req.params.id);if(ok)db.addAudit(res.locals.user,'Hapus Anggota',req.params.id);res.redirect(`/admin/anggota${ok?'':`?error=${encodeURIComponent('Anggota tidak dapat dihapus karena memiliki riwayat peminjaman.')}`}`);});

router.get('/sirkulasi',(req,res)=>{
  const copies=db.syncCopies();
  const books=db.getBooks().map(b=>({...b,availableCopies:copies.filter(c=>c.bookId===b.id&&c.status==='tersedia'&&!['hilang','rusak berat'].includes(c.condition)).length})).filter(b=>b.availableCopies>0);
  const members=db.getMembers().filter(m=>m.status==='aktif'); const loans=db.getEnrichedLoans();
  res.render('admin/sirkulasi',{title:`Sirkulasi — ${res.locals.site.libraryName}`,books,members,loans,activeLoans:loans.filter(l=>l.status!=='dikembalikan'),message:req.query.success||null,error:req.query.error||null,limit:db.MAX_ACTIVE_LOANS});
});
router.post('/sirkulasi/pinjam',(req,res)=>{
  const memberId=String(req.body.memberId||'').trim(); const quantities=req.body.quantities||{};
  const selections=Object.entries(quantities).map(([bookId,qty])=>({bookId,quantity:Math.max(0,parseInt(qty,10)||0)})).filter(x=>x.quantity>0);
  if(!memberId||!selections.length)return res.redirect(`/admin/sirkulasi?error=${encodeURIComponent('Pilih anggota dan minimal satu buku.')}`);
  const member=db.getMemberById(memberId); if(!member||member.status!=='aktif')return res.redirect(`/admin/sirkulasi?error=${encodeURIComponent('Anggota tidak aktif atau tidak ditemukan.')}`);
  const activeBefore=db.getLoans().filter(l=>l.memberId===memberId&&!l.returnDate).length; let remaining=Math.max(0,db.MAX_ACTIVE_LOANS-activeBefore);const successes=[],failures=[];
  for(const selection of selections){if(remaining<=0){failures.push(`Batas ${db.MAX_ACTIVE_LOANS} buku aktif tercapai.`);break;}const book=db.getBookById(selection.bookId);if(!book){failures.push(`${selection.bookId} tidak ditemukan.`);continue;}const available=db.getCopies().filter(c=>c.bookId===book.id&&c.status==='tersedia'&&!['hilang','rusak berat'].includes(c.condition)).length;const qty=Math.min(selection.quantity,available,remaining);if(qty<=0){failures.push(`${book.title}: tidak ada eksemplar layak atau kuota habis.`);continue;}const result=db.createLoans(book.id,memberId,qty,{days:db.LOAN_DAYS,user:res.locals.user});if(result.count){successes.push(`${book.title} ×${result.count}`);remaining-=result.count;}if(result.failures.length)failures.push(`${book.title}: ${result.failures[0].error}`);}
  const msg=[successes.length?`Berhasil: ${successes.join(', ')}.`:'',failures.length?`Catatan: ${failures.join(' ')}`:''].filter(Boolean).join(' ');res.redirect(successes.length?`/admin/sirkulasi?success=${encodeURIComponent(msg)}`:`/admin/sirkulasi?error=${encodeURIComponent(msg||'Peminjaman gagal.')}`);
});

router.post('/peminjaman/:id/kembali', (req,res)=>{
  const result=db.returnLoan(req.params.id,{condition:String(req.body.condition||'baik'),user:res.locals.user});
  if(result.error) return res.redirect(`/admin/sirkulasi?error=${encodeURIComponent(result.error)}`);
  res.redirect(`/admin/sirkulasi?success=${encodeURIComponent('Buku berhasil dikembalikan.')}`);
});
router.post('/peminjaman/:id/perpanjang', (req,res)=>{
  const result=db.renewLoan(req.params.id,{days:7,user:res.locals.user});
  if(result.error) return res.redirect(`/admin/sirkulasi?error=${encodeURIComponent(result.error)}`);
  res.redirect(`/admin/sirkulasi?success=${encodeURIComponent('Peminjaman diperpanjang 7 hari.')}`);
});

router.get('/terlambat',(req,res)=>{const loans=db.getEnrichedLoans().filter(l=>l.status==='terlambat').sort((a,b)=>b.overdueDays-a.overdueDays);res.render('admin/terlambat',{title:`Peminjaman Terlambat — ${res.locals.site.libraryName}`,loans,totalFine:loans.reduce((s,l)=>s+l.fine,0)});});
router.get('/laporan',(req,res)=>{const filters={from:req.query.from||'',to:req.query.to||'',status:req.query.status||'',category:req.query.category||''};const report=db.getReportData(filters);res.render('admin/laporan',{title:`Laporan Perpustakaan — ${res.locals.site.libraryName}`,...report,finePerDay:db.FINE_PER_DAY,filters,categories:db.getCategories()});});
router.get('/laporan/csv',(req,res)=>{const rows=db.getEnrichedLoans();const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=[['ID','Buku','Eksemplar','Peminjam','Tanggal Pinjam','Jatuh Tempo','Tanggal Kembali','Status','Hari Terlambat','Denda'].map(esc).join(','),...rows.map(l=>[l.id,l.book?.title,l.copy?.id,l.member?.name,l.borrowDate,l.dueDate,l.returnDate||'',l.status,l.overdueDays,l.fine].map(esc).join(','))].join('\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="laporan-peminjaman-sipus.csv"');res.send('\ufeff'+csv);});
router.get('/audit',(req,res)=>res.render('admin/audit',{title:`Audit Sistem — ${res.locals.site.libraryName}`,logs:db.getAuditLogs()}));
router.get('/backup',(req,res)=>{const files=['books.json','members.json','loans.json','copies.json','categories.json','users.json','audit.json','site.json','registration_requests.json'];const bundle=Object.fromEntries(files.map(f=>[f,JSON.parse(fs.readFileSync(db.getDataPath(f),'utf8'))]));res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition','attachment; filename="sipus-backup.json"');res.send(JSON.stringify({generatedAt:new Date().toISOString(),data:bundle},null,2));});
router.get('/backup/restore',(req,res)=>res.render('admin/restore',{title:`Restore Data — ${res.locals.site.libraryName}`,error:null}));
router.post('/backup/restore',(req,res)=>{try{const payload=JSON.parse(req.body.backup||'');const allowed=['books.json','members.json','loans.json','copies.json','categories.json','users.json','audit.json','site.json','registration_requests.json'];if(!payload.data)throw new Error('Format backup tidak valid.');for(const file of allowed){if(payload.data[file]!==undefined)db.writeDataFile(file,payload.data[file]);}db.normalizeUserData();db.rehydrateMediaFiles();db.syncCopies();db.recalculateAvailability();db.addAudit(res.locals.user,'Restore Backup','Data perpustakaan dipulihkan dari backup JSON');res.redirect('/admin/laporan');}catch(e){console.error('[SIPUS] Restore error:',e);res.status(400).render('admin/restore',{title:`Restore Data — ${res.locals.site.libraryName}`,error:'Backup tidak valid atau gagal dipulihkan.'});}});

module.exports=router;
