const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./storage');

const USERS_FILE = path.join(storage.DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(storage.DATA_DIR, 'sessions.json');
const SESSION_COOKIE = 'sipus_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const sessions = new Map();

function readUsers(){try{return JSON.parse(fs.readFileSync(USERS_FILE,'utf8'));}catch{return [];}}
function saveUsers(users){storage.atomicWrite(USERS_FILE, users);}
function loadSessions(){try{const raw=JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf8'));const now=Date.now();for(const [token,s] of Object.entries(raw||{})){if(s&&s.expires>now)sessions.set(token,s);}}catch(_){}}
function persistSessions(){storage.atomicWrite(SESSIONS_FILE,Object.fromEntries(sessions));}
loadSessions();

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
function isLockedOut(id){const e=loginAttempts.get(id);if(!e)return false;if(e.lockedUntil>Date.now())return true;loginAttempts.delete(id);return false;}
function recordFailedAttempt(id){const e=loginAttempts.get(id)||{count:0,lockedUntil:0};e.count++;if(e.count>=MAX_ATTEMPTS)e.lockedUntil=Date.now()+LOCKOUT_MS;loginAttempts.set(id,e);}
function clearFailedAttempts(id){loginAttempts.delete(id);}

function hashPasswordLegacy(password){return crypto.createHash('sha256').update(String(password)).digest('hex');}
function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const derived=crypto.scryptSync(String(password),salt,64,{N:16384,r:8,p:1}).toString('hex');
  return `scrypt$16384$8$1$${salt}$${derived}`;
}
function verifyPassword(password,stored){
  try{
    if(!stored)return false;
    if(String(stored).startsWith('scrypt$')){
      const parts=String(stored).split('$');
      if(parts.length!==6)return false;
      const [,nRaw,rRaw,pRaw,salt,hash]=parts;
      const n=Number(nRaw),r=Number(rRaw),p=Number(pRaw);
      if(!Number.isSafeInteger(n)||!Number.isSafeInteger(r)||!Number.isSafeInteger(p)||!salt||!hash||hash.length%2!==0)return false;
      const derived=crypto.scryptSync(String(password),salt,64,{N:n,r,p}).toString('hex');
      const a=Buffer.from(derived,'hex'), b=Buffer.from(hash,'hex');
      return a.length===b.length && crypto.timingSafeEqual(a,b);
    }
    return hashPasswordLegacy(password)===stored;
  }catch{return false;}
}
function verifyLogin(username,password){
  const clean=String(username||'').trim().toLowerCase();
  const users=readUsers();
  const idx=users.findIndex(u=>String(u.username||'').toLowerCase()===clean);
  if(idx<0)return null;
  const user=users[idx];
  if(user.active===false)return null;
  if(!verifyPassword(password||'',user.passwordHash))return null;
  if(!String(user.passwordHash||'').startsWith('scrypt$')){user.passwordHash=hashPassword(password||'');saveUsers(users);}
  return {username:user.username,name:user.name,role:user.role||'anggota',memberId:user.memberId||null,active:user.active!==false};
}
function registerUser(){ return {error:'Pembuatan akun anggota dinonaktifkan. Hanya Admin yang dapat menambahkan data anggota.'}; }
function registerStaff({username,password,name,role='petugas'}){
  const cleanUsername=String(username||'').trim().toLowerCase();
  const cleanName=String(name||'').trim();
  if(!cleanUsername||!password||!cleanName)return{error:'Semua kolom wajib diisi.'};
  if(!/^[a-z0-9._-]{3,32}$/.test(cleanUsername))return{error:'Username 3–32 karakter, hanya huruf kecil/angka/titik/garis.'};
  if(String(password).length<6)return{error:'Password minimal 6 karakter.'};
  if(role!=='petugas')return{error:'Role admin utama tidak dapat dibuat dari form ini.'};
  const users=readUsers();
  if(users.some(u=>String(u.username||'').toLowerCase()===cleanUsername))return{error:'Username sudah dipakai, coba yang lain.'};
  const user={username:cleanUsername,name:cleanName,passwordHash:hashPassword(password),role:'petugas',memberId:null,active:true};
  users.push(user);saveUsers(users);return{user:{username:user.username,name:user.name,role:user.role,memberId:null,active:true}};
}
function updateUser(username,changes){const users=readUsers();const i=users.findIndex(u=>u.username===username);if(i<0)return null;users[i]={...users[i],...changes};saveUsers(users);return users[i];}
function getUsers(){return readUsers();}
function createSession(user){if(!user||!user.username)return null;const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{...user,expires:Date.now()+SESSION_MAX_AGE_MS});try{persistSessions();}catch{return null;}return token;}
function destroySession(token){sessions.delete(token);try{persistSessions();}catch{}}
function parseCookies(req){const cookies={};const header=req.headers.cookie||'';for(const part of header.split(';')){const idx=part.indexOf('=');if(idx<0)continue;try{cookies[part.slice(0,idx).trim()]=decodeURIComponent(part.slice(idx+1).trim());}catch{}}return cookies;}
function getTokenFromRequest(req){return parseCookies(req)[SESSION_COOKIE];}
function getSessionUser(req){
  const token=getTokenFromRequest(req); if(!token)return null;
  const session=sessions.get(token); if(!session)return null;
  if(session.expires<Date.now()){destroySession(token);return null;}
  const current=readUsers().find(u=>u.username===session.username);
  if(!current||current.active===false){destroySession(token);return null;}
  const refreshed={username:current.username,name:current.name,role:current.role||'anggota',memberId:current.memberId||null,active:current.active!==false,expires:session.expires};
  if(session.name!==refreshed.name||session.role!==refreshed.role||session.memberId!==refreshed.memberId||session.active!==refreshed.active){sessions.set(token,refreshed);try{persistSessions();}catch{}}
  return refreshed;
}
function setSessionCookie(res,token){res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS/1000)}; SameSite=Lax`);}
function clearSessionCookie(res){res.setHeader('Set-Cookie',`${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);}
module.exports={verifyLogin,registerUser,registerStaff,updateUser,createSession,destroySession,getSessionUser,setSessionCookie,clearSessionCookie,getTokenFromRequest,isLockedOut,recordFailedAttempt,clearFailedAttempts,getUsers,hashPassword};
