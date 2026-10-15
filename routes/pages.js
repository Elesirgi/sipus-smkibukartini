const express = require('express');
const router = express.Router();
const db = require('../lib/data');

const redirectAdmin = (req, res, next) => {
  if (res.locals.user?.role === 'admin') return res.redirect('/admin');
  next();
};

router.get('/dashboard', redirectAdmin, (req, res) => { res.redirect('/'); });

router.get('/profil', redirectAdmin, (req, res, next) => { res.redirect('/'); });

router.get('/katalog', redirectAdmin, (req, res) => {
  const copies = db.syncCopies();
  const all = db.getBooks().map(b => ({ ...b, borrowedCopies: copies.filter(c => c.bookId === b.id && c.status === 'dipinjam').length }));
  const q = String(req.query.q || '').trim().toLowerCase();
  const categorySlug = req.query.kategori || null;
  let filtered = all;
  if (categorySlug) filtered = filtered.filter(b => b.category === categorySlug);
  if (q) filtered = filtered.filter(b => [b.title,b.author,b.isbn,b.publisher,b.subject,b.grade].join(' ').toLowerCase().includes(q));
  const perPage = 8, page = Math.max(1, parseInt(req.query.page, 10) || 1), totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  res.render('katalog', { title: `Katalog Buku — ${res.locals.site.libraryName}`, books: filtered.slice((page-1)*perPage,page*perPage), categories: db.getCategories(), activeCategory: categorySlug, query:q, page, totalPages, totalResults:filtered.length, errorMsg:req.query.error||null });
});
router.get('/katalog/:slug', redirectAdmin, (req, res, next) => {
  const identifier = String(req.params.slug || '').trim();
  // Legacy links sometimes contain an ID or an old title slug. Resolve either form.
  const raw = db.getBookBySlug(identifier) || db.getBookById(identifier);
  if (!raw) return next();
  const copies = db.syncCopies();
  const book = { ...raw, borrowedCopies: copies.filter(c => String(c.bookId).toLowerCase() === String(raw.id).toLowerCase() && c.status === 'dipinjam').length };
  res.render('buku-detail', {
    title: `${book.title} — ${res.locals.site.libraryName}`,
    book,
    category: db.getCategoryBySlug(book.category),
    loanHistory: db.getLoansForBook(book.id),
    relatedBooks: db.getBooks().filter(b => b.category === book.category && b.id !== book.id).slice(0, 4).map(b => ({
      ...b,
      borrowedCopies: Math.max(0, Number(b.totalCopies || 0) - Number(b.availableCopies || 0))
    })),
    members: [],
    copies: copies.filter(c => String(c.bookId).toLowerCase() === String(book.id).toLowerCase())
  });
});
// Compatibility URL for older pages that used /buku/:id rather than /katalog/:slug.
router.get('/buku/:id', redirectAdmin, (req, res, next) => {
  const book = db.getBookById(req.params.id) || db.getBookBySlug(req.params.id);
  if (!book) return next();
  return res.redirect(302, `/katalog/${encodeURIComponent(book.slug || book.id)}`);
});
router.get('/kategori', redirectAdmin, (req,res)=>{const categories=db.getCategories(),books=db.getBooks();res.render('kategori',{title:`Kategori Buku — ${res.locals.site.libraryName}`,categories:categories.map(c=>({...c,bookCount:books.filter(b=>b.category===c.slug).length}))});});
router.get('/anggota', redirectAdmin, (req,res)=>{const members=db.getMembers(),q=String(req.query.q||'').trim().toLowerCase(),filtered=q?members.filter(m=>[m.name,m.id,m.kelas,m.role].join(' ').toLowerCase().includes(q)):members;res.render('anggota',{title:`Anggota — ${res.locals.site.libraryName}`,members:filtered.map(m=>({...m,activeLoanCount:db.getLoansForMember(m.id).filter(l=>l.status!=='dikembalikan').length})),query:q,totalMembers:members.length});});
router.get('/anggota/:id', redirectAdmin, (req,res,next)=>{const member=db.getMemberById(req.params.id);if(!member)return next();res.render('anggota-detail',{title:`${member.name} — ${res.locals.site.libraryName}`,member,loans:db.getLoansForMember(member.id)});});

const LOAN_SORTABLE_FIELDS={id:l=>l.id,book:l=>l.book?.title?.toLowerCase()||'',member:l=>l.member?.name?.toLowerCase()||'',borrowDate:l=>l.borrowDate,dueDate:l=>l.dueDate,status:l=>l.status};
router.get('/peminjaman', redirectAdmin, (req,res)=>{
  const all=db.getEnrichedLoans(); const status=req.query.status||null; let filtered=status?all.filter(l=>l.status===status):all; const sort=LOAN_SORTABLE_FIELDS[req.query.sort]?req.query.sort:'borrowDate',dir=req.query.dir==='asc'?'asc':'desc'; const key=LOAN_SORTABLE_FIELDS[sort]; filtered=filtered.slice().sort((a,b)=>key(a)<key(b)?(dir==='asc'?-1:1):key(a)>key(b)?(dir==='asc'?1:-1):0);
  const perPage=10,page=Math.max(1,parseInt(req.query.page,10)||1),totalPages=Math.max(1,Math.ceil(filtered.length/perPage));
  res.render('peminjaman',{title:`Peminjaman — ${res.locals.site.libraryName}`,totalFines:filtered.reduce((s,l)=>s+l.fine,0),finePerDay:db.FINE_PER_DAY,loans:filtered.slice((page-1)*perPage,page*perPage),activeStatus:status,sort,dir,page,totalPages,isMember:false,isAdmin:false,counts:{semua:filtered.length,dipinjam:all.filter(l=>l.status==='dipinjam').length,terlambat:all.filter(l=>l.status==='terlambat').length,dikembalikan:all.filter(l=>l.status==='dikembalikan').length}});
});

module.exports=router;
