/* Service worker : garde l'app, les polices et les images d'exercices pour le hors-ligne.
   Changer VERSION à chaque mise à jour de l'app. */
var VERSION = "2026-10-27.2";
var SHELL = "cs-shell-" + VERSION;
var IMG = "cs-img-v1";
var FONTS = "cs-fonts-v1";
var FILES = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(SHELL).then(function(c){ return c.addAll(FILES); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf("cs-shell-") === 0 && k !== SHELL; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

function timeout(ms){ return new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("timeout")); }, ms); }); }

self.addEventListener("fetch", function(e){
  var req = e.request; if (req.method !== "GET") return;
  var url = new URL(req.url);

  // App : réseau d'abord (version la plus récente), copie locale si hors ligne.
  if (url.origin === self.location.origin){
    e.respondWith(Promise.race([fetch(req), timeout(4000)]).then(function(res){
      if (res && res.ok){ var copy = res.clone(); caches.open(SHELL).then(function(c){ c.put(req, copy); }); }
      return res;
    }).catch(function(){
      return caches.match(req, { ignoreSearch:true }).then(function(hit){
        return hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error());
      });
    }));
    return;
  }

  // Images d'exercices (banque libre ou image d'un autre site) : copie locale d'abord.
  if (url.hostname === "cdn.jsdelivr.net" || req.destination === "image"){
    var cors = url.hostname === "cdn.jsdelivr.net";
    e.respondWith(caches.open(IMG).then(function(c){
      return c.match(req.url).then(function(hit){
        return hit || fetch(req.url, { mode: cors ? "cors" : "no-cors" }).then(function(res){ if (res.ok || res.type === "opaque") c.put(req.url, res.clone()); return res; });
      });
    }));
    return;
  }

  // Polices Google : copie locale, mise à jour en arrière-plan.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith(caches.open(FONTS).then(function(c){
      return c.match(req).then(function(hit){
        var net = fetch(req).then(function(res){ if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(function(){ return hit; });
        return hit || net;
      });
    }));
  }
  // api.github.com : jamais mis en cache.
});
