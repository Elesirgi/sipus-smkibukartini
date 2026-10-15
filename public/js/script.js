// SIPUS — modern interactions, micro-animations and page transitions

const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');
const navScrim = document.getElementById('navScrim');

function closeNav() {
  mainNav?.classList.remove('open');
  navScrim?.classList.remove('open');
  navToggle?.setAttribute('aria-expanded', 'false');
}

navToggle?.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('open');
  navScrim?.classList.toggle('open', isOpen);
  navToggle.setAttribute('aria-expanded', String(isOpen));
});
navScrim?.addEventListener('click', closeNav);
mainNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeNav));

// Back-to-top
const toTop = document.getElementById('toTop');
window.addEventListener('scroll', () => {
  if (window.scrollY > 480) toTop?.classList.add('visible');
  else toTop?.classList.remove('visible');
}, { passive: true });
toTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// Theme is intentionally locked to light mode.

// Page navigation is intentionally left to the browser. This avoids a full-screen
// transition layer ever getting stuck above the page. Targeted entrance animations
// and ripple feedback still provide motion without blocking navigation.

// Ripple feedback for buttons/links and a tiny press effect.
document.addEventListener('pointerdown', (event) => {
  const target = event.target.closest('button, .btn, .category-filter a, .pagination a, .category-card, .book-card, .welcome-book-card, .mini-book-item');
  if (!target || target.disabled) return;
  if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
  target.style.overflow = 'hidden';
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * .42;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}, { passive: true });

// Hash navigation: smooth and highlight destination briefly.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const id = link.getAttribute('href');
  if (!id || id === '#') return;
  const target = document.querySelector(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.animate([
    { boxShadow: '0 0 0 0 rgba(29,95,194,0)' },
    { boxShadow: '0 0 0 8px rgba(29,95,194,.08)' },
    { boxShadow: '0 0 0 0 rgba(29,95,194,0)' }
  ], { duration: 650, easing: 'ease-out' });
  history.replaceState(null, '', id);
});

// Cover buku dan foto anggota ditayangkan oleh endpoint server yang membaca storage persisten.

// Simple Code 39 barcode for library inventory labels (no external dependency).
(function initInventoryBarcodes(){
  const patterns = {
    '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011','5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101',
    'A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011','E':'110101100101','F':'101101100101','G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101',
    'K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011','O':'110101101001','P':'101101101001','Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001',
    'U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011','Y':'110010110101','Z':'100110110101','-':'100101011011','.':'110010101101',' ':'100110101101','$':'100100100101','/':'100100101001','+':'100101001001','%':'101001001001'
  };
  const startStop='100101101101';
  document.querySelectorAll('.barcode[data-code], .barcode-mini[data-code]').forEach(el=>{
    const code=String(el.dataset.code||'').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g,'');
    if(!code)return;
    const sequence='*'+code+'*';
    const bits=sequence.split('').map(ch=>ch==='*'?startStop:patterns[ch]).join('0');
    el.style.setProperty('--barcode-pattern', `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${bits.length}' height='60'%3E%3Crect width='100%25' height='100%25' fill='white'/%3E%3Cpath d='${bits.split('').map((b,i)=>b==='1'?`M${i} 0v60`:'').join('')}' stroke='black' stroke-width='1'/%3E%3C/svg%3E")`);
    el.classList.add('barcode-ready');
  });
})();

window.addEventListener('afterprint', () => document.body.classList.remove('print-label'));

// Generic password visibility toggle (login/admin forms)
document.addEventListener('click',(event)=>{
 const btn=event.target.closest('.password-toggle'); if(!btn)return;
 const field=btn.closest('.password-input-wrap')?.querySelector('input'); if(!field)return;
 const showing=field.type==='text'; field.type=showing?'password':'text'; btn.textContent=showing?'Lihat':'Sembunyikan'; btn.setAttribute('aria-pressed',String(!showing));
});
