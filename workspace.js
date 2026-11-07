const $ = selector => document.querySelector(selector);
const draft = new URLSearchParams(location.search).get('prompt');
if (draft) { try { sessionStorage.setItem('darker-draft', draft); } catch {} history.replaceState(null, '', location.pathname); }
let current = null, account = null, integrations = null, limitTimer = null, openFile = null, operation = null;
async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) location.href = '/auth.html'; if (response.status === 429 && data.allowance) showLimit(data.allowance); throw new Error(data.error || 'Request failed.'); }
  return data;
}
function status(message, error = false) { $('#status').textContent = message; $('#status').classList.toggle('error', error); }
function button(text, action) { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', action); return node; }
function saveDraft(value) { try { sessionStorage.setItem('darker-draft', value); } catch { status('Browser storage is unavailable. Keep a copy of your unsent prompt before leaving.', true); } }
function readDraft() { try { return sessionStorage.getItem('darker-draft') || ''; } catch { return ''; } }
$('#prompt').addEventListener('input', () => saveDraft($('#prompt').value));
function showLimit(allowance) {
  const deadline = performance.now() + allowance.resetsAt - (allowance.serverNow || Date.now());
  if (deadline <= performance.now()) { refreshAccount().catch(error => status(error.message, true)); return; }
  const update = () => { const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000)); $('#countdown').textContent = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; if (!seconds) { clearInterval(limitTimer); $('#limit').close(); refreshAccount().catch(error => status(error.message, true)); } };
  clearInterval(limitTimer); update(); limitTimer = setInterval(update, 1000); if (!$('#limit').open) $('#limit').showModal();
}
function renderAllowance() {
  const a = account.allowance;
  $('#allowance').textContent = a.unlimited ? `${account.user.role === 'owner' ? 'Owner' : 'Admin'} access · No Darker prompt quota · Provider costs may apply` : `${a.remaining} of 10 prompts available${a.resetsAt ? ' · Resets ' + new Date(a.resetsAt).toLocaleString() : ' · 24-hour window starts with your first successful prompt'}`;
  $('#send').disabled = !!operation || !integrations?.ai || (!a.unlimited && a.remaining === 0);
  if (!a.unlimited && a.remaining === 0) showLimit(a);
}
function setOperation(value) {
  operation = value;
  for (const selector of ['#new', '#prompt', '#code', '#file', '#save-file', '#import', '#publish', '#export', '#create-project']) $(selector).disabled = !!operation;
  $('#project-list').querySelectorAll('button').forEach(node => { node.disabled = !!operation; });
  if (account) renderAllowance();
}
async function refreshAccount() { account = await api('/api/me'); renderAllowance(); }
async function listProjects() {
  const rows = await api('/api/projects'); $('#project-list').replaceChildren(...rows.map(row => button(row.name, () => openProject(row.id).catch(error => status(error.message, true)))));
  $('#empty').hidden = rows.length > 0;
  if (!current && rows.length) await openProject(rows[0].id);
}
let renderedProject = null, renderedMessages = [];
function renderLog() {
  let overlap = renderedProject === current.id ? Math.min(renderedMessages.length, current.messages.length) : 0;
  while (overlap && !renderedMessages.slice(-overlap).every((message, i) => message.role === current.messages[i].role && message.text === current.messages[i].text)) overlap--;
  while ($('#log').children.length > overlap) $('#log').firstElementChild.remove();
  for (const message of current.messages.slice(overlap)) {
    const node = document.createElement('div'); node.className = `message ${message.role}`;
    const label = document.createElement('strong'); label.textContent = message.role === 'user' ? 'YOU' : 'DARKER';
    const content = document.createElement('span'); content.textContent = message.text; node.append(label, content); $('#log').append(node);
  }
  renderedProject = current.id; renderedMessages = current.messages.slice();
  $('#log').scrollTop = $('#log').scrollHeight;
}
function hasUnsavedFile() { return current && openFile && $('#code').value !== current.files[openFile]; }
function requireSavedFile() { if (!hasUnsavedFile()) return true; status('Save your file changes first.', true); $('#save-file').focus(); return false; }
window.addEventListener('beforeunload', event => { if (hasUnsavedFile()) { event.preventDefault(); event.returnValue = ''; } });
function renderProject() {
  $('#editor').hidden = false; $('#project-name').textContent = current.name; $('#source').textContent = current.source || 'Your own idea, from the ground up.';
  renderLog();
  const selectedFile = $('#file').value;
  const files = Object.keys(current.files); $('#file').replaceChildren(...files.map(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; return option; }));
  if (files.includes(selectedFile)) $('#file').value = selectedFile;
  openFile = $('#file').value;
  $('#code').value = current.files[openFile] ?? '';
  if (current.files['index.html']) { $('#preview').removeAttribute('srcdoc'); $('#preview').src = `/api/projects/${current.id}/preview?v=${current.updated}`; }
  else { $('#preview').removeAttribute('src'); $('#preview').srcdoc = '<!doctype html><html lang="en"><body><h2>Your next idea belongs here.</h2><p>Import a self-contained HTML project or connect AI to generate one.</p></body></html>'; }
  $('#publication').textContent = ''; $('#suggestions').replaceChildren();
}
async function openProject(id, discardConfirmed = false) { if (!discardConfirmed && hasUnsavedFile() && !confirm('Discard unsaved file changes and switch projects?')) return; current = await api('/api/projects/' + id); renderProject(); }
$('#new').addEventListener('click', () => { $('#new-project-error').textContent = ''; $('#new-project-dialog').showModal(); $('#new-project-name').focus(); });
$('#cancel-project').addEventListener('click', () => $('#new-project-dialog').close());
$('#new-project-form').addEventListener('submit', async event => {
  event.preventDefault(); if (operation) return; if (hasUnsavedFile() && !confirm('Discard unsaved file changes and create a new project?')) return; setOperation('create');
  try { const row = await api('/api/projects', 'POST', { name: $('#new-project-name').value }); await openProject(row.id, true); await listProjects(); $('#new-project-dialog').close(); event.target.reset(); }
  catch (error) { $('#new-project-error').textContent = error.message; }
  finally { setOperation(null); }
});
$('#prompt-form').addEventListener('submit', async event => {
  event.preventDefault(); if (operation || !current || !requireSavedFile()) return;
  const projectId = current.id;
  setOperation('generate'); status('Working on your idea…');
  try { const result = await api(`/api/projects/${projectId}/prompts`, 'POST', { prompt: $('#prompt').value }); account.allowance = result.allowance; if (current?.id === projectId) { current = result.project; renderProject(); $('#prompt').value = ''; saveDraft(''); $('#suggestions').replaceChildren(...result.suggestions.map(text => button(text, () => { $('#prompt').value = text; saveDraft(text); $('#prompt').focus(); }))); } renderAllowance(); status('Project files saved. Preview shows HTML only; backend code still needs its own runtime.'); }
  catch (error) { status(error.message, true); }
  finally { setOperation(null); }
});
$('#github-form').addEventListener('submit', async event => { event.preventDefault(); if (operation || !current || !confirm('Import this repository? This replaces the current project files.')) return; const projectId = current.id; setOperation('import'); status('Cloning public repository. This can take a minute…'); try { const result = await api(`/api/projects/${projectId}/github`, 'POST', { url: $('#github').value }); if (current?.id === projectId) { current = result.project; renderProject(); } status(result.note); } catch (error) { status(error.message, true); } finally { setOperation(null); } });
$('#file').addEventListener('change', () => { if (hasUnsavedFile() && !confirm('Discard unsaved changes to this file?')) { $('#file').value = openFile; return; } openFile = $('#file').value; $('#code').value = current.files[openFile] || ''; });
$('#mobile').addEventListener('click', () => { const active = $('#preview').classList.toggle('preview-mobile'); $('#mobile').setAttribute('aria-pressed', String(active)); });
$('#export').addEventListener('click', () => { if (current && requireSavedFile()) location.href = `/api/projects/${current.id}/export`; });
$('#publish').addEventListener('click', async () => { if (!current || !requireSavedFile() || !confirm('Publish this HTML snapshot publicly on this Darker server? Anyone with the link can view it.')) return; try { const result = await api(`/api/projects/${current.id}/publish`, 'POST', {}); const link = document.createElement('a'); link.href = result.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open published HTML ↗'; $('#publication').replaceChildren(link, document.createTextNode(' — ' + result.note)); } catch (error) { status(error.message, true); } });
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', 'POST', {}); try { sessionStorage.removeItem('darker-draft'); } catch {} location.href = '/auth.html'; } catch (error) { status(error.message, true); } });
$('#close-limit').addEventListener('click', () => $('#limit').close());
document.querySelectorAll('[data-tab]').forEach(tab => { tab.addEventListener('keydown', event => {
  const tabs = [...document.querySelectorAll('[data-tab]')], index = tabs.indexOf(tab);
  const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
  if (next !== undefined) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
}); tab.addEventListener('click', () => { for (const name of ['projects', 'skills', 'settings']) $('#' + name).hidden = name !== tab.dataset.tab; document.querySelectorAll('[data-tab]').forEach(item => { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; }); }); });
async function loadSkills() { const rows = await api('/api/skills'); $('#skill-list').replaceChildren(...rows.map(row => { const li = document.createElement('li'); const title = document.createElement('strong'); title.textContent = row.name; const copy = document.createElement('p'); copy.className = 'muted'; copy.textContent = row.instructions; li.append(title, copy, button('Remove', async () => { try { await api('/api/skills/' + row.id, 'DELETE'); await loadSkills(); } catch (error) { status(error.message, true); } })); return li; })); }
$('#skill-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/skills', 'POST', { name: $('#skill-name').value, instructions: $('#skill-instructions').value }); event.target.reset(); await loadSkills(); status('Skill saved.'); } catch (error) { status(error.message, true); } });
$('#settings-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/settings', 'PUT', { projectInstructions: $('#instructions').value }); status('Settings saved.'); } catch (error) { status(error.message, true); } });
$('#mcp').addEventListener('click', async () => { try { const result = await api('/api/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }); $('#mcp-output').textContent = JSON.stringify(result.result, null, 2); } catch (error) { status(error.message, true); } });
(async () => { try { account = await api('/api/me'); integrations = await api('/api/status'); $('#ai-help').textContent = integrations.ai ? 'AI provider configured. Usage and provider charges depend on your account.' : 'AI is not connected. Import or edit HTML now; generation becomes available after the owner configures a provider.'; $('#account').textContent = `${account.user.email} · ${account.user.role}`; renderAllowance(); $('#integrations').replaceChildren(...[['AI generation', integrations.ai ? 'Configured; real generation needs verification' : 'Not connected'], ['Local SQLite database', 'Available'], ['Static HTML publishing', 'Available on this server'], ['Payments', 'Not connected'], ['Email delivery', 'Not connected'], ['SMS verification', 'Not connected']].map(([name, state]) => { const p = document.createElement('p'); p.className = 'muted'; p.textContent = `${name}: ${state}`; return p; })); if (!integrations.ai) status('AI is not connected yet. You can create projects, import GitHub files, use skills, and publish self-contained HTML. Ask the owner to configure an AI provider before generating code.'); const settings = await api('/api/settings'); $('#instructions').value = settings.projectInstructions || ''; await loadSkills(); await listProjects(); $('#prompt').value = readDraft(); } catch (error) { status(error.message, true); } })();

$('#save-file').addEventListener('click', async () => {
  if (operation || !current || !openFile) return;
  const projectId = current.id, files = { ...current.files, [openFile]: $('#code').value };
  setOperation('save');
  try { const saved = await api(`/api/projects/${projectId}/files`, 'PUT', { files }); if (current?.id === projectId) { current = saved; renderProject(); } status('File saved and preview refreshed.'); }
  catch (error) { status(error.message, true); }
  finally { setOperation(null); }
});
