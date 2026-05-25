/* ─── RASED shared utilities ─── */

const API_URL = "https://script.google.com/macros/s/AKfycbzKgE0slQIxLChmvwTA6r01eCSnUu2dQ9exgOX9TJ7VXvUixVoz8d7oHwc9XBYee8TH/exec";
const IMGBB_KEY = "d4d42e5ea72b7ead74254a4b7356963e";

/* ════════════════════════════════════════
   CACHE SYSTEM (stale-while-revalidate)
   ════════════════════════════════════════ */
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const cache = {
  set(key, data) {
    try {
      localStorage.setItem("rc_" + key, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {}
  },
  get(key) {
    try {
      const raw = localStorage.getItem("rc_" + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch { return null; }
  },
  isFresh(key) {
    const entry = this.get(key);
    return entry && (Date.now() - entry.ts < CACHE_TTL);
  },
  clear(key) {
    if (key) localStorage.removeItem("rc_" + key);
    else {
      Object.keys(localStorage)
        .filter(k => k.startsWith("rc_"))
        .forEach(k => localStorage.removeItem(k));
    }
  }
};

/* ── AUTH ─── */
function getUser() {
  const u = localStorage.getItem("rased_user");
  return u ? JSON.parse(u) : null;
}

function requireAuth() {
  if (!getUser()) window.location.href = "login.html";
  return getUser();
}

function logout() {
  localStorage.removeItem("rased_user");
  cache.clear();
  window.location.href = "login.html";
}

/* ════════════════════════════════════════
   API WITH CACHE (stale-while-revalidate)
   ════════════════════════════════════════ */

// Raw fetch (no cache)
async function _apiFetch(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { success: false, error: text }; }
}

// api() — tries cache first, fetches in background
async function api(body, opts = {}) {
  const { noCache = false, onUpdate } = opts;

  // Build cache key from action + relevant params
  const cacheKey = JSON.stringify(body);

  if (!noCache) {
    const cached = cache.get(cacheKey);

    if (cached) {
      // Schedule background revalidation
      if (!cache.isFresh(cacheKey)) {
        _apiFetch(body).then(fresh => {
          cache.set(cacheKey, fresh);
          if (onUpdate) onUpdate(fresh);
        }).catch(() => {});
      } else {
        // Fresh cache: still revalidate silently in the background
        setTimeout(() => {
          _apiFetch(body).then(fresh => {
            cache.set(cacheKey, fresh);
            if (onUpdate) onUpdate(fresh);
          }).catch(() => {});
        }, 100);
      }
      // Return stale data immediately
      return cached.data;
    }
  }

  // No cache: fetch and store
  const result = await _apiFetch(body);
  if (result && result.success !== false) {
    cache.set(cacheKey, result);
  }
  return result;
}

// Invalidate cache for a specific action (after write operations)
function invalidateCache(action) {
  Object.keys(localStorage)
    .filter(k => k.startsWith('rc_') && k.includes('"action":"' + action + '"'))
    .forEach(k => localStorage.removeItem(k));
}

/* ── IMAGE UPLOAD ─── */
async function uploadImage(file) {
  if (!file) return "";
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
    method: "POST", body: form
  });
  const data = await res.json();
  return data.data?.url || "";
}

/* ── TOAST ─── */
function toast(msg, type = "default") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity 0.3s";
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

/* ── SIDEBAR ACTIVE ─── */
function setActiveLink() {
  const page = location.pathname.split("/").pop() || "dashboard.html";
  document.querySelectorAll(".sidebar-nav a").forEach(a => {
    const href = a.getAttribute("href");
    if (href === page) a.classList.add("active");
    else a.classList.remove("active");
  });
}

/* ── TOPBAR USER ─── */
function renderTopbarUser() {
  const user = getUser();
  if (!user) return;
  const el = document.getElementById("topbar-user");
  if (!el) return;
  const initials = user.name ? user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() : "??";
  el.innerHTML = `
    <div class="avatar" title="${user.name}">${user.image ? `<img src="${user.image}">` : initials}</div>
    <div>
      <div style="font-size:13px;font-weight:500;color:var(--text)">${user.name || "User"}</div>
      <div style="font-size:11px;color:var(--text3)">${user.role || ""}</div>
    </div>
  `;
}

/* ── STATUS BADGE ─── */
function statusBadge(status) {
  const s = (status || "").toLowerCase();
  const map = { active: "green", inactive: "red", pending: "amber", expired: "red" };
  const cls = map[s] || "gray";
  return `<span class="badge badge-${cls}">${status || "—"}</span>`;
}

/* ════════════════════════════════════════
   SPA ROUTER — smooth page transitions
   ════════════════════════════════════════ */

const pageCache = {}; // HTML source cache per page
let _transitioning = false;

async function _fetchPage(url) {
  if (pageCache[url]) return pageCache[url];
  const res = await fetch(url);
  const html = await res.text();
  pageCache[url] = html;
  return html;
}

function _extractBody(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return doc.body.innerHTML;
}

function _extractScripts(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const scripts = [];
  doc.querySelectorAll("script").forEach(s => {
    scripts.push({
      src: s.src,
      text: s.textContent
    });
  });
  return scripts;
}

function _extractExtraStyles(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  let styles = "";
  doc.querySelectorAll("style").forEach(s => { styles += s.textContent; });
  return styles;
}

function _extractTitle(html) {
  const m = html.match(/<title>(.*?)<\/title>/i);
  return m ? m[1] : "RASED";
}

async function navigate(href, pushState = true) {
  if (_transitioning) return;

  // If it's login page, do real navigation
  if (href === "login.html" || href === "index.html") {
    window.location.href = href;
    return;
  }

  // If same page, skip
  const currentPage = location.pathname.split("/").pop() || "dashboard.html";
  if (href === currentPage) return;

  _transitioning = true;

  // Show page-level loading indicator
  _showPageLoader();

  // Pre-fetch next page HTML (from page cache if available)
  let html;
  try {
    html = await _fetchPage(href);
  } catch (e) {
    _hidePageLoader();
    _transitioning = false;
    window.location.href = href; // fallback
    return;
  }

  // Fade out current content
  const main = document.querySelector(".main");
  if (main) {
    main.style.transition = "opacity 0.18s ease";
    main.style.opacity = "0";
  }

  await _sleep(180);

  // Swap content
  document.title = _extractTitle(html);
  if (pushState) history.pushState({ href }, "", href);

  // Inject extra <style> tags from new page
  let styleEl = document.getElementById("spa-page-styles");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "spa-page-styles";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = _extractExtraStyles(html);

  // Swap body content
  document.body.innerHTML = _extractBody(html);

  // Fade in
  const newMain = document.querySelector(".main");
  if (newMain) {
    newMain.style.opacity = "0";
    newMain.style.transition = "opacity 0.2s ease";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        newMain.style.opacity = "1";
      });
    });
  }

  // Re-run page scripts (skip shared.js since it's already loaded)
  const scripts = _extractScripts(html);
  for (const s of scripts) {
    if (!s.src || s.src.endsWith("shared.js")) {
      // inline script or shared.js (skip shared.js src)
      if (!s.src) {
        try {
          const fn = new Function(s.text);
          fn();
        } catch (e) { console.error("SPA script error:", e); }
      }
    } else {
      // external script not already loaded
      if (!document.querySelector(`script[src="${s.src}"]`)) {
        await _loadScript(s.src);
      }
    }
  }

  _hidePageLoader();
  _transitioning = false;

  // Prefetch adjacent pages in the background
  _prefetchLinks();
}

