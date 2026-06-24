/* ===========================================================================
   FreightSource single-session client  (fs-session.js)
   ---------------------------------------------------------------------------
   Enforces "one active session per user, newest login wins" across devices.

   Wire it into each portal:
     1) Include this file (or paste it into the portal's <script>).
     2) Right after a SUCCESSFUL login:
            FSSession.start({
              userId: theLoggedInUserEmail,      // stable id for the user
              onKicked: () => goToLoginScreen()  // your app's logout routine
            });
     3) In your logout handler:
            FSSession.stop();

   Behavior:
     - One session per BROWSER (shared via localStorage), so multiple tabs in the
       same browser never fight each other.
     - Heartbeats every 25s. The moment another device logs in, this tab's next
       heartbeat returns "signed_in_elsewhere" → full-screen notice + logout.
     - If the backend isn't reachable (e.g. artifact preview, or before deploy),
       it silently no-ops so the portal still works.
   =========================================================================== */
(function (w) {
  'use strict';
  var HEARTBEAT_MS = 25000;
  var API = '';            // same origin as the portal
  var timer = null, state = null;

  function deviceLabel() {
    var ua = navigator.userAgent || '';
    var os = /Windows/.test(ua) ? 'Windows'
           : /Macintosh|Mac OS/.test(ua) ? 'Mac'
           : /Android/.test(ua) ? 'Android'
           : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
           : /Linux/.test(ua) ? 'Linux' : 'device';
    var browser = /Edg\//.test(ua) ? 'Edge'
                : /Chrome\//.test(ua) ? 'Chrome'
                : /Firefox\//.test(ua) ? 'Firefox'
                : /Safari\//.test(ua) ? 'Safari' : 'browser';
    return os + ' · ' + browser;
  }

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function start(opts) {
    opts = opts || {};
    if (!opts.userId) return;
    state = { userId: opts.userId, onKicked: opts.onKicked, sid: null };

    // Reuse an existing session for this browser if one is already active.
    var sid = null;
    try {
      var saved = JSON.parse(localStorage.getItem('fs_session') || 'null');
      if (saved && saved.userId === opts.userId) sid = saved.sid;
    } catch (e) {}

    if (sid) {
      state.sid = sid;
      schedule();
      return;
    }

    post('/api/auth/login', { userId: opts.userId, device: deviceLabel() })
      .then(function (res) {
        if (!res || !res.sid) return;          // backend unreachable → skip enforcement
        state.sid = res.sid;
        try { localStorage.setItem('fs_session', JSON.stringify({ userId: opts.userId, sid: res.sid })); } catch (e) {}
        schedule();
      })
      .catch(function () { /* preview / offline — no enforcement */ });
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(beat, HEARTBEAT_MS);
  }

  function beat() {
    if (!state || !state.sid) return;
    post('/api/auth/heartbeat', { userId: state.userId, sid: state.sid })
      .then(function (res) {
        if (res && res.ok === false && res.reason === 'signed_in_elsewhere') kicked(res);
      })
      .catch(function () { /* transient network — ignore, try again next beat */ });
  }

  function kicked(info) {
    if (timer) { clearInterval(timer); timer = null; }
    try { localStorage.removeItem('fs_session'); } catch (e) {}
    showNotice(info);
    var cb = state && state.onKicked;
    state = null;
    if (typeof cb === 'function') { try { cb(info); } catch (e) {} }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function showNotice(info) {
    if (document.getElementById('fs-kick')) return;
    var where = info && info.device ? ' (' + esc(info.device) + ')' : '';
    var ov = document.createElement('div');
    ov.id = 'fs-kick';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(8,12,20,.80);backdrop-filter:blur(3px)';
    ov.innerHTML =
      '<div style="max-width:380px;margin:20px;background:#111827;border:1px solid #334155;border-radius:14px;padding:26px;text-align:center;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.55)">' +
        '<div style="font-size:34px;margin-bottom:10px">&#128274;</div>' +
        '<div style="font-size:17px;font-weight:700;margin-bottom:8px">You&#39;ve been signed out</div>' +
        '<div style="font-size:13px;line-height:1.6;color:#9ca3af;margin-bottom:20px">Your account was just signed in from another location' + where + '. Only one active session is allowed per user.</div>' +
        '<button id="fs-kick-btn" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:11px 22px;font-size:14px;font-weight:600;cursor:pointer">Return to sign in</button>' +
      '</div>';
    document.body.appendChild(ov);
    var btn = document.getElementById('fs-kick-btn');
    if (btn) btn.addEventListener('click', function () { w.location.reload(); });
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    var s = state;
    state = null;
    try { localStorage.removeItem('fs_session'); } catch (e) {}
    if (s && s.sid) {
      post('/api/auth/logout', { userId: s.userId, sid: s.sid }).catch(function () {});
    }
  }

  w.FSSession = { start: start, stop: stop };
})(window);
