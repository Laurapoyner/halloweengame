'use strict';
/* Heksens Trylledrik – en lille server, der viser spillet og gemmer alle holdenes fremskridt ét sted (MongoDB).

   Start:   node server.js
   Render:  New → Web Service, Build Command "npm install", Start Command "node server.js"

   Miljøvariabler:
     MONGODB_URI   Forbindelsesadressen fra MongoDB Atlas (mongodb+srv://…). Uden den gemmes holdene kun
                   i serverens hukommelse og glemmes, når serveren genstarter (telefonerne sender dem dog op igen).
     MONGODB_DB    Databasens navn (valgfri, standard "heksens-trylledrik").
     PORT          Sættes automatisk af Render.

   Telefonerne gemmer altid alt selv først, så spillet virker uden net. Ændringer sendes i en kø til /api/sync.
   Serveren bestemmer: sletter en voksen en opgave, forsvinder den også på holdets telefon. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEFAULT_SETTINGS = { _id: 'settings', pin: '1031', secret: 'HALLOWEENGODTERI', easy: false, at: 0 };
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const TASK_RE = /^[a-z0-9-]{1,40}$/;
const MAX_PHOTO = 600 * 1024;          // et billede fra spillet fylder typisk 20–60 kB
const MAX_BODY = 4 * 1024 * 1024;
const MAX_OPS = 40;
const PIC = 'holdbillede';            // holdbilledet gemmes sammen med opgavebillederne under dette navn

/* ================= Reglerne for ændringer (de samme, uanset hvor holdene gemmes) ================= */
const cleanName = n => String(n == null ? '' : n).trim().slice(0, 40) || 'Hold';
const cleanPlayers = p => Math.min(8, Math.max(1, parseInt(p, 10) || 3));
const num = (x, d) => (x !== null && x !== '' && Number.isFinite(+x)) ? +x : d;

function newTeam(id, name, players, now){
  return { _id: id, name: cleanName(name), players: cleanPlayers(players), done: {}, cleared: {},
           resetAt: 0, metaAt: 0, created: now, updated: now, v: 0 };
}

/* Lægger en række ændringer oven i et hold. Tidsstempler (at) er serverens tid, som telefonen har regnet ud.
   - done:     en opgave er løst (med billede). Afvises, hvis en voksen har slettet opgaven/holdet bagefter.
   - undo:     en voksen sletter én opgave.           (kræver voksen-koden)
   - reset:    en voksen sletter alt, holdet har lavet. (kræver voksen-koden)
   - meta:     holdets navn og antal børn.
   - teampic:  holdbilledet (eller intet billede).
   - settings: fælles kodeord, voksen-kode og nem tilstand for alle hold. (kræver voksen-koden) */
function applyOps(team, ops, settings, adminOk, now){
  const out = { photos: new Map(), settings: null, badKode: false, changed: false };
  const kodeOk = op => adminOk || (op.kode != null && String(op.kode) === String(settings.pin));
  for (const op of ops){
    if (!op || typeof op !== 'object') continue;
    const at = Math.min(num(op.at, now), now + 60000);
    const task = String(op.task || '');
    if (op.type === 'done'){
      if (!TASK_RE.test(task) || task === PIC) continue;
      if (at <= (team.cleared[task] || 0) || at <= (team.resetAt || 0)) continue;  // løst før en voksen slettede den
      const old = team.done[task];
      if (old && old.at > at) continue;
      const photo = validPhoto(op.photo);
      team.done[task] = { at, by: String(op.by || '').slice(0, 12), hasPhoto: !!photo };
      out.photos.set(task, photo ? { data: photo, at } : null);
      out.changed = true;
    } else if (op.type === 'undo'){
      if (!TASK_RE.test(task) || task === PIC) continue;
      if (!kodeOk(op)){ out.badKode = true; continue; }
      team.cleared[task] = Math.max(team.cleared[task] || 0, at);
      const old = team.done[task];
      if (old && old.at <= at){ delete team.done[task]; out.photos.set(task, null); }
      out.changed = true;
    } else if (op.type === 'reset'){
      if (!kodeOk(op)){ out.badKode = true; continue; }
      team.resetAt = Math.max(team.resetAt || 0, at);
      for (const [k, d] of Object.entries(team.done)) if (d.at <= team.resetAt){ delete team.done[k]; out.photos.set(k, null); }
      for (const [k, c] of Object.entries(team.cleared)) if (c <= team.resetAt) delete team.cleared[k];
      out.changed = true;
    } else if (op.type === 'meta'){
      if (at < (team.metaAt || 0)) continue;
      if (op.name != null) team.name = cleanName(op.name);
      if (op.players != null) team.players = cleanPlayers(op.players);
      team.metaAt = at;
      out.changed = true;
    } else if (op.type === 'teampic'){
      if (at < ((team.pic && team.pic.at) || 0)) continue;
      const photo = validPhoto(op.photo);
      team.pic = { at, on: !!photo };
      out.photos.set(PIC, photo ? { data: photo, at } : null);
      out.changed = true;
    } else if (op.type === 'settings'){
      if (!kodeOk(op)){ out.badKode = true; continue; }
      const s = Object.assign({}, out.settings || settings);
      if (at <= (s.at || 0)) continue;
      if (op.pin != null && /^[0-9A-Za-z]{1,8}$/.test(String(op.pin))) s.pin = String(op.pin);
      if (op.secret != null){
        const w = String(op.secret).toUpperCase().replace(/[^A-ZÆØÅ]/g, '').slice(0, 16);
        if (w) s.secret = w;
      }
      if (op.easy != null) s.easy = !!op.easy;
      s.at = at;
      out.settings = s;
      settings = s;   // senere ændringer i samme omgang bruger den nye kode
    }
  }
  if (out.changed) team.updated = now;
  return out;
}

