/* Client-side glue for the /it/ section: app list, app info page, available-PCs feed.
 * Everything comes from /it/api/ (the it-api container behind nginx) and /it/apps.json. */
(function () {
  'use strict';

  var API = '/it/api';
  var APPS_JSON = '/it/apps.json';

  function el(tag, text, attrs) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status + ' for ' + url);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  // apps.json is optional metadata (title, description); the API decides what exists.
  function getAppsMeta() {
    return getJson(APPS_JSON).catch(function () { return []; }).then(function (list) {
      var byId = {};
      (Array.isArray(list) ? list : []).forEach(function (m) { if (m && m.id) byId[m.id] = m; });
      return { order: Array.isArray(list) ? list.map(function (m) { return m.id; }) : [], byId: byId };
    });
  }

  function markActiveNav() {
    var path = location.pathname;
    var links = document.querySelectorAll('#subnavigation a, #subnavigation-mobile a');
    Array.prototype.forEach.call(links, function (a) {
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) !== '/') return;
      var isSection = href === '/it/' ? (path === '/it/' || !/^\/it\/(available-pcs|license)\//.test(path)) : path.indexOf(href) === 0;
      if (isSection) a.parentNode.classList.add('active');
    });
  }

  /* ---------------- index: list of apps ---------------- */
  function renderIndex(ul) {
    Promise.all([getAppsMeta(), getJson(API + '/apps')]).then(function (res) {
      var meta = res[0];
      var apps = res[1].apps || [];
      var byId = {};
      apps.forEach(function (a) { byId[a.id] = a; });
      var ordered = meta.order.filter(function (id) { return byId[id]; });
      apps.forEach(function (a) { if (ordered.indexOf(a.id) === -1) ordered.push(a.id); });
      clear(ul);
      if (!ordered.length) {
        ul.appendChild(el('li', 'Derzeit sind keine Programme verfügbar.'));
        return;
      }
      ordered.forEach(function (id) {
        var app = byId[id];
        var m = meta.byId[id] || {};
        var li = el('li');
        li.appendChild(document.createTextNode((m.title || id) + ': '));
        li.appendChild(el('a', 'Info', { href: '/it/' + encodeURIComponent(id) + '/' }));
        li.appendChild(document.createTextNode(', '));
        li.appendChild(el('a', 'Installieren', { href: app.setupUrl }));
        if (app.version) li.appendChild(document.createTextNode(' (Version ' + app.version + ')'));
        ul.appendChild(li);
      });
    }).catch(function () {
      clear(ul);
      ul.appendChild(el('li', 'Die Programmliste konnte nicht geladen werden.', { 'class': 'it-error' }));
    });
  }

  /* ---------------- app info page ---------------- */
  function renderApp(root) {
    var m = /^\/it\/([^/]+)\/$/.exec(location.pathname);
    var id = m ? decodeURIComponent(m[1]) : null;
    var title = document.getElementById('app-title');
    var desc = document.getElementById('app-description');
    var details = document.getElementById('app-details');
    var error = document.getElementById('app-error');
    if (!id) return;
    title.textContent = id;
    Promise.all([getAppsMeta(), getJson(API + '/apps/' + encodeURIComponent(id))]).then(function (res) {
      var meta = res[0].byId[id] || {};
      var app = res[1];
      var name = meta.title || app.id;
      document.title = 'IQB - ' + name;
      title.textContent = name;
      // apps.json is part of this repository, so its HTML is trusted content.
      desc.innerHTML = meta.description || '';
      document.getElementById('app-version').textContent = app.version ? 'Aktuelle Version: ' + app.version : '';
      // Original release dates belong to a specific version, not the import date.
      var released = meta.releaseDates && meta.releaseDates[app.version];
      document.getElementById('app-published').textContent = released
        ? 'Veröffentlichung: ' + released
        : (app.published ? 'Bereitgestellt am: ' + app.published : '');
      var btn = document.getElementById('btn-install');
      btn.addEventListener('click', function () { location.href = app.setupUrl; });
      details.hidden = false;
    }).catch(function (err) {
      error.textContent = err.status === 404
        ? 'Dieses Programm ist nicht (mehr) verfügbar.'
        : 'Die Programmdaten konnten nicht geladen werden.';
      error.hidden = false;
    });
  }

  /* ---------------- available PCs ---------------- */
  function pollPcs(ul, ts) {
    var INTERVAL = 10000;
    var expiryTimer;
    var pending = false;
    function unavailable(message, timestamp) {
      clear(ul);
      clear(ts);
      ul.appendChild(el('li', message, { 'class': 'it-error', role: 'status' }));
      if (timestamp) ts.textContent = timestamp;
    }
    function render(data, elapsed) {
      clearTimeout(expiryTimer);
      var remaining = data.staleAfterMs - data.ageMs - elapsed;
      if (data.status === 'unavailable') {
        unavailable('Status unbekannt: Es liegen noch keine gültigen Meldungen vor.');
        return;
      }
      if (data.status !== 'fresh' || !Number.isFinite(remaining) || remaining <= 0) {
        unavailable('Status veraltet: Seit mindestens einer Minute keine neue Meldung. Die Verfügbarkeit ist unbekannt.', data.timestamp);
        return;
      }
      clear(ul);
      clear(ts);
      if (data.list && data.list.length) {
        data.list.forEach(function (pc) { ul.appendChild(el('li', ' ...  ' + pc)); });
      } else {
        ul.appendChild(el('li', 'Derzeit sind keine Computer frei.'));
      }
      ts.appendChild(document.createTextNode('Gesamt: ' + data.remote + ' (' + data.percentRemote + '% frei)'));
      if (data.timestamp) {
        ts.appendChild(el('p', data.timestamp + (data.footnotes && data.footnotes.length ? ' ' + data.footnotes.join(' ') : '')));
      }
      // Expire locally too, even if the next request hangs or the server stops.
      expiryTimer = setTimeout(function () {
        unavailable('Status veraltet: Seit mindestens einer Minute keine neue Meldung. Die Verfügbarkeit ist unbekannt.', data.timestamp);
      }, remaining);
    }
    function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      var started = performance.now();
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 8000);
      fetch(API + '/pcs', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) { render(data, performance.now() - started); })
        .catch(function () {
          clearTimeout(expiryTimer);
          unavailable('Status nicht abrufbar: Die Verbindung zum Server ist unterbrochen.');
        })
        .finally(function () { clearTimeout(timeout); pending = false; });
    }
    refresh();
    setInterval(refresh, INTERVAL);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    markActiveNav();
    var list = document.getElementById('app-list');
    if (list) renderIndex(list);
    var appRoot = document.getElementById('app-page');
    if (appRoot) renderApp(appRoot);
    var ul = document.getElementById('ul_pcs');
    if (ul) pollPcs(ul, document.getElementById('ts'));
  });
})();
