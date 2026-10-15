const express = require('express');
const router = express.Router();
const auth = require('../lib/auth');
const db = require('../lib/data');

function renderHome(res, extra={}) {
  const copies = db.syncCopies();
  const books = db.getBooks().slice(0, 8).map(b => ({
    ...b,
    borrowedCopies: copies.filter(c => c.bookId === b.id && c.status === 'dipinjam').length
  }));
  res.render('welcome', {
    title: `${res.locals.site.libraryName} — Katalog`,
    books,
    ...extra
  });
}

router.get('/', (req,res) => {
  // The landing page is intentionally the public catalogue, not a login page.
  renderHome(res);
});
router.get('/login', (req,res) => res.redirect(`/admin/login${req.query.next ? `?next=${encodeURIComponent(req.query.next)}` : ''}`));

router.get('/admin/login', (req,res) => {
  if(res.locals.user?.role === 'admin') return res.redirect('/admin');
  res.render('admin-login', {
    title: `Login Admin — ${res.locals.site.libraryName}`,
    loginError: null,
    username: '',
    nextUrl: req.query.next || '/admin'
  });
});
router.post('/admin/login', (req,res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const nextUrl = String(req.body.next || '');
  try {
    const user = auth.verifyLogin(username, password);
    if(!user || user.role !== 'admin') {
      return res.status(401).render('admin-login', {
        title: `Login Admin — ${res.locals.site.libraryName}`,
        loginError: 'Username atau password Admin tidak valid.', username, nextUrl: nextUrl || '/admin'
      });
    }
    const token = auth.createSession(user);
    if(!token) throw new Error('Session gagal dibuat.');
    auth.setSessionCookie(res, token);
    return res.redirect(nextUrl.startsWith('/admin') ? nextUrl : '/admin');
  } catch(e) {
    console.error('[SIPUS] Admin login:', e);
    return res.status(500).render('admin-login', {
      title: `Login Admin — ${res.locals.site.libraryName}`,
      loginError: 'Login gagal diproses. Pastikan server berjalan normal.', username, nextUrl: nextUrl || '/admin'
    });
  }
});

// Member login and self-registration are intentionally disabled.
router.post('/login', (req,res) => res.redirect('/admin/login'));
router.post('/register', (req,res) => res.redirect('/admin/login'));
router.post('/logout', (req,res) => {
  const token = auth.getTokenFromRequest(req);
  if(token) auth.destroySession(token);
  auth.clearSessionCookie(res);
  res.redirect('/');
});

module.exports = router;