const validPhoto = x => typeof x === 'string' && x.startsWith('data:image/') && x.length <= MAX_PHOTO ? x : null;
const pubTeam = t => ({ id: t._id, name: t.name, players: t.players, done: t.done || {}, resetAt: t.resetAt || 0,
                         metaAt: t.metaAt || 0, created: t.created || 0, updated: t.updated || 0, pic: t.pic || { at: 0, on: false } });
// Til listen "Find jeres hold": kun det, der skal vises
const listTeam = t => ({ id: t._id, name: t.name, players: t.players, count: Object.keys(t.done || {}).length,
                          updated: t.updated || 0, metaAt: t.metaAt || 0, pic: t.pic || { at: 0, on: false } });
const pubSettings = s => ({ secret: s.secret, easy: !!s.easy, at: s.at || 0 });

/* ================= Hvor holdene gemmes ================= */
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));

/* Uden database: i serverens hukommelse (kun til afprøvning – glemmes ved genstart) */
class MemoryStore {
  constructor(){ this.kind = 'memory'; this.teams = new Map(); this.photos = new Map(); this.tombs = new Set(); this.settings = clone(DEFAULT_SETTINGS); }
  async ready(){}
  async getTeam(id){ return clone(this.teams.get(id) || null); }
  async saveTeam(t, isNew){
    const cur = this.teams.get(t._id);
    if (isNew ? cur : (!cur || cur.v !== t.v)) return false;
    this.teams.set(t._id, clone(Object.assign({}, t, { v: (isNew ? 0 : t.v) + 1 })));
    return true;
  }
  async listTeams(){ return [...this.teams.values()].map(clone).sort((a, b) => b.updated - a.updated); }
  async deleteTeam(id){ this.teams.delete(id); this.tombs.add(id); for (const k of [...this.photos.keys()]) if (k.startsWith(id + ':')) this.photos.delete(k); }
  async isTomb(id){ return this.tombs.has(id); }
  async clearTomb(id){ this.tombs.delete(id); }
  async getSettings(){ return clone(this.settings); }
  async saveSettings(s){ this.settings = clone(Object.assign({}, s, { _id: 'settings' })); }
  async putPhotos(team, map){ for (const [task, p] of map){ const k = team + ':' + task; if (p) this.photos.set(k, { data: p.data, at: p.at }); else this.photos.delete(k); } }
  async getPhotos(team){ const o = {}; for (const [k, p] of this.photos) if (k.startsWith(team + ':')) o[k.slice(team.length + 1)] = p.data; return o; }
  async getPhoto(team, task){ const p = this.photos.get(team + ':' + task); return p ? p.data : null; }
}

