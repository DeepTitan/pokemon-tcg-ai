// Offline UI fixture only. This file is excluded from the website deployment.
// No Cognito, Stripe, email, capture, or native app calls are made.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../landing');
const port = Number(process.env.TRACE_MEMBERSHIP_PREVIEW_PORT || 5190);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const account = { email: 'player@example.test', plan: 'supporter', traceAccess: true, opponentDecklists: true, admin: false, status: 'active', expiresAt: '2099-10-27T08:00:00Z', cancelAtPeriodEnd: false };
const routes = new Set(['account', 'signup', 'login', 'confirm', 'reset', 'recover', 'connect']);
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const send = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/__fixture') {
      const role = ['admin', 'supporter', 'trace', 'none', 'anonymous', 'unconfigured'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'anonymous';
      res.setHeader('Set-Cookie', `trace-preview-role=${role}; Path=/; SameSite=Lax`);
      res.statusCode = 303; res.setHeader('Location', '/trace/account'); return res.end();
    }
    if (url.pathname.startsWith('/trace/api/')) {
      const action = url.pathname.slice('/trace/api/'.length);
      const role = /trace-preview-role=(admin|supporter|trace|none|anonymous|unconfigured)/.exec(req.headers.cookie || '')?.[1] || 'anonymous';
      if (role === 'unconfigured') return send(503, { error: 'Memberships are not available yet. Please check back soon.' });
      if (action === 'account') {
        if (role === 'anonymous') return send(401, { error: 'Sign in to continue.' });
        return send(200, { ...account, ...(role === 'admin' ? { plan: 'supporter', status: 'admin', admin: true, expiresAt: null } : role === 'trace' ? { plan: 'trace', opponentDecklists: false } : role === 'none' ? { plan: 'none', status: 'none', traceAccess: false, opponentDecklists: false, expiresAt: null } : {}) });
      }
      if (action === 'auth/login') { res.setHeader('Set-Cookie', 'trace-preview-role=none; Path=/; SameSite=Lax'); return send(200, { authenticated: true }); }
      if (action === 'auth/logout') { res.setHeader('Set-Cookie', 'trace-preview-role=anonymous; Path=/; SameSite=Lax'); return send(200, { signedOut: true }); }
      if (['auth/signup', 'auth/resend', 'auth/confirm', 'auth/recover', 'auth/reset'].includes(action)) return send(200, { ok: true });
      if (action === 'devices/link/approve' && req.method === 'POST') return send(200, { linked: true });
      if (action === 'checkout' || action === 'portal') return send(503, { error: 'Local preview: billing is disabled. No payment has been started.' });
      return send(404, { error: 'Not part of this offline preview.' });
    }
    if (url.pathname === '/trace/access') return send(503, { error: 'Local preview: installer downloads are disabled.' });
    let file;
    if (url.pathname === '/' || url.pathname === '/trace') file = 'index.html';
    else if (routes.has(url.pathname.replace('/trace/', ''))) file = 'account.html';
    else if (url.pathname === '/trace-styles.css') file = 'styles.css';
    else if (url.pathname === '/trace-script.js') file = 'script.js';
    else if (url.pathname === '/trace-member.js') file = 'member.js';
    else if (url.pathname.startsWith('/trace-assets/')) file = 'assets/' + url.pathname.slice('/trace-assets/'.length);
    else return send(404, { error: 'This page is outside the offline membership preview.' });
    const target = path.resolve(root, file);
    if (!target.startsWith(root + '/')) return send(404, { error: 'Not found.' });
    let bytes = await fs.readFile(target);
    if (file.endsWith('.html')) bytes = Buffer.from(bytes.toString().replace('</body>', '<aside style="position:fixed;bottom:8px;right:10px;z-index:10;background:#172b49;color:#fff;padding:5px 9px;font:11px system-ui;border-radius:3px">Local preview · payments disabled</aside></body>'));
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(bytes);
  } catch { res.statusCode = 404; res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Offline Trace memberships: http://127.0.0.1:${port}/trace`));
