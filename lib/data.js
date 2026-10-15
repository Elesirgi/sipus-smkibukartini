const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const DATA_DIR = storage.DATA_DIR;
const FINE_PER_DAY = 1000;
const LOAN_DAYS = 14;
const MAX_ACTIVE_LOANS = 3;
const DEFAULT_COPIES = 50;

function readJSON(filename, fallback = []) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8')); }
  catch { return fallback; }
}
function writeJSON(filename, data) { storage.atomicWrite(path.join(DATA_DIR, filename), data); }
function normalizeId(id) { return String(id ?? '').trim().toLowerCase(); }
function mimeFromCoverName(name) { return storage.mimeFromExt(path.extname(String(name || ''))); }

function getSite(){ return readJSON('site.json', {}); }
function getCategories(){ return readJSON('categories.json', []); }
function getCategoryBySlug(slug){ return getCategories().find(c => c.slug === slug) || null; }
function slugify(text){ return String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function nextId(items, prefix){
  const nums = items.map(i => parseInt(String(i.id || '').replace(prefix,''),10)).filter(Number.isFinite);
  return `${prefix}${String((nums.length ? Math.max(...nums) : 0)+1).padStart(3,'0')}`;
}

function getBooks(){ return readJSON('books.json', []); }
function getBookById(id){ const key=normalizeId(id); return getBooks().find(b => normalizeId(b.id) === key) || null; }
// Accept the stored slug, a slug generated from the current title, or the book ID.
// This keeps old catalogue links working if a previous data migration lost/changed slug values.
function getBookBySlug(slug){
  const raw = String(slug ?? '').trim();
  if (!raw) return null;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (_) {}
  const key = decoded.trim().toLowerCase();
  const books = getBooks();
  return books.find(b => String(b.slug || '').trim().toLowerCase() === key)
    || books.find(b => slugify(b.title) === key)
    || books.find(b => normalizeId(b.id) === normalizeId(decoded))
    || null;
}
function ensureBookSlugs(){
  const books = getBooks();
  const used = new Set();
  let changed = false;
  for (const book of books){
    const idSlug = slugify(book.id || 'buku');
    let base = String(book.slug || '').trim().toLowerCase();
    if (!base || base === 'undefined' || base === 'null') base = slugify(book.title) || idSlug || 'buku';
    else base = slugify(base) || slugify(book.title) || idSlug || 'buku';
    let slug = base;
    if (used.has(slug)) slug = `${base}-${idSlug || 'buku'}`;
    let suffix = 2;
    while (used.has(slug)) slug = `${base}-${idSlug || 'buku'}-${suffix++}`;
    used.add(slug);
    if (book.slug !== slug){ book.slug = slug; changed = true; }
  }
  if (changed) writeJSON('books.json', books);
  return books;
}
function getMembers(){ return readJSON('members.json', []); }
function getMemberById(id){ const key=normalizeId(id); return getMembers().find(m => normalizeId(m.id) === key) || null; }
function getLoans(){ return readJSON('loans.json', []); }
function getCopies(){ return readJSON('copies.json', []); }
function getAuditLogs(){ return readJSON('audit.json', []); }
function getRegistrationRequests(){ return readJSON('registration_requests.json', []); }
function getDataPath(filename){ return path.join(DATA_DIR, filename); }


function writeDataFile(filename,data){writeJSON(filename,data);}
function normalizeUserData(){
  const users=readJSON('users.json',[]);
  let admins=users.filter(u=>u?.role==='admin');
  if(admins.length>1)admins=[admins[0]];
  const staff=users.filter(u=>u?.role==='petugas');
  const normalized=[...admins,...staff];
  if(JSON.stringify(users)!==JSON.stringify(normalized))writeJSON('users.json',normalized);
  // Member accounts are intentionally disabled. Member records remain usable for circulation.
}
function rehydrateMediaFiles(){
  const books=getBooks();let booksChanged=false;
  for(const book of books){
    if(!book.coverData)continue;
    const ext=book.coverMime==='image/png'?'.png':book.coverMime==='image/webp'?'.webp':'.jpg';
    let filename=path.basename(String(book.cover||''));
    if(!filename||!filename.includes('.'))filename=`${book.id}${ext}`;
    if(!/\.(jpg|jpeg|png|webp)$/i.test(filename))filename=`${book.id}${ext}`;
    const target=path.join(storage.COVER_DIR,filename);storage.ensureDir(storage.COVER_DIR);fs.writeFileSync(target,Buffer.from(book.coverData,'base64'));const next=`/uploads/covers/${filename}`;if(book.cover!==next){book.cover=next;booksChanged=true;}
  }
  if(booksChanged)writeJSON('books.json',books);
  const members=getMembers();let membersChanged=false;
  for(const member of members){
    if(!member.photoData)continue;
    const ext=member.photoMime==='image/png'?'.png':member.photoMime==='image/webp'?'.webp':'.jpg';
    let filename=path.basename(String(member.photo||''));
    if(!filename||!filename.includes('.'))filename=`${member.id}${ext}`;
    if(!/\.(jpg|jpeg|png|webp)$/i.test(filename))filename=`${member.id}${ext}`;
    const target=path.join(storage.MEMBER_DIR,filename);storage.ensureDir(storage.MEMBER_DIR);fs.writeFileSync(target,Buffer.from(member.photoData,'base64'));const next=`/uploads/members/${filename}`;if(member.photo!==next){member.photo=next;membersChanged=true;}
  }
  if(membersChanged)writeJSON('members.json',members);
}

function addCategory(data){
  const rows=getCategories();
  const name=String(data.name||'').trim();
  if(!name)return{error:'Nama kategori wajib diisi.'};
  const slug=slugify(name);
  if(!slug)return{error:'Nama kategori tidak valid.'};
  if(rows.some(c=>c.slug===slug || String(c.name||'').toLowerCase()===name.toLowerCase()))return{error:'Kategori tersebut sudah ada.'};
  const category={id:nextId(rows,'KT'),name,slug,description:String(data.description||'').trim()};
  rows.push(category); writeJSON('categories.json',rows); return{category};
}

function embedFileDataIfMissing(){
  const books=getBooks(); let booksChanged=false;
  for(const book of books){
    if(book.coverData)continue;
    const cover=String(book.cover||'');
    if(!/^\/uploads\/covers\//i.test(cover))continue;
    const filename=path.basename(cover);
    const candidates=[path.join(storage.COVER_DIR,filename),path.join(storage.LEGACY_UPLOADS_DIR,'covers',filename)];
    const source=candidates.find(file=>fs.existsSync(file));
    if(!source)continue;
    try{book.coverData=fs.readFileSync(source).toString('base64');book.coverMime=mimeFromCoverName(source);book.coverUpdatedAt=new Date().toISOString();storage.ensureDir(storage.COVER_DIR);fs.copyFileSync(source, path.join(storage.COVER_DIR, filename));booksChanged=true;}catch(_){ }
  }
  if(booksChanged)writeJSON('books.json',books);

  const members=getMembers(); let membersChanged=false;
  for(const member of members){
    if(member.photoData)continue;
    const photo=String(member.photo||'');
    if(!/^\/uploads\/members\//i.test(photo))continue;
    const filename=path.basename(photo);
    const candidates=[path.join(storage.MEMBER_DIR,filename),path.join(storage.LEGACY_UPLOADS_DIR,'members',filename)];
    const source=candidates.find(file=>fs.existsSync(file));
    if(!source)continue;
    try{member.photoData=fs.readFileSync(source).toString('base64');member.photoMime=mimeFromCoverName(source);member.photoUpdatedAt=new Date().toISOString();storage.ensureDir(storage.MEMBER_DIR);fs.copyFileSync(source,path.join(storage.MEMBER_DIR,filename));membersChanged=true;}catch(_){ }
  }
  if(membersChanged)writeJSON('members.json',members);
}
embedFileDataIfMissing();

function recalculateAvailability(){
  const books=getBooks(); const copies=getCopies(); const available={}; books.forEach(b=>available[b.id]=0);
  for(const c of copies){ if(c.status==='tersedia' && c.condition!=='hilang' && c.condition!=='rusak berat')available[c.bookId]=(available[c.bookId]||0)+1; }
  let changed=false;
  for(const book of books){const next=available[book.id]||0;if(Number(book.availableCopies)!==next){book.availableCopies=next;changed=true;}}
  if(changed)writeJSON('books.json',books); return books;
}

function syncCopies(){
  let copies=getCopies(); const books=getBooks(); let changed=false;
  const validIds=new Set(books.map(b=>b.id));
  copies=copies.filter(c=>validIds.has(c.bookId));
  for(const book of books){
    let related=copies.filter(c=>c.bookId===book.id);
    // Keep the existing inventory-code prefix when copies already exist,
    // so changing a book's metadata does not invalidate loan history.
    const base=(related[0]?.id||`${book.inventoryCode||'IBK-'+book.id}-01`).replace(/-\d+$/,'');
    const desired=Math.max(1,parseInt(book.totalCopies,10)||DEFAULT_COPIES);
    while(related.length<desired){
      let maxNum=0; for(const c of related){const m=String(c.id).match(/-(\d+)$/);if(m)maxNum=Math.max(maxNum,Number(m[1]));}
      const id=`${base}-${String(maxNum+1).padStart(2,'0')}`;
      if(!related.some(c=>c.id===id)){const fresh={id,bookId:book.id,status:'tersedia',condition:'baik',shelfLocation:book.shelfLocation||'-'};copies.push(fresh);related.push(fresh);changed=true;}
    }
    if(related.length>desired){
      const removable=related.filter(c=>c.status==='tersedia' && !['hilang','rusak berat'].includes(c.condition)).sort((a,b)=>{
        const an=Number(String(a.id).match(/-(\d+)$/)?.[1]||0), bn=Number(String(b.id).match(/-(\d+)$/)?.[1]||0);return bn-an;
      });
      const need=related.length-desired; const removeIds=new Set(removable.slice(0,need).map(c=>c.id));
      if(removeIds.size===need){copies=copies.filter(c=>!removeIds.has(c.id));changed=true;}
    }
  }
  const loans=getLoans();
  for(const loan of loans){
    let copy=loan.copyId?copies.find(c=>c.id===loan.copyId):null;
    if(!copy){
      copy=copies.find(c=>c.bookId===loan.bookId && c.status==='tersedia' && !['hilang','rusak berat'].includes(c.condition));
      if(copy){loan.copyId=copy.id;changed=true;}
    }
    if(copy)copy.status=loan.returnDate?'tersedia':'dipinjam';
  }
  if(changed){writeJSON('copies.json',copies);writeJSON('loans.json',loans);}
  recalculateAvailability(); return copies;
}

function dateOnly(date){const d=date instanceof Date?date:new Date(date);return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function daysBetween(later,earlier){return Math.max(0,Math.floor((dateOnly(later)-dateOnly(earlier))/86400000));}
function enrichLoan(loan,today=new Date()){
  const book=getBookById(loan.bookId), member=getMemberById(loan.memberId), copy=getCopies().find(c=>c.id===loan.copyId);
  const due=dateOnly(loan.dueDate), ref=loan.returnDate?dateOnly(loan.returnDate):dateOnly(today);
  const overdueDays=ref>due?daysBetween(ref,due):0;
  let status='dikembalikan'; if(!loan.returnDate)status=due<dateOnly(today)?'terlambat':'dipinjam';
  return{...loan,book,member,copy,status,overdueDays,fine:overdueDays*FINE_PER_DAY,finePerDay:FINE_PER_DAY};
}
function getEnrichedLoans(){syncCopies();return getLoans().map(l=>enrichLoan(l)).sort((a,b)=>new Date(b.borrowDate)-new Date(a.borrowDate));}
function getLoansForBook(bookId){return getEnrichedLoans().filter(l=>normalizeId(l.bookId)===normalizeId(bookId));}
function getLoansForMember(memberId){return getEnrichedLoans().filter(l=>normalizeId(l.memberId)===normalizeId(memberId));}
function getStats(){
  const copies=syncCopies(),books=getBooks(),loans=getEnrichedLoans(),active=loans.filter(l=>l.status!=='dikembalikan');
  return{totalTitles:books.length,totalCopies:copies.length,availableCopies:copies.filter(c=>c.status==='tersedia'&&!['hilang','rusak berat'].includes(c.condition)).length,borrowedCopies:copies.filter(c=>c.status==='dipinjam').length,totalMembers:getMembers().length,activeLoans:active.length,overdueLoans:loans.filter(l=>l.status==='terlambat').length,returnedLoans:loans.filter(l=>l.status==='dikembalikan').length,totalFines:loans.reduce((s,l)=>s+l.fine,0),damagedCopies:copies.filter(c=>['rusak ringan','rusak berat'].includes(c.condition)).length,lostCopies:copies.filter(c=>c.condition==='hilang').length};
}
function getPopularBooks(limit=5){const counts={};getLoans().forEach(l=>counts[l.bookId]=(counts[l.bookId]||0)+1);return getBooks().map(b=>({...b,loanCount:counts[b.id]||0})).sort((a,b)=>b.loanCount-a.loanCount).slice(0,limit);}
function getReportData(filters={}){let loans=getEnrichedLoans();const books=getBooks(),members=getMembers();if(filters.from)loans=loans.filter(l=>l.borrowDate>=filters.from);if(filters.to)loans=loans.filter(l=>l.borrowDate<=filters.to);if(filters.status)loans=loans.filter(l=>l.status===filters.status);if(filters.category)loans=loans.filter(l=>l.book?.category===filters.category);const byCategory=getCategories().map(c=>({...c,titles:books.filter(b=>b.category===c.slug).length,copies:books.filter(b=>b.category===c.slug).reduce((s,b)=>s+Number(b.totalCopies||0),0)}));return{stats:getStats(),loans,overdueLoans:loans.filter(l=>l.status==='terlambat'),popularBooks:getPopularBooks(8),byCategory,members};}
function getYoutubeId(url){if(!url)return'';const m=String(url).match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);return m?m[1]:'';}
function formatDateID(dateStr){if(!dateStr)return'-';const d=new Date(dateStr);if(Number.isNaN(d.getTime()))return'-';const months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];return`${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;}

function addAudit(user,action,detail){const rows=getAuditLogs();rows.unshift({id:`LOG${Date.now()}${Math.random().toString(16).slice(2,6)}`,at:new Date().toISOString(),username:user?.username||'system',role:user?.role||'system',action,detail});writeJSON('audit.json',rows.slice(0,500));}

function resizeBookCopies(bookId,targetTotal){
  const books=getBooks(); const book=books.find(b=>normalizeId(b.id)===normalizeId(bookId)); if(!book)return{error:'Buku tidak ditemukan.'};
  let copies=syncCopies(); let related=copies.filter(c=>c.bookId===book.id); let target=Math.max(1,parseInt(targetTotal,10)||DEFAULT_COPIES);
  const protectedCount=related.filter(c=>c.status==='dipinjam'||['hilang','rusak berat'].includes(c.condition)).length; if(target<protectedCount)target=protectedCount;
  const base=(related[0]?.id||`${book.inventoryCode||'IBK-'+book.id}-01`).replace(/-\d+$/,'');
  while(related.length<target){let max=0;for(const c of related){const m=String(c.id).match(/-(\d+)$/);if(m)max=Math.max(max,Number(m[1]));}const id=`${base}-${String(max+1).padStart(2,'0')}`;const fresh={id,bookId:book.id,status:'tersedia',condition:'baik',shelfLocation:book.shelfLocation||'-'};related.push(fresh);copies.push(fresh);}
  if(related.length>target){const removable=related.filter(c=>c.status==='tersedia'&&!['hilang','rusak berat'].includes(c.condition)).sort((a,b)=>Number(String(b.id).match(/-(\d+)$/)?.[1]||0)-Number(String(a.id).match(/-(\d+)$/)?.[1]||0));const removeIds=new Set(removable.slice(0,related.length-target).map(c=>c.id));if(removeIds.size<related.length-target)return{error:'Jumlah eksemplar tidak dapat dikurangi karena terlalu banyak eksemplar yang sedang dipinjam atau tidak layak.'};copies=copies.filter(c=>!removeIds.has(c.id));related=related.filter(c=>!removeIds.has(c.id));}
  book.totalCopies=related.length; writeJSON('books.json',books);writeJSON('copies.json',copies);recalculateAvailability();return{book,copies:related};
}

function addBook(data){
  const books=getBooks();const id=nextId(books,'BK');let slug=slugify(data.title);if(books.some(b=>b.slug===slug))slug=`${slug}-${id.toLowerCase()}`;
  const total=Math.max(1,parseInt(data.totalCopies,10)||DEFAULT_COPIES);const book={id,inventoryCode:String(data.inventoryCode||`IBK-${id}`).trim(),slug,title:String(data.title||'').trim(),author:String(data.author||'').trim(),publisher:String(data.publisher||'-').trim(),year:parseInt(data.year,10)||new Date().getFullYear(),isbn:String(data.isbn||'').trim(),category:String(data.category||'').trim(),subject:String(data.subject||'').trim(),grade:String(data.grade||'').trim(),totalCopies:total,availableCopies:total,shelfLocation:String(data.shelfLocation||'-').trim(),description:String(data.description||''),dateAdded:new Date().toISOString().slice(0,10),cover:data.cover||'',coverData:data.coverData||'',coverMime:data.coverMime||'',coverUpdatedAt:data.coverUpdatedAt||'',updatedAt:new Date().toISOString()};
  if(!book.title||!book.author||!book.category)return{error:'Judul, penulis, dan kategori wajib diisi.'};books.push(book);writeJSON('books.json',books);resizeBookCopies(book.id,total);return book;
}
function updateBook(id,data){
  const books=getBooks();const idx=books.findIndex(b=>normalizeId(b.id)===normalizeId(id));if(idx<0)return null;const prev=books[idx];const currentCopies=getCopies().filter(c=>normalizeId(c.bookId)===normalizeId(prev.id));const protectedCount=currentCopies.filter(c=>c.status==='dipinjam'||['hilang','rusak berat'].includes(c.condition)).length;const desired=Math.max(1,parseInt(data.totalCopies,10)||prev.totalCopies||DEFAULT_COPIES);const newTotal=Math.max(desired,protectedCount);
  books[idx]={...prev,title:String(data.title||prev.title).trim(),author:String(data.author||prev.author).trim(),publisher:String(data.publisher ?? prev.publisher ?? '').trim(),year:parseInt(data.year,10)||prev.year,isbn:String(data.isbn ?? prev.isbn ?? '').trim(),category:String(data.category||prev.category).trim(),subject:String(data.subject ?? prev.subject ?? '').trim(),grade:String(data.grade ?? prev.grade ?? '').trim(),totalCopies:newTotal,availableCopies:prev.availableCopies,shelfLocation:String(data.shelfLocation ?? prev.shelfLocation ?? '-').trim(),description:String(data.description ?? prev.description ?? ''),cover:data.cover!==undefined?data.cover:(prev.cover||''),coverData:data.coverData!==undefined?String(data.coverData||''): (prev.coverData||''),coverMime:data.coverMime!==undefined?String(data.coverMime||''): (prev.coverMime||''),coverUpdatedAt:data.coverUpdatedAt||prev.coverUpdatedAt||'',inventoryCode:currentCopies.length?prev.inventoryCode:String(data.inventoryCode||prev.inventoryCode||`IBK-${prev.id}`).trim(),updatedAt:new Date().toISOString()};
  writeJSON('books.json',books);const result=resizeBookCopies(prev.id,newTotal);if(result.error)throw new Error(result.error);return result.book;
}
function deleteBook(id){if(getLoans().some(l=>normalizeId(l.bookId)===normalizeId(id)))return false;const books=getBooks();const filtered=books.filter(b=>normalizeId(b.id)!==normalizeId(id));if(filtered.length===books.length)return false;writeJSON('books.json',filtered);writeJSON('copies.json',getCopies().filter(c=>normalizeId(c.bookId)!==normalizeId(id)));return true;}

function addMember(data){
  const members=getMembers();
  const id=nextId(members,'AG');
  const role=['Siswa','Guru','Staf'].includes(data.role)?data.role:'Siswa';
  const member={id,name:String(data.name||'').trim(),role,kelas:String(data.kelas||'-').trim(),status:data.status==='nonaktif'?'nonaktif':'aktif',memberSince:new Date().toISOString().slice(0,10),nisn:String(data.nisn||'').trim(),schoolId:String(data.schoolId||'').trim(),email:String(data.email||'').trim(),phone:String(data.phone||'').trim(),photo:data.photo||'',photoData:data.photoData||'',photoMime:data.photoMime||'',photoUpdatedAt:data.photoUpdatedAt||''};
  if(!member.name)return{error:'Nama anggota wajib diisi.'};
  if(member.nisn&&members.some(m=>m.nisn===member.nisn&&m.status==='aktif'))return{error:'NISN/identitas tersebut sudah terdaftar.'};
  if(!member.photoData)return{error:'Foto anggota wajib diupload.'};
  members.push(member);
  writeJSON('members.json',members);
  return member;
}
function updateMember(id,data){
  const members=getMembers();
  const i=members.findIndex(m=>normalizeId(m.id)===normalizeId(id));
  if(i<0)return null;
  const role=['Siswa','Guru','Staf'].includes(data.role)?data.role:(members[i].role||'Siswa');
  members[i]={...members[i],name:String(data.name||members[i].name).trim(),role,kelas:String(data.kelas ?? members[i].kelas ?? '-').trim(),status:data.status==='nonaktif'?'nonaktif':'aktif',nisn:String(data.nisn ?? members[i].nisn ?? '').trim(),schoolId:String(data.schoolId ?? members[i].schoolId ?? '').trim(),email:String(data.email ?? members[i].email ?? '').trim(),phone:String(data.phone ?? members[i].phone ?? '').trim(),photo:data.photo!==undefined?data.photo:(members[i].photo||''),photoData:data.photoData!==undefined?String(data.photoData||''):(members[i].photoData||''),photoMime:data.photoMime!==undefined?String(data.photoMime||''):(members[i].photoMime||''),photoUpdatedAt:data.photoUpdatedAt||members[i].photoUpdatedAt||''};
  writeJSON('members.json',members);
  return members[i];
}
function deleteMember(id){const members=getMembers();if(!members.some(m=>normalizeId(m.id)===normalizeId(id)))return false;if(getLoans().some(l=>normalizeId(l.memberId)===normalizeId(id)))return false;writeJSON('members.json',members.filter(m=>normalizeId(m.id)!==normalizeId(id)));return true;}

function createLoan(bookId,memberId,{days=LOAN_DAYS,user=null}={}){
  const member=getMemberById(memberId);
  if(!member)return{error:'Anggota tidak ditemukan.'};
  if(member.status!=='aktif')return{error:'Anggota tidak aktif.'};
  const book=getBookById(bookId);
  if(!book)return{error:'Buku tidak ditemukan.'};
  const active=getLoans().filter(l=>normalizeId(l.memberId)===normalizeId(member.id)&&!l.returnDate).length;
  if(active>=MAX_ACTIVE_LOANS)return{error:`Anggota sudah memiliki ${MAX_ACTIVE_LOANS} buku aktif.`};
  const copies=syncCopies();
  const copy=copies.find(c=>normalizeId(c.bookId)===normalizeId(book.id)&&c.status==='tersedia'&&!['hilang','rusak berat'].includes(c.condition));
  if(!copy)return{error:'Tidak ada eksemplar buku yang layak dipinjam.'};
  const loans=getLoans();
  const id=nextId(loans,'PJ');
  const borrowDate=new Date();
  const dueDate=new Date(borrowDate); dueDate.setDate(dueDate.getDate()+Number(days));
  const loan={id,bookId:book.id,memberId:member.id,copyId:copy.id,borrowDate:borrowDate.toISOString().slice(0,10),dueDate:dueDate.toISOString().slice(0,10),returnDate:null,renewals:0};
  loans.push(loan); copy.status='dipinjam';
  writeJSON('loans.json',loans); writeJSON('copies.json',copies); recalculateAvailability();
  addAudit(user,'Peminjaman',`${member.name} meminjam ${book.title} (${copy.id})`);
  return{loan,copy};
}
function createLoans(bookId,memberId,quantity,opts={}){
  const qty=Math.max(1,parseInt(quantity,10)||1);
  const results=[];
  for(let i=0;i<qty;i++){
    const r=createLoan(bookId,memberId,opts);
    results.push(r);
    if(r.error)break;
  }
  return{results,successes:results.filter(r=>!r.error),failures:results.filter(r=>r.error),count:results.filter(r=>!r.error).length};
}
function returnLoan(loanId,{condition='baik',user=null}={}){const loans=getLoans(),loan=loans.find(l=>normalizeId(l.id)===normalizeId(loanId));if(!loan||loan.returnDate)return{error:'Peminjaman tidak ditemukan atau sudah dikembalikan.'};const valid=['baik','rusak ringan','rusak berat','hilang'];const finalCondition=valid.includes(condition)?condition:'baik';loan.returnDate=new Date().toISOString().slice(0,10);const copies=syncCopies(),copy=copies.find(c=>c.id===loan.copyId);if(copy){copy.status=finalCondition==='hilang'||finalCondition==='rusak berat'?'tidak-layak':'tersedia';copy.condition=finalCondition;}writeJSON('loans.json',loans);writeJSON('copies.json',copies);recalculateAvailability();const book=getBookById(loan.bookId),member=getMemberById(loan.memberId);addAudit(user,'Pengembalian',`${member?.name||''} mengembalikan ${book?.title||''} (${copy?.id||'-'})`);return{loan,fine:enrichLoan(loan).fine};}
function renewLoan(loanId,{days=7,user=null}={}){const loans=getLoans(),loan=loans.find(l=>normalizeId(l.id)===normalizeId(loanId));if(!loan||loan.returnDate)return{error:'Peminjaman tidak aktif.'};if((loan.renewals||0)>=1)return{error:'Peminjaman sudah pernah diperpanjang.'};if(dateOnly(loan.dueDate)<dateOnly(new Date()))return{error:'Peminjaman yang sudah terlambat tidak dapat diperpanjang.'};const d=new Date(loan.dueDate);d.setDate(d.getDate()+Number(days));loan.dueDate=d.toISOString().slice(0,10);loan.renewals=(loan.renewals||0)+1;writeJSON('loans.json',loans);addAudit(user,'Perpanjangan',`${loan.id} diperpanjang ${days} hari`);return{loan};}
function setCopyCondition(copyId,condition,user){const copies=syncCopies(),c=copies.find(x=>normalizeId(x.id)===normalizeId(copyId));if(!c)return null;const valid=['baik','rusak ringan','rusak berat','hilang'];c.condition=valid.includes(condition)?condition:'baik';c.status=['hilang','rusak berat'].includes(c.condition)?'tidak-layak':(c.status==='dipinjam'?'dipinjam':'tersedia');writeJSON('copies.json',copies);recalculateAvailability();addAudit(user,'Kondisi Eksemplar',`${copyId} → ${c.condition}`);return c;}

// Compatibility: member self-registration is deliberately disabled.
function addRegistrationRequest(){return{error:'Pendaftaran anggota dinonaktifkan. Hanya Admin yang dapat menambahkan anggota.'};}
function getRegistrationRequestById(id){return getRegistrationRequests().find(r=>normalizeId(r.id)===normalizeId(id))||null;}
function approveRegistrationRequest(){return{error:'Pendaftaran mandiri dinonaktifkan.'};}
function rejectRegistrationRequest(){return{error:'Pendaftaran mandiri dinonaktifkan.'};}

module.exports={
  writeDataFile,normalizeUserData,rehydrateMediaFiles,ensureBookSlugs,getDataPath,STORAGE_DIR:storage.STORAGE_DIR,UPLOADS_DIR:storage.UPLOADS_DIR,COVER_DIR:storage.COVER_DIR,MEMBER_DIR:storage.MEMBER_DIR,
  addCategory,recalculateAvailability,getSite,getCategories,getCategoryBySlug,getBooks,getBookBySlug,getBookById,getMembers,getMemberById,getLoans,getCopies,getAuditLogs,getRegistrationRequests,getRegistrationRequestById,addRegistrationRequest,approveRegistrationRequest,rejectRegistrationRequest,
  getEnrichedLoans,getLoansForBook,getLoansForMember,getStats,getPopularBooks,getReportData,getYoutubeId,formatDateID,FINE_PER_DAY,LOAN_DAYS,MAX_ACTIVE_LOANS,DEFAULT_COPIES,addBook,updateBook,resizeBookCopies,deleteBook,addMember,updateMember,deleteMember,createLoan,createLoans,returnLoan,renewLoan,setCopyCondition,addAudit,syncCopies
};
