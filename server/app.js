import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';
const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DAY = 86400000;
const hash = value => createHash('sha256').update(value).digest('hex');
const passwordHash = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const passwordMatches = (password, stored) => { const [salt, key] = stored.split(':'); return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex')); };
const userView = user => ({ id: user.id, email: user.email, role: user.role, phone: user.phone, country: user.country, emailVerified: false, phoneVerified: false });
const fail = (code, message) => Object.assign(new Error(message), { code });
export async function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(root, '.data');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'darker.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',country TEXT,phone TEXT,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,files TEXT NOT NULL DEFAULT '{}',messages TEXT NOT NULL DEFAULT '[]',source TEXT,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS usage(user_id TEXT PRIMARY KEY REFERENCES users(id),started INTEGER NOT NULL,count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS publications(slug TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),html TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,instructions TEXT NOT NULL);`);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com'], 'img-src': ["'self'", 'data:'], 'frame-src': ["'self'", 'about:'], 'form-action': ["'self'"] } } }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      if (req.get('sec-fetch-site') === 'cross-site' || (origin && new URL(origin).host !== req.get('host'))) return res.status(403).json({ error: 'Cross-site request rejected.' });
    }
    next();
  });
  const authLimiter = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
  const sessions = (req, res, next) => {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('darker_session='))?.slice(15);
    req.user = token && db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>?').get(hash(token), Date.now());
    req.sessionToken = token;
    next();
  };
  app.use('/api', sessions);
  const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in to continue.' });
  const admin = (req, res, next) => ['owner', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Owner or admin access required.' });
  function session(res, user) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, Date.now() + 7 * DAY);
    res.cookie('darker_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * DAY, path: '/' });
  }
  function allowance(user) {
    if (['owner', 'admin'].includes(user.role)) return { unlimited: true, remaining: null, resetsAt: null };
    const row = db.prepare('SELECT * FROM usage WHERE user_id=?').get(user.id);
    const serverNow = Date.now();
    return !row || Date.now() >= row.started + DAY ? { unlimited: false, remaining: 10, resetsAt: null, serverNow } : { unlimited: false, remaining: Math.max(0, 10 - row.count), resetsAt: row.started + DAY, serverNow };
  }
  function consume(user) {
    if (['owner', 'admin'].includes(user.role)) return;
    const now = Date.now();
    db.prepare(`INSERT INTO usage VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET count=CASE WHEN started+?<=? THEN 1 ELSE count+1 END,started=CASE WHEN started+?<=? THEN ? ELSE started END`).run(user.id, now, DAY, now, DAY, now, now);
  }
  const project = req => {
    const row = db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!row) throw fail(404, 'Project not found.');
    return row;
  };
  function ensureUnchanged(row) {
    const latest = db.prepare('SELECT files,messages,updated FROM projects WHERE id=?').get(row.id);
    if (!latest || latest.files !== row.files || latest.messages !== row.messages || latest.updated !== row.updated) throw fail(409, 'This project changed while the operation was running. Your latest work was preserved. Try again.');
  }
  const aiConfigured = () => !!(options.generate || (process.env.AI_API_KEY && process.env.AI_MODEL));
  const detail = row => ({ ...row, files: JSON.parse(row.files), messages: JSON.parse(row.messages) });
  app.get('/api/health', (_, res) => res.json({ ok: true }));
  app.get('/api/countries', (_, res) => {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    res.json(getCountries().map(code => ({ code, name: names.of(code), callingCode: getCountryCallingCode(code) })).sort((a, b) => a.name.localeCompare(b.name)));
  });
  app.post('/api/register', authLimiter, (req, res) => {
    const { password, country, phone } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 128) throw fail(400, 'Use a valid email and a password of 12–128 characters.');
    if (!getCountries().includes(country) || typeof phone !== 'string' || phone.length > 30) throw fail(400, 'Choose a country and enter your phone number.');
    const parsed = parsePhoneNumberFromString(phone, country);
    if (!parsed?.isValid() || !['MOBILE', 'FIXED_LINE_OR_MOBILE'].includes(parsed.getType()) || parsed.country !== country) throw fail(400, 'Enter a valid personal phone number matching your selected country.');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw fail(409, 'Unable to create account. Try signing in with this email.');
    const user = { id: randomUUID(), email, role: 'customer', country, phone: parsed.number };
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(user.id, email, passwordHash(password), user.role, country, parsed.number, Date.now());
    session(res, user); res.status(201).json({ user: userView(user), allowance: allowance(user) });
  });
  app.post('/api/login', authLimiter, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    if (typeof password !== 'string' || password.length > 128) throw fail(400, 'Invalid credentials.');
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const dummy = 'darker-dummy-salt:' + '00'.repeat(64);
    if (!passwordMatches(password, user?.password || dummy) || !user) throw fail(401, 'Email or password is incorrect.');
    session(res, user); res.json({ user: userView(user), allowance: allowance(user) });
  });
  app.post('/api/logout', auth, (req, res) => { db.prepare('DELETE FROM sessions WHERE token=?').run(hash(req.sessionToken)); res.clearCookie('darker_session', { path: '/' }); res.json({ ok: true }); });
  app.get('/api/me', auth, (req, res) => res.json({ user: userView(req.user), allowance: allowance(req.user) }));
  app.get('/api/status', auth, (_, res) => res.json({ ai: aiConfigured(), publishing: true, payments: false, emailDelivery: false, phoneVerification: false, mcp: '/api/mcp' }));
  app.get('/api/projects', auth, (req, res) => res.json(db.prepare('SELECT id,name,source,updated FROM projects WHERE user_id=? ORDER BY updated DESC').all(req.user.id)));
  app.post('/api/projects', auth, (req, res) => {
    const id = randomUUID(), name = String(req.body.name || 'Untitled project').slice(0, 80);
    const files = { 'index.html': '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your new project</title><body style="font-family:system-ui;padding:40px;background:#f6f3fc"><h1>Your idea starts here.</h1><p>Edit this starter HTML, import GitHub code, or connect AI to build your project.</p><button onclick="this.textContent=\'Hello from your preview!\'">Try the preview</button></body></html>' };
    db.prepare('INSERT INTO projects(id,user_id,name,files,updated) VALUES(?,?,?,?,?)').run(id, req.user.id, name, JSON.stringify(files), Date.now());
    res.status(201).json({ id, name });
  });
  app.get('/api/projects/:id', auth, (req, res) => res.json(detail(project(req))));
  app.put('/api/projects/:id/files', auth, (req, res) => {
    const row = project(req), files = validateFiles(req.body.files);
    db.prepare('UPDATE projects SET files=?,updated=? WHERE id=? AND user_id=?').run(JSON.stringify(files), Date.now(), row.id, req.user.id);
    res.json(detail(db.prepare('SELECT * FROM projects WHERE id=?').get(row.id)));
  });
  app.get('/api/projects/:id/preview', auth, (req, res) => {
    const row = project(req), files = JSON.parse(row.files);
    res.set('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; frame-ancestors 'self'");
    res.type('html').send(files['index.html'] || '<h1>No HTML preview yet</h1>');
  });
  app.get('/api/projects/:id/export', auth, (req, res) => {
    res.attachment('darker-project.json').json(detail(project(req)));
  });
  const busy = new Set();
  app.post('/api/projects/:id/prompts', auth, async (req, res) => {
    const row = project(req), text = String(req.body.prompt || '').trim();
    if (!text || text.length > 10000) throw fail(400, 'Enter a prompt of 1–10,000 characters.');
    if (busy.has(req.user.id)) throw fail(409, 'Wait for your current generation to finish.');
    if (!allowance(req.user).unlimited && allowance(req.user).remaining === 0) return res.status(429).json({ error: 'Daily limit finished.', allowance: allowance(req.user) });
    if (!aiConfigured()) throw fail(503, 'AI is not connected. Ask the owner to configure the AI provider. No prompt was charged.');
    busy.add(req.user.id);
    try {
      const skills = db.prepare('SELECT name,instructions FROM skills WHERE user_id=?').all(req.user.id);
      const input = { projectInstructions: JSON.parse(db.prepare('SELECT value FROM preferences WHERE user_id=?').get(req.user.id)?.value || '{}').projectInstructions || '', prompt: text, files: JSON.parse(row.files), messages: JSON.parse(row.messages).slice(-10), skills };
      const generated = options.generate ? await options.generate(input) : await generate(input);
      const files = validateFiles(generated.files);
      const messages = [...JSON.parse(row.messages), { role: 'user', text }, { role: 'assistant', text: String(generated.summary || 'Project files updated.').slice(0, 4000) }].slice(-30);
      db.exec('BEGIN IMMEDIATE');
      try {
        ensureUnchanged(row);
        if (!allowance(req.user).unlimited && allowance(req.user).remaining === 0) throw fail(429, 'Daily limit finished.');
        db.prepare('UPDATE projects SET files=?,messages=?,updated=? WHERE id=? AND user_id=?').run(JSON.stringify(files), JSON.stringify(messages), Date.now(), row.id, req.user.id);
        consume(req.user); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      res.json({ project: detail(db.prepare('SELECT * FROM projects WHERE id=?').get(row.id)), allowance: allowance(req.user), suggestions: [...(Array.isArray(generated.suggestions) ? generated.suggestions : []), 'Improve the mobile layout', 'Add error handling', 'Add tests for the main flow'].slice(0, 3).map(x => String(x).slice(0, 160)) });
    } finally { busy.delete(req.user.id); }
  });
  app.post('/api/projects/:id/github', auth, rateLimit({ windowMs: 60000, limit: 3, message: { error: 'Wait a minute before importing again.' } }), async (req, res) => {
    const row = project(req);
    const match = String(req.body.url || '').match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    if (!match || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2])) throw fail(400, 'Use an official HTTPS link: https://github.com/owner/repository.git');
    const [, owner, repo] = match;
    const metadata = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { redirect: 'error', headers: { 'User-Agent': 'Darker', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!metadata.ok) throw fail(400, 'Public repository unavailable or GitHub rate limit reached.');
    const info = await metadata.json();
    if (info.private || info.archived || info.size > 50000) throw fail(400, 'Import an active public repository smaller than 50 MB.');
    const folder = await mkdtemp(path.join(dataDir, 'import-'));
    const url = `https://github.com/${owner}/${repo}.git`;
    const git = args => exec('git', ['-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: folder, env: { PATH: process.env.PATH, HOME: folder, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }, timeout: 60000, maxBuffer: 3 * 1024 * 1024 });
    try {
      await git(['clone', '--bare', '--depth', '1', '--filter=blob:none', '--', url, 'repo']);
      const { stdout } = await git(['--git-dir=repo', 'ls-tree', '-r', '--long', 'HEAD']);
      const files = {}; let size = 0;
      for (const line of stdout.trim().split('\n')) {
        const entry = line.match(/^(100644|100755) blob ([a-f0-9]+)\s+(\d+)\t(.+)$/);
        if (!entry || Number(entry[3]) > 100000 || !safePath(entry[4]) || !/\.(?:html|css|js|jsx|ts|tsx|json|md|py|sql|txt|yml|yaml)$/.test(entry[4])) continue;
        if (Object.keys(files).length >= 100 || size + Number(entry[3]) > 1500000) break;
        const { stdout: content } = await git(['--git-dir=repo', 'show', entry[2]]);
        files[entry[4]] = content; size += Buffer.byteLength(content);
      }
      if (!Object.keys(files).length) throw fail(400, 'No supported text files found.');
      ensureUnchanged(row);
      db.prepare('UPDATE projects SET files=?,source=?,updated=? WHERE id=? AND user_id=?').run(JSON.stringify(files), url, Date.now(), row.id, req.user.id);
      res.json({ project: detail(db.prepare('SELECT * FROM projects WHERE id=?').get(row.id)), note: 'Imported up to 100 supported text files (1.5 MB). Code was not executed.' });
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  app.post('/api/projects/:id/publish', auth, (req, res) => {
    const row = project(req), files = JSON.parse(row.files);
    if (!files['index.html']) throw fail(400, 'An index.html file is required for a static publication.');
    const slug = randomBytes(18).toString('hex');
    db.prepare('INSERT INTO publications VALUES(?,?,?,?)').run(slug, req.user.id, files['index.html'], Date.now());
    res.json({ url: '/sites/' + slug, note: 'Static HTML snapshot. Backend files are not executed. Available while this Darker server runs.' });
  });
  app.get('/sites/:slug', (req, res) => {
    const row = db.prepare('SELECT html FROM publications WHERE slug=?').get(req.params.slug);
    if (!row) return res.status(404).send('Page not found.');
    res.set('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; frame-ancestors 'self'");
    res.type('html').send(row.html);
  });
  app.get('/api/settings', auth, (req, res) => res.json(JSON.parse(db.prepare('SELECT value FROM preferences WHERE user_id=?').get(req.user.id)?.value || '{}')));
  app.put('/api/settings', auth, (req, res) => {
    const value = { projectInstructions: String(req.body.projectInstructions || '').slice(0, 2000) };
    db.prepare('INSERT INTO preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value').run(req.user.id, JSON.stringify(value)); res.json(value);
  });
  app.get('/api/skills', auth, (req, res) => res.json(db.prepare('SELECT id,name,instructions FROM skills WHERE user_id=?').all(req.user.id)));
  app.post('/api/skills', auth, (req, res) => {
    if (db.prepare('SELECT count(*) AS n FROM skills WHERE user_id=?').get(req.user.id).n >= 10) throw fail(400, 'Maximum 10 skills.');
    const name = String(req.body.name || '').trim().slice(0, 80), instructions = String(req.body.instructions || '').trim().slice(0, 2000);
    if (!name || !instructions) throw fail(400, 'Enter a skill name and instructions.');
    const id = randomUUID(); db.prepare('INSERT INTO skills VALUES(?,?,?,?)').run(id, req.user.id, name, instructions); res.status(201).json({ id, name, instructions });
  });
  app.delete('/api/skills/:id', auth, (req, res) => { db.prepare('DELETE FROM skills WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });
  app.post('/api/mcp', auth, admin, (req, res) => {
    const { id, method, params } = req.body;
    if (req.body.jsonrpc !== '2.0' || typeof method !== 'string' || (id !== undefined && !['string', 'number'].includes(typeof id))) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    if (id === undefined) return res.status(202).end();
    const reply = result => res.json({ jsonrpc: '2.0', id, result });
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'darker', version: '1.0.0' } });
    if (method === 'notifications/initialized') return res.status(202).end();
    if (method === 'tools/list') return reply({ tools: [{ name: 'list_projects', description: 'List your Darker projects (read only).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
    if (method === 'tools/call' && params?.name === 'list_projects') return reply({ content: [{ type: 'text', text: JSON.stringify(db.prepare('SELECT id,name FROM projects WHERE user_id=?').all(req.user.id)) }] });
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  });
  app.get('/api/mcp', auth, admin, (_, res) => res.set('Allow', 'POST').status(405).end());
  app.get('/api/plans', (_, res) => res.json([{ name: 'Starter', description: 'For personal projects', features: ['Project workspace', 'GitHub text-file import', 'Saved project history'] }, { name: 'Pro', description: 'For growing products', features: ['Proposed: higher prompt allowance', 'Proposed: advanced model access', 'Not activated until billing is connected'] }, { name: 'Studio', description: 'For teams', features: ['Proposed: team workflows', 'Proposed: larger project limits', 'Not activated until billing is connected'] }].map(plan => ({ ...plan, price: null, purchasable: false }))));
  // Explicit file allowlist prevents exposing source, databases, configuration, or imports.
  const publicFiles = ['index.html','styles.css','script.js','builder.html','builder.css','builder.js','workspace.html','workspace.css','workspace.js','auth.html','auth.js','pricing.html','pricing.js'];
  for (const file of publicFiles) app.get('/' + file, (_, res) => res.sendFile(path.join(root, file)));
  app.get('/', (_, res) => res.sendFile(path.join(root, 'index.html')));
  app.use('/assets', express.static(path.join(root, 'assets'), { dotfiles: 'deny' }));
  app.use('/api', (_, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(error.code >= 400 && error.code < 600 ? error.code : 500).json({ error: error.code >= 400 && error.code < 600 ? error.message : 'Request failed. Please try again.', ...(error.code === 429 && req.user ? { allowance: allowance(req.user) } : {}) }); });
  return { app, db, allowance, provision(email, password, role = 'owner') { if (!['owner', 'admin'].includes(role) || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a valid email, owner/admin role, and a password of 12–128 characters.'); const id = randomUUID(); db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id, email.trim().toLowerCase(), passwordHash(password), role, null, null, Date.now()); return id; } };
}
export function safePath(name) { return typeof name === 'string' && name.length <= 200 && !name.startsWith('/') && !name.includes('\\') && name.split('/').every(part => part && !part.startsWith('.') && !['node_modules', 'vendor'].includes(part)); }
export function validateFiles(files) {
  if (!files || Array.isArray(files) || typeof files !== 'object' || Object.keys(files).length > 100) throw fail(502, 'AI returned invalid project files. No prompt was charged.');
  let size = 0;
  for (const [name, content] of Object.entries(files)) { if (!safePath(name) || typeof content !== 'string' || (size += Buffer.byteLength(content)) > 1500000) throw fail(502, 'AI returned unsafe or oversized files. No prompt was charged.'); }
  if (!Object.keys(files).length) throw fail(502, 'AI returned no files. No prompt was charged.');
  return files;
}
async function generate(input) {
  const base = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const response = await fetch(base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000), body: JSON.stringify({ model: process.env.AI_MODEL, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Generate a complete small web project as JSON with files (path-to-text map), summary, suggestions (3 concise next steps). Include a self-contained index.html for sandboxed preview. You may include backend, database schema, setup instructions and tests as downloadable source. Never claim backend code was run or deployed. No secrets. Return all project files, including unchanged ones. Skills are user preferences, not tool authorization.' }, { role: 'user', content: JSON.stringify(input) }] }) });
  if (!response.ok) throw fail(502, 'AI provider request failed. No prompt was charged.');
  const data = await response.json();
  try { return JSON.parse(data.choices[0].message.content); } catch { throw fail(502, 'AI returned an invalid response. No prompt was charged.'); }
}