/* MongoDB (fx MongoDB Atlas' gratis M0-klynge) */
class MongoStore {
  constructor(uri){
    const { MongoClient } = require('mongodb');
    this.kind = 'mongo';
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    this.p = null;
    this.lastError = null;
  }
  ready(){
    if (!this.p){
      this.p = this.client.connect().then(async () => {
        const db = this.client.db(process.env.MONGODB_DB || 'heksens-trylledrik');
        this.teams = db.collection('teams');
        this.photoCol = db.collection('photos');
        this.meta = db.collection('meta');
        await this.photoCol.createIndex({ team: 1 }).catch(() => {});
        this.lastError = null;
      });
      this.p.catch(e => { this.lastError = e; this.p = null; });
    }
    return this.p;
  }
  async getTeam(id){ await this.ready(); return this.teams.findOne({ _id: id }); }
  async saveTeam(t, isNew){
    await this.ready();
    if (isNew){
      try { await this.teams.insertOne(Object.assign({}, t, { v: 1 })); return true; }
      catch (e) { if (e && e.code === 11000) return false; throw e; }
    }
    const r = await this.teams.replaceOne({ _id: t._id, v: t.v }, Object.assign({}, t, { v: t.v + 1 }));
    return r.matchedCount === 1;
  }
  async listTeams(){ await this.ready(); return this.teams.find({}).sort({ updated: -1 }).limit(300).toArray(); }
  async deleteTeam(id){
    await this.ready();
    await this.teams.deleteOne({ _id: id });
    await this.photoCol.deleteMany({ team: id });
    await this.meta.replaceOne({ _id: 'tomb:' + id }, { _id: 'tomb:' + id, at: Date.now() }, { upsert: true });
  }
  async isTomb(id){ await this.ready(); return !!(await this.meta.findOne({ _id: 'tomb:' + id })); }
  async clearTomb(id){ await this.ready(); await this.meta.deleteOne({ _id: 'tomb:' + id }); }
  async getSettings(){ await this.ready(); const s = await this.meta.findOne({ _id: 'settings' }); return Object.assign({}, DEFAULT_SETTINGS, s || {}); }
  async saveSettings(s){ await this.ready(); await this.meta.replaceOne({ _id: 'settings' }, Object.assign({}, s, { _id: 'settings' }), { upsert: true }); }
  async putPhotos(team, map){
    await this.ready();
    for (const [task, p] of map){
      const _id = team + ':' + task;
      if (p) await this.photoCol.replaceOne({ _id }, { _id, team, task, data: p.data, at: p.at }, { upsert: true });
      else await this.photoCol.deleteOne({ _id });
    }
  }
  async getPhotos(team){
    await this.ready();
    const o = {};
    for (const p of await this.photoCol.find({ team }).toArray()) o[p.task] = p.data;
    return o;
  }
  async getPhoto(team, task){ await this.ready(); const p = await this.photoCol.findOne({ _id: team + ':' + task }); return p ? p.data : null; }
}

/* ================= API ================= */
function makeApi(store){
  const kodeOk = (req, settings) => req.headers['x-kode'] != null && String(req.headers['x-kode']) === String(settings.pin);

  // Henter holdet, lægger ændringerne oven i og gemmer – prøver igen, hvis en anden telefon nåede at gemme imens
  async function change(id, ops, opts){
    const now = Date.now();
    let settings = await store.getSettings();
    for (let attempt = 0; attempt < 8; attempt++){
      let team = await store.getTeam(id), isNew = false;
      if (!team){
        if (!opts.create) return { missing: true };
        // Har en voksen fjernet holdet, oprettes det ikke igen: telefonen viser velkomstskærmen i stedet
        if (await store.isTomb(id)) return { deleted: true, settings, now };
        isNew = true;
        team = newTeam(id, opts.name, opts.players, now);
      }
      const res = applyOps(team, ops, settings, opts.adminOk, now);
      if ((isNew || res.changed) && !(await store.saveTeam(team, isNew))) continue;
      if (res.photos.size) await store.putPhotos(id, res.photos);
      if (res.settings){ await store.saveSettings(res.settings); settings = res.settings; }
      return { team, settings, created: isNew, badKode: res.badKode, now };
    }
    throw new Error('travlt');
  }

  return async function api(req, res, url, body){
    const p = url.pathname;
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

    if (p === '/api/health'){
      try { await store.ready(); return send(200, { ok: true, db: store.kind, now: Date.now() }); }
      catch (e) { return send(503, { ok: false, db: store.kind, error: 'db', message: dbMessage(e) }); }
    }
    if (p === '/api/sync' && req.method === 'POST'){
      const id = String(body.team || '');
      if (!ID_RE.test(id)) return send(400, { error: 'team' });
      const ops = Array.isArray(body.ops) ? body.ops.slice(0, MAX_OPS) : [];
      const settings = await store.getSettings();
      const r = await change(id, ops, { create: true, name: body.name, players: body.players, adminOk: kodeOk(req, settings) });
      if (r.deleted) return send(200, { deleted: true, settings: pubSettings(r.settings), now: r.now, db: store.kind });
      return send(200, { team: pubTeam(r.team), settings: pubSettings(r.settings), now: r.now, db: store.kind,
                         created: r.created, badKode: r.badKode });
    }
    // Listen på velkomstskærmen: "Find jeres hold"
    if (p === '/api/teams' && req.method === 'GET'){
      return send(200, { teams: (await store.listTeams()).map(listTeam), now: Date.now(), db: store.kind });
    }
    // Holdbilledet som almindeligt billede (gemmes i browserens cache, fordi adressen skifter, når billedet skiftes)
    if (p === '/api/teampic' && req.method === 'GET'){
      const id = String(url.searchParams.get('team') || '');
      if (!ID_RE.test(id)) return send(400, { error: 'team' });
      const data = await store.getPhoto(id, PIC);
      const m = data && /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(data);
      if (!m) return send(404, { error: 'intet billede' });
      res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      return res.end(Buffer.from(m[2], 'base64'));
    }
    if (p === '/api/photos' && req.method === 'GET'){
      const id = String(url.searchParams.get('team') || '');
      if (!ID_RE.test(id)) return send(400, { error: 'team' });
      return send(200, { photos: await store.getPhotos(id) });
    }
    if (p === '/api/pin' && req.method === 'POST'){
      const s = await store.getSettings();
      return send(200, { ok: body.kode != null && String(body.kode) === String(s.pin) });
    }

    /* Voksen-oversigten: kræver voksen-koden i "X-Kode" */
    if (p.startsWith('/api/admin/')){
      const settings = await store.getSettings();
      if (!kodeOk(req, settings)) return send(401, { error: 'kode' });
      if (p === '/api/admin/teams' && req.method === 'GET'){
        const teams = (await store.listTeams()).map(pubTeam);
        return send(200, { teams, now: Date.now(), db: store.kind });
      }
      if (p === '/api/admin/team' && req.method === 'POST'){
        const id = String(body.team || '');
        if (!ID_RE.test(id)) return send(400, { error: 'team' });
        const ops = Array.isArray(body.ops) ? body.ops.slice(0, MAX_OPS) : [];
        const r = await change(id, ops, { create: false, adminOk: true });
        if (r.missing) return send(404, { error: 'missing' });
        return send(200, { team: pubTeam(r.team), now: r.now });
      }
      if (p === '/api/admin/delete' && req.method === 'POST'){
        const id = String(body.team || '');
        if (!ID_RE.test(id)) return send(400, { error: 'team' });
        await store.deleteTeam(id);
        return send(200, { ok: true });
      }
    }
    return send(404, { error: 'ukendt' });
  };
}

