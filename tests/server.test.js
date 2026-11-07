import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, validateFiles, safePath } from '../server/app.js';
// Tests must never call a provider with inherited credentials.
delete process.env.AI_API_KEY; delete process.env.AI_MODEL; delete process.env.AI_BASE_URL;
const fixture = { files: { 'index.html': '<!doctype html><html><body><h1>Fixture app</h1><button onclick="this.textContent=42">Try me</button></body></html>', 'server.js': 'console.log("Source only")' }, summary: 'Synthetic test files.', suggestions: ['Add search', 'Add tests', 'Improve mobile'] };
test('accounts, isolation, quotas, sessions, skills, preview and publishing boundaries', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'darker-test-'));
  let providerFails = false, lastInput;
  const instance = await createApp({ dataDir: folder, generate: async input => { lastInput = input; if (providerFails) throw new Error('Synthetic provider failure'); return fixture; } });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(url, method = 'GET', body, headers = {}) {
    const response = await fetch(base + url, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const content = await response.text();
    return { response, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(content) : content };
  }
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.db.close(); await rm(folder, { recursive: true, force: true }); });
  assert.equal((await request('/api/projects')).response.status, 401);
  assert.equal((await request('/server/app.js')).response.status, 404);
  assert.equal((await request('/.data/darker.sqlite')).response.status, 404);
  const countries = (await request('/api/countries')).data;
  assert.ok(countries.length > 200);
  const details = { email: 'person@example.test', password: 'synthetic-long-password', country: 'US', phone: '+12025550123', role: 'owner' };
  assert.equal((await request('/api/register', 'POST', { ...details, phone: '+442079460123' })).response.status, 400);
  const signup = await request('/api/register', 'POST', details);
  assert.equal(signup.response.status, 201); assert.equal(signup.data.user.role, 'customer');
  assert.match(signup.response.headers.get('set-cookie'), /HttpOnly/);
  cookie = signup.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/mcp', 'POST', { method: 'tools/list', id: 1 })).response.status, 403);
  assert.equal((await request('/api/projects', 'POST', { name: 'bad' }, { Origin: 'https://evil.invalid' })).response.status, 403);
  const created = (await request('/api/projects', 'POST', { name: 'Test product' })).data;
  const id = created.id;
  assert.equal((await request('/api/projects/missing')).response.status, 404);
  assert.equal((await request(`/api/projects/${id}/github`, 'POST', { url: 'http://localhost/repo.git' })).response.status, 400);
  assert.equal((await request(`/api/projects/${id}/files`, 'PUT', { files: { '../escape': 'bad' } })).response.status, 502);
  await request('/api/skills', 'POST', { name: 'Accessible', instructions: 'Use semantic HTML.' });
  assert.equal((await request('/api/skills')).data.length, 1);
  await request('/api/settings', 'PUT', { projectInstructions: 'Keep it simple.' });
  assert.equal((await request('/api/settings')).data.projectInstructions, 'Keep it simple.');
  providerFails = true;
  assert.equal((await request(`/api/projects/${id}/prompts`, 'POST', { prompt: 'Build something' })).response.status, 500);
  assert.equal((await request('/api/me')).data.allowance.remaining, 10);
  providerFails = false;
  for (let n = 0; n < 10; n++) {
    const generated = await request(`/api/projects/${id}/prompts`, 'POST', { prompt: 'Build a useful app' });
    assert.equal(generated.response.status, 200);
    assert.equal(generated.data.allowance.remaining, 9 - n);
    assert.equal(generated.data.suggestions.length, 3);
  }
  assert.equal((await request(`/api/projects/${id}`)).data.messages.length, 20);
  assert.equal(lastInput.projectInstructions, 'Keep it simple.');
  assert.equal(lastInput.skills[0].name, 'Accessible');
  const exhausted = await request(`/api/projects/${id}/prompts`, 'POST', { prompt: 'One more' });
  assert.equal(exhausted.response.status, 429); assert.ok(exhausted.data.allowance.resetsAt > Date.now());
  const preview = await request(`/api/projects/${id}/preview`);
  assert.match(preview.data, /Fixture app/); assert.match(preview.response.headers.get('content-security-policy'), /sandbox allow-scripts/);
  const published = await request(`/api/projects/${id}/publish`, 'POST', {});
  assert.match(published.data.url, /^\/sites\/[a-f0-9]+$/);
  const site = await request(published.data.url);
  assert.match(site.data, /Fixture app/); assert.match(site.response.headers.get('content-security-policy'), /default-src 'none'/);
  instance.db.prepare('UPDATE usage SET started=?').run(Date.now() - 86400001);
  assert.equal((await request('/api/me')).data.allowance.remaining, 10);
  assert.equal((await request(`/api/projects/${id}/prompts`, 'POST', { prompt: 'After reset' })).response.status, 200);
  const customerCookie = cookie;
  instance.provision('owner@example.test', 'owner-private-password', 'owner');
  const login = await request('/api/login', 'POST', { email: 'owner@example.test', password: 'owner-private-password' });
  cookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.equal(login.data.allowance.unlimited, true);
  assert.equal((await request(`/api/projects/${id}`)).response.status, 404);
  assert.equal((await request('/api/mcp', 'POST', { jsonrpc: '2.0', method: 'tools/list', id: 1 })).data.result.tools[0].name, 'list_projects');
  const ownerProject = (await request('/api/projects', 'POST', { name: 'Owner project' })).data;
  for (let n = 0; n < 11; n++) assert.equal((await request(`/api/projects/${ownerProject.id}/prompts`, 'POST', { prompt: 'Owner build' })).data.allowance.unlimited, true);
  assert.equal(instance.db.prepare('SELECT count(*) AS n FROM usage WHERE user_id=?').get(login.data.user.id).n, 0);
  const initialized = await request('/api/mcp', 'POST', { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(initialized.data.result.protocolVersion, '2025-03-26');
  assert.equal((await request('/api/mcp', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' })).response.status, 202);
  assert.equal((await request('/api/mcp')).response.status, 405);
  await request('/api/logout', 'POST', {});
  assert.equal((await request('/api/me')).response.status, 401);
  cookie = customerCookie;
  assert.equal((await request('/api/me')).data.user.email, details.email);
});
test('missing AI returns unavailable without using trial allowance', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'darker-noai-'));
  const instance = await createApp({ dataDir: folder }); const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.db.close(); await rm(folder, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const signup = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'other@example.test', password: 'test-only-password', country: 'US', phone: '+12025550124' }) });
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const project = await (await fetch(base + '/api/projects', { method: 'POST', headers, body: '{}' })).json();
  assert.equal((await fetch(base + `/api/projects/${project.id}/prompts`, { method: 'POST', headers, body: '{"prompt":"hello"}' })).status, 503);
  assert.equal((await (await fetch(base + '/api/me', { headers })).json()).allowance.remaining, 10);
});
test('generated file boundary rejects traversal, hidden files and oversized payloads', () => {
  for (const file of ['../x', '/etc/passwd', '.env', 'foo/../x', 'a\\b', 'node_modules/pkg.js']) assert.equal(safePath(file), false);
  assert.throws(() => validateFiles({ 'index.html': 'x'.repeat(1500001) }));
  assert.throws(() => validateFiles({}));
});