function _loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = resolve;
    document.head.appendChild(s);
  });
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let _loaderEl = null;
function _showPageLoader() {
  if (!_loaderEl) {
    _loaderEl = document.createElement("div");
    _loaderEl.id = "spa-loader";
    _loaderEl.innerHTML = `<div id="spa-loader-bar"></div>`;
    document.body.appendChild(_loaderEl);
  }
  const bar = document.getElementById("spa-loader-bar");
  if (bar) {
    bar.style.width = "0%";
    bar.style.transition = "none";
    requestAnimationFrame(() => {
      bar.style.transition = "width 0.4s ease";
      bar.style.width = "70%";
    });
  }
  _loaderEl.style.display = "block";
}

function _hidePageLoader() {
  const bar = document.getElementById("spa-loader-bar");
  if (bar) {
    bar.style.transition = "width 0.15s ease";
    bar.style.width = "100%";
    setTimeout(() => {
      if (_loaderEl) _loaderEl.style.display = "none";
    }, 200);
  }
}

// Intercept all sidebar/internal link clicks
function _interceptLinks() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto")) return;
    // Only intercept .html internal links
    if (!href.endsWith(".html")) return;
    e.preventDefault();
    navigate(href);
  });
}

// Prefetch pages in background on idle
function _prefetchLinks() {
  const links = document.querySelectorAll(".sidebar-nav a[href]");
  const urls = Array.from(links).map(a => a.getAttribute("href")).filter(Boolean);
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => {
      urls.forEach(url => {
        if (!pageCache[url]) {
          fetch(url).then(r => r.text()).then(html => { pageCache[url] = html; }).catch(() => {});
        }
      });
    });
  }
}

// Handle browser back/forward
window.addEventListener("popstate", (e) => {
  const href = (e.state && e.state.href) || location.pathname.split("/").pop() || "dashboard.html";
  navigate(href, false);
});

// Init SPA on first load
(function initSPA() {
  // Inject loader styles
  const loaderStyle = document.createElement("style");
  loaderStyle.textContent = `
    #spa-loader {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 3px;
      z-index: 9999;
      display: none;
      pointer-events: none;
    }
    #spa-loader-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      border-radius: 0 2px 2px 0;
      box-shadow: 0 0 8px rgba(59,130,246,0.6);
    }
  `;
  document.head.appendChild(loaderStyle);
  _interceptLinks();
  _prefetchLinks();

  // Cache current page so back button works
  const currentPage = location.pathname.split("/").pop() || "dashboard.html";
  if (!history.state) {
    history.replaceState({ href: currentPage }, "", currentPage);
  }
})();

/* ── SIDEBAR HTML ─── */
const SIDEBAR_HTML = `
<div class="sidebar">
  <div class="sidebar-logo">
<div class="logo-icon" style="background:none;padding:0;overflow:hidden">
  <img src="rasedlogo.png" style="width:36px;height:36px;object-fit:contain">
</div>
<div>
  <span>RASED</span>
      <small>Facility Management</small>
    </div>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section">Main</div>
    <a href="dashboard.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      Dashboard
    </a>
    <div class="nav-section">Management</div>
    <a href="clients.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Clients
    </a>
    <a href="users.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      Users
    </a>
    <a href="sites.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      Sites
    </a>
    <a href="contracts.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      Contracts
    </a>
    <a href="channels.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.36 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.11 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.1a16 16 0 0 0 6 6l.38-.38a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16l.08.7-.08.22Z"/></svg>
      Channels
    </a>
    <div class="nav-section">Communication</div>
    <a href="chat.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Chat
    </a>
    <div class="nav-section">System</div>
    <a href="reports.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      Reports
    </a>
    <a href="settings.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Settings
    </a>
  </nav>
  <div class="sidebar-footer">
    <button class="btn-logout" onclick="logout()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Logout
    </button>
  </div>
</div>
`;