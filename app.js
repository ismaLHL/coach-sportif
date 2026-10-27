/* Coach Sportif — app de séance hors ligne.
   Les séances et résultats vivent dans un dépôt GitHub privé (coach-sportif-data),
   copiés sur le téléphone pour fonctionner sans réseau. */
(function(){
"use strict";

/* ---------- Réglages et stockage local ---------- */
var CFG_KEY = "cs-config", SES_KEY = "cs-sessions", RES_KEY = "cs-results", META_KEY = "cs-meta";
var DEF = { owner:"ismaLHL", repo:"coach-sportif-data", branch:"main", token:"" };
var IMG_BASE = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/";
var IMG_CACHE = "cs-img-v1";

function load(k, d){ try{ var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }catch(e){ return d; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

var S = {
  cfg: Object.assign({}, DEF, load(CFG_KEY, {})),
  sessions: load(SES_KEY, {}),   // id -> {sha, data}
  results: load(RES_KEY, {}),    // id -> {sha, data, dirty}
  meta: load(META_KEY, {}),
  sid: null, view: "overview", timer: null,
  syncing: false, sync: { txt:"", cls:"" },
  copyText: null, pendingRender: false, flash: null, noteOpen: null
};

var $ = function(s){ return document.querySelector(s); };
var app = $("#app");
function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
function num(v){ if (v === "" || v == null) return null; var n = Number(String(v).replace(",", ".")); return isNaN(n) ? null : n; }
function fmt(sec){ sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec/60), s = sec%60; return m + ":" + (s<10?"0":"") + s; }
function fmtLong(sec){ sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60; return (h ? h+":"+(m<10?"0":"") : "") + m + ":" + (s<10?"0":"") + s; }
function parseDate(d){ return new Date(d && d.length === 10 ? d + "T12:00:00" : d); }
function dateFr(d, long){ if (!d) return ""; var x = parseDate(d); if (isNaN(x)) return String(d);
  return long ? x.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}) : x.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"}); }
function ago(iso){ if (!iso) return "jamais"; var s = (Date.now() - new Date(iso))/1000;
  if (s < 60) return "à l'instant"; if (s < 3600) return "il y a " + Math.round(s/60) + " min"; if (s < 86400) return "il y a " + Math.round(s/3600) + " h"; return "le " + dateFr(iso); }

/* ---------- Données de séance ---------- */
function sessionIds(){ return Object.keys(S.sessions).sort(function(a, b){ var da = (S.sessions[a].data||{}).date || a, db = (S.sessions[b].data||{}).date || b; return da < db ? -1 : da > db ? 1 : (a < b ? -1 : 1); }); }
function isDone(id){ var r = S.results[id]; return !!(r && r.data && r.data.status === "terminée"); }
function pickDefault(){ var ids = sessionIds().filter(function(id){ return (S.sessions[id].data||{}).status !== "archivée"; });
  var open = ids.filter(function(id){ return !isDone(id); }); return open[0] || ids[ids.length-1] || sessionIds()[sessionIds().length-1] || null; }
function session(){ return S.sid && S.sessions[S.sid] ? S.sessions[S.sid].data : null; }
function exercises(){ var s = session(); return (s && Array.isArray(s.exercises)) ? s.exercises : []; }
function exId(ex, i){ return String(ex.id || ("e"+i)); }
function nSets(ex){ return Math.max(1, Number(ex.sets) || (Array.isArray(ex.targets) ? ex.targets.length : 1)); }
function tgt(ex, j){ return (Array.isArray(ex.targets) && ex.targets[j]) || ex.target || {}; }
function isTimed(ex){ if (ex.mode) return ex.mode === "time"; var t = tgt(ex,0); return t.time != null && t.reps == null; }
function newResult(sid){ return { sessionId:sid, status:"prévue", startedAt:null, finishedAt:null, durationMin:null, sets:{}, exNotes:{}, feeling:null, pain:"", notes:"", updatedAt:"" }; }
function result(){ if (!S.sid) return null; var r = S.results[S.sid]; if (!r){ r = S.results[S.sid] = { sha:null, data:newResult(S.sid), dirty:false }; } if (!r.data.sets) r.data.sets = {}; return r.data; }
function getSet(i, j){ var ex = exercises()[i]; var a = result().sets[exId(ex,i)]; return (a && a[j]) || {}; }
function patchSet(i, j, patch){ var ex = exercises()[i], id = exId(ex,i), R = result(); var a = R.sets[id] || (R.sets[id] = []);
  while (a.length <= j) a.push({}); var cur = a[j] || {}; for (var k in patch) cur[k] = patch[k]; a[j] = cur; }
function exNote(i){ var ex = exercises()[i], R = result(); return (R.exNotes && R.exNotes[exId(ex,i)]) || ""; }
function setExNote(i, v){ var ex = exercises()[i], R = result(); if (!R.exNotes) R.exNotes = {}; var id = exId(ex,i); if (v) R.exNotes[id] = v; else delete R.exNotes[id]; }
function doneCount(i){ var ex = exercises()[i], c = 0; for (var j=0;j<nSets(ex);j++) if (getSet(i,j).done) c++; return c; }
function weightTxt(w, ex){ if (w == null || w === "") return (ex && ex.equip) ? "" : "PDC"; return String(w).replace(".",",") + " kg"; }
function setTxt(s, ex){ if (!s) return "";
  if (s.time != null && s.reps == null) return s.time + " s" + (s.weight != null ? " · " + weightTxt(s.weight) : "");
  var r = (s.reps != null ? s.reps : "?"); var w = weightTxt(s.weight, ex); return r + (w && w !== "PDC" ? " × " + w : ""); }
function restTxt(ex){ return "repos " + fmt(ex.rest || 0); }
function targetSummary(ex){ var n = nSets(ex), w0;
  if (Array.isArray(ex.targets) && ex.targets.length){
    var parts = ex.targets.map(function(t){ return t.time != null && t.reps == null ? t.time + " s" : (t.reps != null ? t.reps : "?"); });
    w0 = ex.targets[0].weight; return { v: parts.join(" · "), s: (w0 != null ? weightTxt(w0) + " · " : (ex.equip ? "" : "poids du corps · ")) + restTxt(ex) }; }
  var t = ex.target || {}; var v = isTimed(ex) ? n + " × " + (t.time || "?") + " s" : n + " × " + (t.reps != null ? t.reps : "?");
  return { v: v, s: (t.weight != null ? weightTxt(t.weight) + " · " : (ex.equip ? "" : "poids du corps · ")) + restTxt(ex) }; }
function prevSummary(ex){ var p = ex.prev; if (!p) return null;
  var v = p.summary || (Array.isArray(p.sets) ? p.sets.map(function(s){ return setTxt(s, ex); }).join(" · ") : "");
  return { v: v || "—", s: p.date ? "le " + dateFr(p.date) : "", note: p.note || "" }; }
function imagesOf(ex){ if (Array.isArray(ex.images) && ex.images.length) return ex.images.filter(function(u){ return /^https:\/\//.test(u); }).slice(0,2);
  if (ex.img && /^[A-Za-z0-9_\-().,]+$/.test(ex.img)) return [IMG_BASE + ex.img + "/0.jpg", IMG_BASE + ex.img + "/1.jpg"]; return []; }

/* ---------- GitHub ---------- */
function gh(path, opt){ opt = opt || {}; var c = S.cfg;
  var headers = { "Authorization":"Bearer " + c.token, "X-GitHub-Api-Version":"2022-11-28", "Accept": opt.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" };
  if (opt.body) headers["Content-Type"] = "application/json";
  return fetch("https://api.github.com/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo) + "/" + path,
    { method: opt.method || "GET", cache:"no-store", headers: headers, body: opt.body ? JSON.stringify(opt.body) : undefined })
  .then(function(r){
    if (r.status === 404 && opt.allow404) return null;
    if (!r.ok){ var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return opt.raw ? r.text() : r.json(); }); }
function b64(str){ var bytes = new TextEncoder().encode(str), bin = ""; for (var i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
function refQ(){ return "?ref=" + encodeURIComponent(S.cfg.branch || "main"); }
function pendingCount(){ var n = 0; for (var id in S.results) if (S.results[id].dirty) n++; return n; }

function setSync(txt, cls){ S.sync = { txt: txt, cls: cls || "" }; var el = $("#sync"); el.className = "sync " + (cls || ""); el.querySelector("span").textContent = txt; }
function idleSyncLabel(){
  if (!S.cfg.token) return setSync("Clé à configurer", "err");
  var p = pendingCount();
  if (!navigator.onLine) return setSync(p ? "Hors ligne · " + p + " à envoyer" : "Hors ligne", "off");
  if (p) return setSync(p + " à envoyer", "off");
  setSync(S.meta.lastSync ? "Synchro " + ago(S.meta.lastSync) : "", "ok"); }

function sync(){
  if (S.syncing) return Promise.resolve();
  if (!S.cfg.token || !navigator.onLine){ idleSyncLabel(); return Promise.resolve(); }
  S.syncing = true; setSync("Synchronisation…", "");
  var changed = false;
  return gh("contents/" + refQ(), { allow404:true }).then(function(root){
    if (root === null){ var e = new Error("no access"); e.status = 404; throw e; }
    return gh("contents/sessions" + refQ(), { allow404:true }); }).then(function(list){
    list = Array.isArray(list) ? list : [];
    var seen = {}, jobs = [];
    list.forEach(function(f){ if (f.type !== "file" || !/\.json$/.test(f.name)) return; var id = f.name.slice(0, -5); seen[id] = 1;
      var cur = S.sessions[id]; if (cur && cur.sha === f.sha) return;
      jobs.push(gh("contents/" + f.path.split("/").map(encodeURIComponent).join("/") + refQ(), { raw:true }).then(function(txt){
        try{ S.sessions[id] = { sha:f.sha, data:JSON.parse(txt) }; changed = true; }catch(e){ console.warn("Séance illisible :", f.name); } })); });
    return Promise.all(jobs).then(function(){
      Object.keys(S.sessions).forEach(function(id){ if (!seen[id]){ delete S.sessions[id]; changed = true; } });
      save(SES_KEY, S.sessions); }); })
  .then(function(){ return gh("contents/results" + refQ(), { allow404:true }); })
  .then(function(list){
    list = Array.isArray(list) ? list : []; var jobs = [];
    list.forEach(function(f){ if (!/\.json$/.test(f.name)) return; var id = f.name.slice(0, -5), loc = S.results[id];
      if (loc && loc.sha === f.sha) return;
      jobs.push(gh("contents/" + f.path.split("/").map(encodeURIComponent).join("/") + refQ(), { raw:true }).then(function(txt){
        var remote; try{ remote = JSON.parse(txt); }catch(e){ return; }
        if (loc && loc.dirty && (loc.data.updatedAt || "") >= (remote.updatedAt || "")) { loc.sha = f.sha; }
        else { S.results[id] = { sha:f.sha, data:remote, dirty:false }; changed = true; } })); });
    return Promise.all(jobs); })
  .then(function(){ save(RES_KEY, S.results);
    var ids = Object.keys(S.results).filter(function(id){ return S.results[id].dirty; });
    return ids.reduce(function(p, id){ return p.then(function(){ return pushResult(id); }); }, Promise.resolve()); })
  .then(function(){ S.meta.lastSync = new Date().toISOString(); save(META_KEY, S.meta); S.syncing = false; idleSyncLabel();
    if (!S.sid || !S.sessions[S.sid]) { S.sid = pickDefault(); S.view = "overview"; changed = true; }
    if (changed) render(); precacheImages(); })
  .catch(function(e){ S.syncing = false;
    if (e && (e.status === 401 || e.status === 403)) setSync("Clé refusée", "err");
    else if (e && e.status === 404) setSync("Dépôt inaccessible", "err");
    else idleSyncLabel();
    S.meta.lastError = e && e.status ? String(e.status) : "réseau"; save(META_KEY, S.meta);
    if (S.view === "settings") render(); }); }

function pushResult(id){
  var r = S.results[id]; if (!r || !r.dirty) return Promise.resolve();
  var str = JSON.stringify(r.data, null, 2) + "\n";
  var path = "contents/results/" + encodeURIComponent(id) + ".json";
  function put(sha){ var body = { message:"Résultats " + id, content:b64(str), branch:S.cfg.branch || "main" }; if (sha) body.sha = sha;
    return gh(path, { method:"PUT", body:body }); }
  return put(r.sha).catch(function(e){
    if (e.status !== 409 && e.status !== 422) throw e;
    return gh(path + refQ(), { allow404:true }).then(function(m){ return put(m ? m.sha : null); }); })
  .then(function(res){ r.sha = res && res.content ? res.content.sha : r.sha;
    if (JSON.stringify(r.data, null, 2) + "\n" === str) r.dirty = false; save(RES_KEY, S.results); }); }

var syncT = null;
function scheduleSync(ms){ clearTimeout(syncT); syncT = setTimeout(sync, ms || 3000); }
window.addEventListener("online", function(){ sync(); });
window.addEventListener("offline", idleSyncLabel);
document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "visible") sync(); else if (pendingCount()) sync(); });
setInterval(function(){ if (!S.timer) sync(); }, 5 * 60 * 1000);

function markDirty(){ var r = S.results[S.sid]; if (!r) return; r.data.updatedAt = new Date().toISOString(); r.dirty = true; save(RES_KEY, S.results); idleSyncLabel(); scheduleSync(4000); }

/* ---------- Images hors ligne ---------- */
var precaching = false;
function precacheImages(){
  if (!("caches" in window) || precaching || !navigator.onLine) return Promise.resolve();
  precaching = true; var urls = [];
  Object.keys(S.sessions).forEach(function(id){ if (isDone(id)) return; ((S.sessions[id].data||{}).exercises || []).forEach(function(ex){ imagesOf(ex).forEach(function(u){ if (urls.indexOf(u) < 0) urls.push(u); }); }); });
  return caches.open(IMG_CACHE).then(function(c){ var ok = 0;
    return urls.reduce(function(p, u){ return p.then(function(){ return c.match(u).then(function(hit){ if (hit){ ok++; return; }
      var cors = u.indexOf("https://cdn.jsdelivr.net/") === 0;
      return fetch(u, { mode: cors ? "cors" : "no-cors" }).then(function(r){ if (r.ok || r.type === "opaque"){ ok++; return c.put(u, r); } }).catch(function(){}); }); }); }, Promise.resolve())
    .then(function(){ S.meta.imgs = { ok:ok, n:urls.length, at:new Date().toISOString() }; save(META_KEY, S.meta); precaching = false; if (S.view === "settings") render(); }); })
  .catch(function(){ precaching = false; }); }

/* ---------- Rendu ---------- */
function render(){
  var ae = document.activeElement;
  if (ae && app.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName)) { S.pendingRender = true; return; }
  S.pendingRender = false;
  var html;
  if (S.view === "settings") html = viewSettings();
  else if (!S.cfg.token) html = viewSetup();
  else if (!session()) html = viewEmpty();
  else if (S.view === "overview") html = viewOverview();
  else if (S.view === "end") html = viewEnd();
  else html = viewExercise(S.view);
  app.innerHTML = html;
  app.classList.toggle("with-sheet", !!S.timer);
  if (typeof S.view === "number") startVisual(); else stopFig();
  tickChrono();
}
app.addEventListener("focusout", function(){ setTimeout(function(){ if (S.pendingRender) render(); }, 0); });

function tokenSteps(){
  return '<ol class="steps">' +
    '<li>Sur GitHub : <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>. Lien direct : <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>' +
    '<li>Nom : <code>Coach iPhone</code>. Expiration : 1 an.</li>' +
    '<li>Repository access : <b>Only select repositories</b> → <code>' + esc(S.cfg.repo) + '</code>.</li>' +
    '<li>Permissions → Repository permissions → <b>Contents : Read and write</b>. Rien d\'autre.</li>' +
    '<li>Generate token, copie-le et colle-le ci-dessous.</li></ol>';
}
function viewSetup(){
  return '<div class="stack"><div class="eyebrow">Première ouverture</div><h1>Relier tes séances</h1>' +
    '<p class="lead">Tes séances et tes résultats sont rangés dans ton dépôt GitHub privé <code>' + esc(S.cfg.owner + "/" + S.cfg.repo) + '</code>. Pour que l\'app y accède, crée une clé limitée à ce seul dépôt.</p></div>' +
    tokenSteps() + tokenForm(true);
}
function tokenForm(first){
  return '<form class="stack" id="cfgform">' +
    '<label class="lb" for="cfg-token">Clé GitHub</label><input class="input" id="cfg-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" value="' + esc(first ? "" : S.cfg.token) + '">' +
    '<p class="hint">La clé reste sur ce téléphone. Elle ne donne accès qu\'au dépôt choisi.</p>' +
    (first ? '' : '<details><summary class="lb">Dépôt</summary><div class="stack" style="margin-top:8px">' +
      '<label class="lb" for="cfg-owner">Compte</label><input class="input" id="cfg-owner" value="' + esc(S.cfg.owner) + '" autocapitalize="off">' +
      '<label class="lb" for="cfg-repo">Dépôt</label><input class="input" id="cfg-repo" value="' + esc(S.cfg.repo) + '" autocapitalize="off">' +
      '<label class="lb" for="cfg-branch">Branche</label><input class="input" id="cfg-branch" value="' + esc(S.cfg.branch) + '" autocapitalize="off"></div></details>') +
    '<button class="btn primary block" type="submit">Enregistrer et synchroniser</button></form>';
}
function viewSettings(){
  var m = S.meta, im = m.imgs, p = pendingCount();
  var h = '<div class="stack"><div class="eyebrow">Réglages</div><h1>Synchro et hors-ligne</h1></div>';
  h += '<dl class="kv"><dt>Dépôt</dt><dd>' + esc(S.cfg.owner + "/" + S.cfg.repo) + '</dd>' +
    '<dt>Dernière synchro</dt><dd>' + esc(ago(m.lastSync)) + '</dd>' +
    '<dt>Séances sur le téléphone</dt><dd class="num">' + Object.keys(S.sessions).length + '</dd>' +
    '<dt>Résultats à envoyer</dt><dd class="num">' + p + '</dd>' +
    '<dt>Images hors ligne</dt><dd class="num">' + (im ? im.ok + " / " + im.n : "—") + '</dd>' +
    '<dt>Réseau</dt><dd>' + (navigator.onLine ? "connecté" : "hors ligne") + '</dd></dl>';
  if (S.sync.cls === "err") h += '<div class="err-box"><b>' + esc(S.sync.txt) + '.</b> ' + (S.sync.txt === "Clé refusée" ? "La clé a peut-être expiré. Crée-en une nouvelle." : "Vérifie que la clé donne accès à ce dépôt avec la permission Contents en lecture et écriture, puis que le compte et le nom du dépôt sont justes.") + '</div>';
  h += '<button class="btn primary block" data-act="sync-now">Synchroniser maintenant</button>';
  h += '<p class="hint">Avant d\'aller à la salle sans réseau, ouvre l\'app une fois connecté : les séances à venir et leurs images sont gardées sur le téléphone.</p>';
  h += tokenForm(false);
  h += '<details><summary class="lb">Créer une nouvelle clé</summary><div style="margin-top:8px">' + tokenSteps() + '</div></details>';
  h += '<button class="btn block" data-act="goto" data-i="overview">Retour à la séance</button>';
  return h;
}
function viewEmpty(){
  return '<div class="empty"><div class="eyebrow">Aucune séance prévue</div><h2>Rien au programme</h2><p class="lead">Demande à Claude de préparer ta prochaine séance. Elle arrivera ici à la prochaine synchro.</p>' +
    '<button class="btn block" data-act="sync-now">Synchroniser maintenant</button></div>';
}

function viewOverview(){
  var s = session(), ex = exercises(), r = result();
  var h = '<div class="stack"><div class="eyebrow">' + esc(dateFr(s.date, true)) + (s.durationMin ? ' · ' + esc(s.durationMin) + ' min' : '') + (s.focus ? ' · ' + esc(s.focus) : '') + '</div>';
  h += '<h1>' + esc(s.title || "Séance") + '</h1>';
  if (s.note) h += '<p class="lead">' + esc(s.note) + '</p>';
  h += '</div>';
  if (s.warmup) h += '<div class="note"><b>Échauffement</b>' + esc(s.warmup) + '</div>';
  h += '<ul class="plan">';
  ex.forEach(function(e, i){ var t = targetSummary(e), d = doneCount(i), n = nSets(e);
    h += '<li><button data-act="goto" data-i="' + i + '"><span class="nm">' + esc(e.name || "Exercice") + '</span><span class="dt num">' + esc(t.v) + ' · ' + esc(t.s) + (exNote(i) ? ' · ✎ note' : '') + '</span><span class="st num' + (d === n ? ' ok' : '') + '">' + d + '/' + n + '</span></button></li>'; });
  h += '</ul>';
  if (r.status === "terminée") h += '<div class="ok-box"><b>Séance terminée.</b> ' + (S.results[S.sid].dirty ? "Tes résultats partiront à la prochaine connexion." : "Tes résultats sont envoyés.") + '</div>';
  var label = r.status === "terminée" ? "Revoir le bilan" : (r.startedAt ? "Reprendre la séance" : "Commencer la séance");
  h += '<button class="btn primary block" data-act="start">' + label + '</button>';
  var ids = sessionIds();
  if (ids.length > 1){
    h += '<div class="stack"><label class="lb" for="pick">Autre séance</label><select id="pick">';
    ids.slice().reverse().forEach(function(id){ var d = S.sessions[id].data || {};
      h += '<option value="' + esc(id) + '"' + (id === S.sid ? ' selected' : '') + '>' + esc(dateFr(d.date)) + ' · ' + esc(d.title || id) + (isDone(id) ? ' ✓' : '') + '</option>'; });
    h += '</select></div>';
  }
  return h;
}

function chipsRow(cur){
  var h = '<div class="chips">';
  exercises().forEach(function(e, i){ var ok = doneCount(i) === nSets(e);
    h += '<button class="chip' + (i === cur ? ' on' : '') + (ok ? ' ok' : '') + '" data-act="goto" data-i="' + i + '">' + (i+1) + '. ' + esc(e.name || "Exercice") + '</button>'; });
  h += '<button class="chip' + (cur === "end" ? ' on' : '') + '" data-act="goto" data-i="end">Bilan</button></div>';
  return h;
}

function viewExercise(i){
  var ex = exercises()[i]; if (!ex){ S.view = "overview"; return viewOverview(); }
  var timed = isTimed(ex), n = nSets(ex), t = targetSummary(ex), p = prevSummary(ex), imgs = imagesOf(ex);
  var h = chipsRow(i);
  h += '<div class="stack"><div class="eyebrow num">Exercice ' + (i+1) + ' / ' + exercises().length + (ex.tempo ? ' · tempo ' + esc(ex.tempo) : '') + '</div><h1>' + esc(ex.name || "Exercice") + '</h1></div>';
  var demo = ex.videoUrl && /^https:\/\//.test(ex.videoUrl) ? ex.videoUrl : "https://www.youtube.com/results?search_query=" + encodeURIComponent((ex.name || "") + " exercice technique");
  h += '<div class="visual">';
  if (imgs.length) h += '<div class="frames' + (imgs.length > 1 ? ' anim' : '') + '" id="frames">' + imgs.map(function(u, k){ return '<img src="' + esc(u) + '" alt="' + (k ? "Position d'arrivée" : "Position de départ") + '" data-fallback>'; }).join("") + '</div>';
  h += '<canvas id="fig" role="img" aria-label="Animation du mouvement"' + (imgs.length ? ' hidden' : '') + '></canvas>';
  h += '<div class="cap"><span>' + esc(ex.visualNote || (imgs.length ? "Départ et arrivée, en alternance" : "Mouvement de profil, en boucle")) + '</span><a href="' + esc(demo) + '" target="_blank" rel="noopener">Voir une démo</a></div></div>';
  if (Array.isArray(ex.cues) && ex.cues.length) h += '<ul class="cues">' + ex.cues.map(function(c){ return '<li>' + esc(c) + '</li>'; }).join("") + '</ul>';
  h += '<div class="cmp"><div><div class="eyebrow">Dernière fois</div>' + (p ? '<div class="v">' + esc(p.v) + '</div><div class="s">' + esc(p.s) + (p.note ? ' · ' + esc(p.note) : '') + '</div>' : '<div class="v">—</div><div class="s">Première fois</div>') + '</div>';
  h += '<div class="goal"><div class="eyebrow">Objectif</div><div class="v">' + esc(t.v) + '</div><div class="s">' + esc(t.s) + '</div></div></div>';

  h += '<div class="sets">';
  var j, tg, r;
  if (timed){
    h += '<div class="sets-h timed"><span>#</span><span>Temps</span><span></span><span></span></div>';
    for (j=0;j<n;j++){ tg = tgt(ex,j); r = getSet(i,j);
      h += '<div class="set timed' + (r.done ? ' done' : '') + '"><span class="sn num">' + (j+1) + '</span>';
      h += '<label class="fld"><input id="in-' + i + '-' + j + '-time" data-k="time" data-i="' + i + '" data-j="' + j + '" inputmode="numeric" value="' + esc(r.time != null ? r.time : "") + '" placeholder="' + esc(tg.time != null ? tg.time : "") + '" aria-label="Série ' + (j+1) + ', secondes"><span>s</span></label>';
      h += '<button class="go" data-act="work" data-i="' + i + '" data-j="' + j + '" aria-label="Lancer le minuteur de la série ' + (j+1) + '">▶</button>';
      h += '<button class="ck" data-act="check" data-i="' + i + '" data-j="' + j + '" aria-label="Valider la série ' + (j+1) + '">✓</button></div>'; }
  } else {
    h += '<div class="sets-h"><span>#</span><span>Reps</span><span>Charge</span><span></span></div>';
    for (j=0;j<n;j++){ tg = tgt(ex,j); r = getSet(i,j);
      h += '<div class="set' + (r.done ? ' done' : '') + '"><span class="sn num">' + (j+1) + '</span>';
      h += '<label class="fld"><input id="in-' + i + '-' + j + '-reps" data-k="reps" data-i="' + i + '" data-j="' + j + '" inputmode="numeric" value="' + esc(r.reps != null ? r.reps : "") + '" placeholder="' + esc(tg.reps != null ? tg.reps : "") + '" aria-label="Série ' + (j+1) + ', répétitions"></label>';
      h += '<label class="fld"><input id="in-' + i + '-' + j + '-weight" data-k="weight" data-i="' + i + '" data-j="' + j + '" inputmode="decimal" value="' + esc(r.weight != null ? String(r.weight).replace(".",",") : "") + '" placeholder="' + esc(tg.weight != null ? String(tg.weight).replace(".",",") : (ex.equip ? "" : "PDC")) + '" aria-label="Série ' + (j+1) + ', charge en kilos"><span>kg</span></label>';
      h += '<button class="ck" data-act="check" data-i="' + i + '" data-j="' + j + '" aria-label="Valider la série ' + (j+1) + '">✓</button></div>'; }
  }
  h += '</div>';
  var xn = exNote(i);
  if (xn || S.noteOpen === i) h += '<div class="stack"><label class="lb" for="xn-' + i + '">Ma note sur cet exercice</label><textarea id="xn-' + i + '" data-xn="' + i + '" placeholder="Variante faite, élastique utilisé, prise, sensation…">' + esc(xn) + '</textarea></div>';
  else h += '<button class="btn block" data-act="xnote" data-i="' + i + '">+ Ajouter une note (variante, élastique…)</button>';
  if (ex.note) h += '<div class="note"><b>Conseil du coach</b>' + esc(ex.note) + '</div>';
  var last = i === exercises().length - 1;
  h += '<div class="nav"><button class="btn" data-act="goto" data-i="' + (i === 0 ? 'overview' : i-1) + '">' + (i === 0 ? 'Plan' : 'Précédent') + '</button><button class="btn primary" data-act="goto" data-i="' + (last ? 'end' : i+1) + '">' + (last ? 'Bilan de séance' : 'Exercice suivant') + '</button></div>';
  return h;
}

function viewEnd(){
  var r = result(), ex = exercises(), tot = 0, dn = 0;
  ex.forEach(function(e, i){ tot += nSets(e); dn += doneCount(i); });
  var h = chipsRow("end");
  h += '<div class="stack"><div class="eyebrow num">' + dn + ' / ' + tot + ' séries validées' + (r.startedAt ? ' · ' + fmtLong(((r.finishedAt ? new Date(r.finishedAt) : new Date()) - new Date(r.startedAt))/1000) : '') + '</div><h1>Bilan</h1></div>';
  h += '<div class="stack"><span class="lb" id="feel-l">Ressenti global (1 = très facile, 10 = à fond)</span><div class="feel" role="group" aria-labelledby="feel-l">';
  for (var v=1; v<=10; v++) h += '<button data-act="feel" data-v="' + v + '" class="' + (r.feeling === v ? 'on' : '') + '" aria-pressed="' + (r.feeling === v) + '">' + v + '</button>';
  h += '</div><div class="scale"><span>Facile</span><span>Maximal</span></div></div>';
  h += '<div class="stack"><label class="lb" for="f-pain">Douleurs ou gênes</label><textarea id="f-pain" data-f="pain" placeholder="Où, quand, intensité. Laisse vide si rien.">' + esc(r.pain) + '</textarea></div>';
  h += '<div class="stack"><label class="lb" for="f-notes">Notes pour le coach</label><textarea id="f-notes" data-f="notes" placeholder="Exercice trop dur, matériel manquant, temps dispo la prochaine fois…">' + esc(r.notes) + '</textarea></div>';
  if (r.status === "terminée"){
    h += '<div class="ok-box"><b>Séance enregistrée.</b> ' + (S.results[S.sid].dirty ? "Elle partira à la prochaine connexion. " : "") + 'Dis à Claude « séance terminée » : il récupère tes résultats et prépare la suivante.</div>';
    h += '<button class="btn primary block" data-act="finish">Mettre à jour le bilan</button>';
  } else h += '<button class="btn primary block" data-act="finish">Terminer la séance</button>';
  h += '<button class="btn block" data-act="copy">Copier le résumé</button>';
  if (S.copyText) h += '<textarea class="copyarea" id="copyarea" readonly aria-label="Résumé de séance">' + esc(S.copyText) + '</textarea>';
  return h;
}

function summaryText(){
  var s = session(), r = result(), lines = ["Séance du " + dateFr(s.date) + " — " + (s.title || "")];
  exercises().forEach(function(e, i){ var parts = []; for (var j=0;j<nSets(e);j++){ var x = getSet(i,j); if (x.done) parts.push(setTxt(x, e)); }
    var xn = exNote(i); lines.push((e.name || "Exercice") + " : " + (parts.length ? parts.join(", ") : "non fait") + (xn ? " (note : " + xn + ")" : "")); });
  if (r.feeling) lines.push("Ressenti : " + r.feeling + "/10");
  if (r.pain) lines.push("Douleurs : " + r.pain);
  if (r.notes) lines.push("Notes : " + r.notes);
  if (r.durationMin) lines.push("Durée : " + r.durationMin + " min");
  return lines.join("\n");
}

/* ---------- Minuteurs, son, écran allumé ---------- */
var audio = null;
function ensureAudio(){ try{ if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); }catch(e){} }
function beep(freq, dur){ if (!audio) return; try{ var o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = freq; o.type = "sine";
  g.gain.setValueAtTime(.0001, audio.currentTime); g.gain.exponentialRampToValueAtTime(.4, audio.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + dur);
  o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + dur + .05); }catch(e){} }
function keepAwake(){ try{ if (navigator.wakeLock && document.visibilityState === "visible") navigator.wakeLock.request("screen").catch(function(){}); }catch(e){} }
document.addEventListener("visibilitychange", function(){ var r = S.sid && S.results[S.sid]; if (document.visibilityState === "visible" && r && r.data.startedAt && r.data.status !== "terminée") keepAwake(); });

function begin(){ var r = result(); if (!r.startedAt){ r.startedAt = new Date().toISOString(); r.status = "en cours"; markDirty(); } keepAwake(); }
function nextLabel(i, j){ var ex = exercises()[i]; if (j + 1 < nSets(ex)) return "Ensuite : " + ex.name + " · série " + (j+2);
  var nx = exercises()[i+1]; return nx ? "Ensuite : " + nx.name : "Ensuite : bilan"; }

function checkSet(i, j, auto){
  var ex = exercises()[i], tg = tgt(ex, j), r = getSet(i, j);
  if (r.done && !auto){ patchSet(i, j, { done:false }); markDirty(); render(); return; }
  begin();
  var patch = { done:true, at:new Date().toISOString() };
  if (isTimed(ex)){ if (r.time == null && tg.time != null) patch.time = tg.time; }
  else if (r.reps == null && tg.reps != null) patch.reps = tg.reps;
  if (r.weight == null && tg.weight != null) patch.weight = tg.weight;
  patchSet(i, j, patch); markDirty();
  var lastSet = j + 1 >= nSets(ex), lastEx = i + 1 >= exercises().length;
  var rest = lastSet ? (ex.restAfter != null ? ex.restAfter : ex.rest) : ex.rest;
  if (!(lastSet && lastEx) && rest > 0) startTimer({ kind:"rest", total:Number(rest), label:"Repos", next:nextLabel(i, j) });
  else stopTimer();
  render();
}

function startTimer(o){ o.start = Date.now(); o.end = o.kind === "stopwatch" ? null : o.start + o.total*1000; o.lastBeep = null; S.timer = o;
  var sh = $("#sheet"); sh.hidden = false; sh.classList.toggle("work", o.kind !== "rest"); sh.classList.remove("flash");
  $("#shLabel").textContent = o.label; $("#shNext").textContent = o.next || "";
  $("#shStop").textContent = o.kind === "rest" ? "Passer" : "Arrêter";
  $("#shMinus").hidden = $("#shPlus").hidden = o.kind === "stopwatch";
  app.classList.add("with-sheet"); tick(); }
function stopTimer(){ S.timer = null; $("#sheet").hidden = true; app.classList.remove("with-sheet"); }
function endWork(elapsed){ var o = S.timer; if (!o) return; stopTimer(); patchSet(o.i, o.j, { time: Math.round(elapsed) }); checkSet(o.i, o.j, true); }

function tick(){
  var o = S.timer;
  if (o){ var now = Date.now();
    if (o.kind === "stopwatch"){ $("#shTime").textContent = fmt((now - o.start)/1000); $("#shBar").style.width = "100%"; }
    else if (!o.done){ var left = (o.end - now)/1000; $("#shTime").textContent = fmt(Math.ceil(left));
      $("#shBar").style.width = Math.min(100, Math.max(0, 100 - left / o.total * 100)) + "%";
      var whole = Math.ceil(left);
      if (whole <= 3 && whole >= 1 && o.lastBeep !== whole){ o.lastBeep = whole; beep(660, .12); }
      if (left <= 0){ beep(990, .45);
        if (o.kind === "work") endWork(o.total);
        else { o.done = true; $("#shTime").textContent = "Go !"; $("#sheet").classList.add("flash"); setTimeout(function(){ if (S.timer === o) stopTimer(); }, 1800); } } } }
  tickChrono();
}
function tickChrono(){ var r = S.sid && S.results[S.sid] && S.results[S.sid].data, el = $("#chrono");
  if (!r || !r.startedAt){ el.textContent = "0:00"; return; }
  var end = r.finishedAt ? new Date(r.finishedAt) : new Date(); el.textContent = fmtLong((end - new Date(r.startedAt))/1000); }
setInterval(tick, 250);

/* ---------- Événements ---------- */
function goto(v){ S.copyText = null; S.noteOpen = null; if (v === "overview" || v === "end" || v === "settings") S.view = v; else S.view = Number(v); render(); window.scrollTo(0, 0); }

document.addEventListener("click", function(ev){
  var b = ev.target.closest("[data-act]"); if (!b) return; var act = b.getAttribute("data-act");
  ensureAudio();
  var i = num(b.getAttribute("data-i")), j = num(b.getAttribute("data-j"));
  if (act === "goto"){ var to = b.getAttribute("data-i"); if (to === "settings" && S.view === "settings") to = "overview"; goto(to); }
  else if (act === "reload") location.reload();
  else if (act === "sync-now"){ S.meta.lastError = null; sync().then(render); }
  else if (act === "start"){ if (result().status === "terminée") goto("end"); else { begin(); var first = 0; exercises().some(function(e, k){ if (doneCount(k) < nSets(e)){ first = k; return true; } }); goto(first); } }
  else if (act === "check") checkSet(i, j, false);
  else if (act === "xnote"){ S.noteOpen = i; render(); var ta = document.getElementById("xn-" + i); if (ta) ta.focus(); }
  else if (act === "work"){ begin(); var ex = exercises()[i], tg = tgt(ex, j);
    if (tg.time) startTimer({ kind:"work", total:Number(tg.time), label:ex.name + " · série " + (j+1), next:"Effort en cours", i:i, j:j });
    else startTimer({ kind:"stopwatch", total:0, label:ex.name + " · série " + (j+1), next:"Arrête quand tu lâches", i:i, j:j }); }
  else if (act === "t-minus" && S.timer && !S.timer.done){ S.timer.end -= 15000; S.timer.total = Math.max(1, S.timer.total - 15); tick(); }
  else if (act === "t-plus" && S.timer && !S.timer.done){ S.timer.end += 15000; S.timer.total += 15; tick(); }
  else if (act === "t-stop" && S.timer){ var o = S.timer; if (o.kind === "rest") stopTimer(); else endWork((Date.now() - o.start)/1000); }
  else if (act === "feel"){ result().feeling = num(b.getAttribute("data-v")); markDirty(); render(); }
  else if (act === "finish"){ var r = result(); if (!r.startedAt) r.startedAt = new Date().toISOString();
    if (r.status !== "terminée") r.finishedAt = new Date().toISOString();
    r.status = "terminée"; r.durationMin = Math.round((new Date(r.finishedAt) - new Date(r.startedAt))/60000);
    stopTimer(); markDirty(); scheduleSync(300); render(); }
  else if (act === "copy"){ var txt = summaryText(); S.copyText = null;
    try{ navigator.clipboard.writeText(txt).then(function(){ setSync("Résumé copié", "ok"); setTimeout(idleSyncLabel, 2500); }, function(){ S.copyText = txt; render(); }); }
    catch(e){ S.copyText = txt; render(); } }
});
document.addEventListener("change", function(ev){ if (ev.target.id === "pick"){ S.sid = ev.target.value; S.view = "overview"; render(); } });
app.addEventListener("input", function(ev){ var t = ev.target;
  if (t.hasAttribute("data-k")){ var p = {}; p[t.getAttribute("data-k")] = num(t.value); patchSet(num(t.getAttribute("data-i")), num(t.getAttribute("data-j")), p); markDirty(); }
  else if (t.hasAttribute("data-xn")){ setExNote(num(t.getAttribute("data-xn")), t.value); markDirty(); }
  else if (t.hasAttribute("data-f")){ result()[t.getAttribute("data-f")] = t.value; markDirty(); } });
app.addEventListener("submit", function(ev){ if (ev.target.id !== "cfgform") return; ev.preventDefault();
  var g = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : null; };
  var tok = g("cfg-token"); if (tok) S.cfg.token = tok;
  ["owner","repo","branch"].forEach(function(k){ var v = g("cfg-" + k); if (v) S.cfg[k] = v; });
  save(CFG_KEY, S.cfg); document.activeElement && document.activeElement.blur();
  S.view = "overview"; render(); sync().then(render); });
document.addEventListener("error", function(ev){ var t = ev.target;
  if (t && t.tagName === "IMG" && t.hasAttribute("data-fallback")){ var f = $("#frames"), c = $("#fig"); if (f) f.hidden = true; var cap = document.querySelector(".visual .cap span"); if (cap) cap.textContent = "Mouvement de profil, en boucle"; if (c){ c.hidden = false; startFig(); } } }, true);

/* ---------- Silhouette animée (si pas de photo) ---------- */
var STAND = { hd:[102,42], s:[102,58], h:[102,110], k:[102,145], a:[102,180], e:[100,84], w:[101,108] };
function P(base, over){ var o = {}, k; for (k in base) o[k] = base[k]; for (k in over) o[k] = over[k]; return o; }
var POSES = {
  debout:   { a:STAND, b:P(STAND,{hd:[102,41], s:[102,57], e:[103,83], w:[105,107]}), tempo:3.5 },
  squat:    { a:P(STAND,{e:[127,58], w:[149,58]}), b:{hd:[124,81], s:[118,97], h:[88,140], k:[122,150], a:[102,180], e:[143,97], w:[165,97]} },
  pompes:   { a:{hd:[166,143], s:[150,148], h:[100,162], k:[70,170], a:[40,178], e:[150,164], w:[150,180]}, b:{hd:[167,164], s:[150,168], h:[100,172], k:[70,175], a:[40,178], e:[132,172], w:[150,180]} },
  gainage:  { a:{hd:[164,150], s:[148,156], h:[100,162], k:[70,170], a:[40,178], e:[148,180], w:[170,180]}, b:{hd:[164,149], s:[148,155], h:[100,160], k:[70,169], a:[40,178], e:[148,180], w:[170,180]}, tempo:3 },
  fente:    { a:P(STAND,{k:[104,145], a:[106,180], k2:[96,145], a2:[86,180]}), b:{hd:[100,67], s:[100,83], h:[100,135], k:[132,140], a:[134,180], k2:[82,172], a2:[52,178], e:[100,108], w:[100,132]} },
  pont:     { a:{hd:[38,170], s:[58,172], h:[108,174], k:[138,146], a:[150,180], e:[78,178], w:[98,179]}, b:{hd:[38,170], s:[58,170], h:[110,146], k:[142,140], a:[150,180], e:[78,178], w:[98,179]} },
  crunch:   { a:{hd:[36,170], s:[52,174], h:[102,176], k:[128,148], a:[152,179], e:[66,168], w:[78,170]}, b:{hd:[58,140], s:[68,154], h:[102,176], k:[128,148], a:[152,179], e:[84,146], w:[94,152]} },
  rowing:   { a:{hd:[148,85], s:[133,92], h:[88,118], k:[106,150], a:[100,180], e:[133,116], w:[133,140]}, b:{hd:[148,85], s:[133,92], h:[88,118], k:[106,150], a:[100,180], e:[112,100], w:[124,120]}, equip:"haltere" },
  developpe:{ a:P(STAND,{e:[114,80], w:[110,58]}), b:P(STAND,{e:[106,34], w:[104,12]}), equip:"haltere" },
  curl:     { a:STAND, b:P(STAND,{w:[118,70]}), equip:"haltere" },
  souleve:  { a:P(STAND,{e:[101,84], w:[102,108]}), b:{hd:[142,80], s:[127,86], h:[82,112], k:[108,147], a:[102,180], e:[127,110], w:[127,135]}, equip:"barre" },
  jumping:  { a:P(STAND,{k:[96,145], a:[95,180], k2:[104,145], a2:[105,180], e:[90,84], w:[88,108], e2:[110,84], w2:[112,108]}),
              b:{hd:[100,38], s:[100,54], h:[100,106], k:[86,142], a:[76,178], k2:[114,142], a2:[124,178], e:[80,38], w:[72,16], e2:[120,38], w2:[128,16]}, tempo:1 },
  grimpeur: { a:{hd:[166,136], s:[150,142], h:[100,154], k:[70,164], a:[40,178], k2:[128,162], a2:[106,178], e:[150,161], w:[150,180]},
              b:{hd:[166,136], s:[150,142], h:[100,154], k:[128,162], a:[106,178], k2:[70,164], a2:[40,178], e:[150,161], w:[150,180]}, tempo:.8 }
};
function full(p){ var o = P(p, {}); o.k2 = o.k2 || o.k; o.a2 = o.a2 || o.a; o.e2 = o.e2 || o.e; o.w2 = o.w2 || o.w; return o; }
function mix(A, B, t){ var o = {}; for (var k in A){ var b = B[k] || A[k]; o[k] = [A[k][0] + (b[0]-A[k][0])*t, A[k][1] + (b[1]-A[k][1])*t]; } return o; }
function colors(){ var cs = getComputedStyle(document.documentElement);
  return { fig:cs.getPropertyValue("--fig").trim(), back:cs.getPropertyValue("--fig-back").trim(), ghost:cs.getPropertyValue("--ghost").trim(), line:cs.getPropertyValue("--line").trim() }; }
function seg(c, pts){ c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (var i=1;i<pts.length;i++) c.lineTo(pts[i][0], pts[i][1]); c.stroke(); }
function equipAt(c, p, kind, stroke, fill){ var x = p[0], y = p[1]; c.lineWidth = 3; c.strokeStyle = stroke; c.fillStyle = fill;
  if (kind === "haltere"){ c.fillStyle = stroke; c.fillRect(x-11, y-2, 22, 4); c.fillRect(x-14, y-7, 6, 14); c.fillRect(x+8, y-7, 6, 14); }
  else if (kind === "barre"){ c.beginPath(); c.arc(x, y, 17, 0, Math.PI*2); c.fill(); c.stroke(); c.fillStyle = stroke; c.beginPath(); c.arc(x, y, 3, 0, Math.PI*2); c.fill(); }
  else if (kind === "kettlebell"){ c.beginPath(); c.arc(x, y+13, 10, 0, Math.PI*2); c.fill(); c.stroke(); c.beginPath(); c.arc(x, y+3, 5, Math.PI, 0); c.stroke(); } }
function body(c, J, main, back, equip, ghost, cc){
  c.lineCap = "round"; c.lineJoin = "round"; c.lineWidth = ghost ? 5 : 7; c.strokeStyle = back;
  seg(c, [J.h, J.k2, J.a2]); seg(c, [J.s, J.e2, J.w2]);
  c.strokeStyle = main; seg(c, [J.hd, J.s, J.h]); seg(c, [J.h, J.k, J.a]); seg(c, [J.s, J.e, J.w]);
  c.fillStyle = main; c.beginPath(); c.arc(J.hd[0], J.hd[1], ghost ? 9 : 11, 0, Math.PI*2); c.fill();
  if (!ghost && equip) equipAt(c, J.w, equip, main, cc.ghost); }
var figRaf = null, reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
function stopFig(){ if (figRaf) cancelAnimationFrame(figRaf); figRaf = null; }
function startVisual(){ var c = $("#fig"); if (c && !c.hidden) startFig(); else stopFig(); }
function startFig(){ stopFig(); var cv = $("#fig"); if (!cv) return; var ex = exercises()[S.view]; if (!ex) return;
  var pose = (ex.pose && ex.pose.a && ex.pose.b) ? ex.pose : (POSES[ex.visual] || POSES.debout);
  var A = full(pose.a), B = full(pose.b), equip = ex.equip || pose.equip || null, tempo = Number(ex.tempoSec || pose.tempo || 2.6);
  var bx0 = 1e9, bx1 = -1e9, by0 = 1e9, pad = equip ? 22 : 14;
  [A, B].forEach(function(J){ for (var k in J){ bx0 = Math.min(bx0, J[k][0] - pad); bx1 = Math.max(bx1, J[k][0] + pad); by0 = Math.min(by0, J[k][1] - pad); } });
  var cc = colors();
  function frame(ts){ var c = cv.getContext("2d"), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h){ figRaf = requestAnimationFrame(frame); return; }
    if (cv.width !== Math.round(w*dpr)){ cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr); }
    c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,w,h);
    var bw = bx1 - bx0, bh = 186 - by0, sc = Math.min((w - 32) / bw, (h - 20) / bh, h / 120);
    var ox = (w - bw*sc)/2 - bx0*sc, oy = h - 10 - 186*sc;
    c.save(); c.translate(ox, oy); c.scale(sc, sc);
    c.strokeStyle = cc.line; c.lineWidth = 2/sc; c.beginPath(); c.moveTo(-ox/sc, 183); c.lineTo((w-ox)/sc, 183); c.stroke();
    body(c, A, cc.ghost, cc.ghost, null, true, cc); body(c, B, cc.ghost, cc.ghost, null, true, cc);
    var t = reduce ? 1 : (1 - Math.cos(ts/1000 / tempo * Math.PI * 2)) / 2;
    body(c, mix(A, B, t), cc.fig, cc.back, equip, false, cc);
    c.restore();
    if (!reduce) figRaf = requestAnimationFrame(frame); }
  figRaf = requestAnimationFrame(frame); }

/* ---------- Mises à jour de l'app ---------- */
if ("serviceWorker" in navigator){
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(function(){});
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if (!hadController) return;
    var r = S.sid && S.results[S.sid] && S.results[S.sid].data;
    if (S.timer || (r && r.status === "en cours")) $("#banner").hidden = false; else location.reload(); });
}

/* ---------- Démarrage ---------- */
S.sid = pickDefault();
idleSyncLabel();
render();
sync();
})();