test('concurrent generation is rejected and late output cannot overwrite edited files or charge quota', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'darker-conflict-'));
  let finish, entered;
  const generating = new Promise(resolve => { entered = resolve; });
  const instance = await createApp({ dataDir: folder, generate: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.db.close(); await rm(folder, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const signup = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'conflict@example.test', password: 'test-only-password', country: 'US', phone: '+12025550124' }) });
  const headers = { Cookie: signup.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const request = (url, method, body) => fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const project = await (await request('/api/projects', 'POST', {})).json();
  const pending = request(`/api/projects/${project.id}/prompts`, 'POST', { prompt: 'Build my app' });
  await generating;
  assert.equal((await request(`/api/projects/${project.id}/prompts`, 'POST', { prompt: 'Again' })).status, 409);
  const edited = { 'index.html': '<h1>My manual changes</h1>' };
  assert.equal((await request(`/api/projects/${project.id}/files`, 'PUT', { files: edited })).status, 200);
  finish(fixture);
  assert.equal((await pending).status, 409);
  assert.deepEqual((await (await request(`/api/projects/${project.id}`, 'GET')).json()).files, edited);
  assert.equal((await (await request('/api/me', 'GET')).json()).allowance.remaining, 10);
});

test('configured HTTP provider receives project context and failures do not consume prompts', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'darker-provider-'));
  let captured, reject = false;
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    captured = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(raw) };
    res.setHeader('Content-Type', 'application/json');
    if (reject) { res.writeHead(503); res.end('{}'); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ files: fixture.files, summary: fixture.summary }) } }] }));
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => provider.once('listening', resolve));
  const saved = Object.fromEntries(['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { AI_API_KEY: 'synthetic-test-key', AI_MODEL: 'synthetic-model', AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1` });
  const instance = await createApp({ dataDir: folder }); const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => provider.close(resolve))]); instance.db.close(); await rm(folder, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const signup = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'provider@example.test', password: 'test-only-password', country: 'US', phone: '+12025550124' }) });
  const headers = { Cookie: signup.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const request = (url, method, body) => fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const project = await (await request('/api/projects', 'POST', {})).json();
  assert.equal((await (await request('/api/status', 'GET')).json()).ai, true);
  const result = await (await request(`/api/projects/${project.id}/prompts`, 'POST', { prompt: 'Build an accessible app' })).json();
  assert.equal(result.allowance.remaining, 9); assert.equal(result.suggestions.length, 3);
  assert.equal(captured.url, '/v1/chat/completions'); assert.equal(captured.authorization, 'Bearer synthetic-test-key'); assert.equal(captured.body.model, 'synthetic-model');
  assert.equal(JSON.parse(captured.body.messages[1].content).prompt, 'Build an accessible app');
  assert.deepEqual(result.project.files, fixture.files);
  reject = true;
  assert.equal((await request(`/api/projects/${project.id}/prompts`, 'POST', { prompt: 'Try again' })).status, 502);
  assert.equal((await (await request('/api/me', 'GET')).json()).allowance.remaining, 9);
});
