const express = require('express');
const router = express.Router();
const db = require('../lib/data');

router.get('/', (req, res) => {
  res.render('index', { books: db.getBooks() });
});

router.get('/:id/edit', (req, res) => {
  const bookId = String(req.params.id || '').trim();
  const book = db.getBookById(bookId);
  if (!book) {
    return res.status(404).render('404', {
      title: '404 - Buku Tidak Ditemukan',
      message: `Buku dengan ID "${bookId}" tidak ditemukan atau telah dihapus.`
    });
  }
  res.render('edit', { book });
});

module.exports = router;