function dbMessage(e){
  const m = String((e && (e.message || e.codeName)) || e || '');
  if (/auth|password|bad auth/i.test(m)) return 'Databasen afviste brugernavn eller adgangskode. Tjek MONGODB_URI på Render (husk at erstatte <db_password>).';
  if (/ENOTFOUND|querySrv|Invalid scheme|URI/i.test(m)) return 'Adressen i MONGODB_URI ser forkert ud. Kopiér den igen fra MongoDB Atlas.';
  if (/timed out|Server selection|ECONNREFUSED|whitelist|IP/i.test(m)) return 'Databasen svarer ikke. Tjek, at Network Access i MongoDB Atlas tillader 0.0.0.0/0.';
  return 'Databasen kunne ikke nås: ' + m.slice(0, 160);
}

/* ================= Filer: selve spillet og lydfilerne ================= */
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveFile(res, file, cache){
  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Ikke fundet'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}

function readBody(req){
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST'){ resolve({}); return; }
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY){ reject(Object.assign(new Error('for stor'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) || {}); }
      catch (e) { reject(Object.assign(new Error('json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function createServer(store){
  const api = makeApi(store);
  return http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
    const p = decodeURIComponent(url.pathname);
    try {
      if (p.startsWith('/api/')) return await api(req, res, url, await readBody(req));
      if (req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405); return res.end(); }
      if (p === '/' || p === '/index.html') return serveFile(res, path.join(ROOT, 'index.html'), 'no-cache');
      if (p.startsWith('/lyd/')){
        const file = path.normalize(path.join(ROOT, p));
        if (!file.startsWith(path.join(ROOT, 'lyd') + path.sep)){ res.writeHead(404); return res.end(); }
        return serveFile(res, file, p.endsWith('.json') ? 'no-cache' : 'public, max-age=300');
      }
      if (p === '/favicon.ico'){ res.writeHead(204); return res.end(); }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Ikke fundet');
    } catch (e) {
      const status = e.status || 503;
      if (!e.status) console.error('Fejl:', e && e.message);
      if (!res.headersSent){
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: status === 503 ? 'db' : 'fejl', message: status === 503 ? dbMessage(e) : e.message }));
      }
    }
  });
}

function makeStore(){
  const uri = (process.env.MONGODB_URI || '').trim();
  if (!uri){
    console.warn('OBS: MONGODB_URI er ikke sat. Holdene gemmes kun i hukommelsen og glemmes, når serveren genstarter.');
    return new MemoryStore();
  }
  return new MongoStore(uri);
}

if (require.main === module){
  const store = makeStore();
  if (store.ready) store.ready().then(() => console.log('Forbundet til databasen (' + store.kind + ').'),
                                      e => console.error('Databasen kunne ikke nås endnu:', dbMessage(e)));
  const port = process.env.PORT || 3000;
  createServer(store).listen(port, () => console.log('Heksens Trylledrik kører på port ' + port));
}

module.exports = { applyOps, newTeam, MemoryStore, MongoStore, createServer, makeApi, DEFAULT_SETTINGS };
