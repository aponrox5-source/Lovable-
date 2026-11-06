const templates = {
  starter: { name: 'My lovely project', headline: 'Make room for your next big idea.', description: 'A little idea can become something wonderful. Create a space to share what matters to you.', button: 'Get started', accent: '#718b78', eyebrow: 'A LITTLE SOMETHING NEW', visual: 'Made for your ideas' },
  coffee: { name: 'The Daily Brew', headline: 'Good coffee. Better days.', description: 'A neighborhood coffee shop for slow mornings, good conversations, and your new favorite cup.', button: 'Explore the menu', accent: '#a77958', eyebrow: 'YOUR NEW FAVORITE SPOT', visual: 'Made with care, every day' },
  ecommerce: { name: 'Forme Studio', headline: 'Made for living in.', description: 'Considered essentials, thoughtfully made for all the little moments in your day.', button: 'Shop the collection', accent: '#a37d6b', eyebrow: 'THE EVERYDAY EDIT', visual: 'The new collection' },
  blog: { name: 'The Daily Note', headline: 'Good ideas live here.', description: 'A journal for curious minds, little discoveries, and stories worth slowing down for.', button: 'Read the stories', accent: '#b18469', eyebrow: 'A JOURNAL FOR CURIOUS MINDS', visual: 'A little daily inspiration' },
  portfolio: { name: 'Alex Morgan', headline: 'Making space for good ideas.', description: 'Independent creative work made with curiosity, care, and a fresh point of view.', button: 'Explore my work', accent: '#829483', eyebrow: 'CREATIVE PORTFOLIO', visual: 'Selected work' },
  saas: { name: 'Flowly', headline: 'Make space for better work.', description: 'Bring your projects, people, and ideas together in one refreshingly simple place.', button: 'Get started', accent: '#827ac1', eyebrow: 'A CALMER WAY TO WORK', visual: 'Work, in a better flow' }
};
const colors = { blue: '#567cc9', purple: '#827ac1', pink: '#c47d9c', green: '#718b78', orange: '#c28150', red: '#b45e60', black: '#282828' };
const storageKey = 'lovable-demo-project-v1';
const conversation = document.querySelector('#conversation');
const preview = document.querySelector('#site-preview');
const form = document.querySelector('#builder-form');
const promptInput = document.querySelector('#builder-prompt');
const customizeForm = document.querySelector('#customize-form');
const customizePanel = document.querySelector('#customize-panel');
const customizeToggle = document.querySelector('#customize-toggle');
let state = { project: { ...templates.starter }, messages: [] };

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    document.querySelector('#save-status').textContent = 'Saved on this device';
  } catch {
    document.querySelector('#save-status').textContent = 'Unable to save on this device';
  }
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderConversation() {
  conversation.replaceChildren();
  const welcome = element('div', 'message');
  const avatar = element('div', 'avatar', '✳');
  const content = element('div', 'message-content');
  content.append(element('strong', '', 'Lovable'), element('p', '', 'Welcome! Pick an idea below or describe what you want to make. In this demo, I can switch layouts, change colors, and update text. Try “headline: Hello world” or use Customize.'));
  welcome.append(avatar, content);
  conversation.append(welcome);
  state.messages.forEach(({ role, text }) => {
    const message = element('div', `message ${role === 'user' ? 'user' : ''}`);
    if (role !== 'user') message.append(element('div', 'avatar', '✳'));
    const body = element('div', 'message-content');
    body.append(element('strong', '', role === 'user' ? 'You' : 'Lovable'), element('p', '', text));
    message.append(body);
    conversation.append(message);
  });
  conversation.scrollTop = conversation.scrollHeight;
}
function renderPreview() {
  const project = state.project;
  preview.style.setProperty('--accent', project.accent);
  preview.replaceChildren();
  const nav = element('div', 'site-nav');
  nav.append(element('span', 'site-brand', project.name));
  const links = element('div', 'site-links');
  links.append(element('span', '', 'About'), element('span', '', 'Explore'), element('span', 'site-nav-cta', 'Let’s talk ↗'));
  nav.append(links);
  const hero = element('div', 'site-hero');
  const copy = element('div', 'site-copy');
  copy.append(element('span', 'site-eyebrow', project.eyebrow), element('h2', '', project.headline), element('p', '', project.description), element('span', 'site-cta', `${project.button} ↗`));
  const visual = element('div', 'site-visual');
  visual.append(element('span', 'visual-label', project.visual));
  hero.append(copy, visual);
  const foot = element('div', 'site-foot');
  foot.append(element('span', '', 'THOUGHTFULLY MADE, JUST FOR YOU'), element('span', '', '✳'));
  preview.append(nav, hero, foot);
  document.querySelector('#project-name').textContent = project.name || 'Untitled project';
  const slug = (project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-project').slice(0, 35);
  document.querySelector('#preview-address').textContent = `${slug}.lovable.app`;
  for (const field of ['name', 'headline', 'description', 'button', 'accent']) customizeForm.elements[field].value = project[field];
}
function applyPrompt(text) {
  const lower = text.toLowerCase();
  const kind = /coffee|café|cafe/.test(lower) ? 'coffee' : /portfolio|photograph/.test(lower) ? 'portfolio' : /ecommerce|e-commerce|online store|shop/.test(lower) ? 'ecommerce' : /blog|journal/.test(lower) ? 'blog' : /saas|dashboard|habit|app/.test(lower) ? 'saas' : null;
  const changes = [];
  if (kind) {
    state.project = { ...templates[kind] };
    changes.push(`${kind === 'saas' ? 'SaaS' : kind} layout`);
  }
  const color = Object.keys(colors).find((name) => new RegExp(`\\b${name}\\b`, 'i').test(text));
  if (color) { state.project.accent = colors[color]; changes.push(`${color} accent`); }
  const fields = { headline: 'headline', description: 'description', name: 'name', button: 'button' };
  for (const [label, field] of Object.entries(fields)) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*(.+)`, 'i'));
    if (match) { state.project[field] = match[1].trim().slice(0, field === 'description' ? 180 : field === 'headline' ? 80 : field === 'name' ? 40 : 30); changes.push(label); }
  }
  state.messages.push({ role: 'user', text }, { role: 'assistant', text: changes.length ? `Updated your ${changes.join(' and ')}. You can fine-tune every detail in Customize.` : 'This demo can switch layouts for a coffee shop, store, blog, portfolio, or SaaS app; change the accent color; or update text with “headline: your text”. Try one of those or open Customize.' });
  state.messages = state.messages.slice(-30);
  renderConversation(); renderPreview(); save();
}
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && saved.project && Array.isArray(saved.messages)) state = { project: { ...templates.starter, ...saved.project }, messages: saved.messages.slice(-30) };
} catch { /* Start fresh if storage is unavailable or invalid. */ }
const params = new URLSearchParams(location.search);
const initialTemplate = params.get('template');
const initialPrompt = params.get('prompt');
if (initialTemplate && Object.hasOwn(templates, initialTemplate)) {
  state = { project: { ...templates[initialTemplate] }, messages: [{ role: 'assistant', text: `Your ${initialTemplate} starting point is ready. Use Customize to make it yours.` }] };
  save();
}
renderConversation(); renderPreview();
if (initialPrompt) applyPrompt(initialPrompt.slice(0, 1000));
if (initialTemplate || initialPrompt) history.replaceState(null, '', location.pathname);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  if (!text) { promptInput.focus(); return; }
  applyPrompt(text.slice(0, 1000));
  promptInput.value = '';
});
document.querySelectorAll('[data-suggestion]').forEach((button) => button.addEventListener('click', () => { promptInput.value = button.dataset.suggestion; promptInput.focus(); }));
customizeForm.addEventListener('input', (event) => {
  const field = event.target.name;
  if (!['name', 'headline', 'description', 'button', 'accent'].includes(field)) return;
  state.project[field] = event.target.value;
  // Update the preview without resetting the field currently being edited.
  const selectionStart = event.target.selectionStart;
  const selectionEnd = event.target.selectionEnd;
  renderPreview();
  if (selectionStart !== null && event.target.type !== 'color') event.target.setSelectionRange(selectionStart, selectionEnd);
  save();
});
function setCustomize(open) { customizePanel.hidden = !open; customizeToggle.setAttribute('aria-expanded', String(open)); }
customizeToggle.addEventListener('click', () => setCustomize(customizePanel.hidden));
document.querySelector('#close-customize').addEventListener('click', () => { setCustomize(false); customizeToggle.focus(); });
document.querySelectorAll('[data-device]').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('#browser-frame').classList.toggle('mobile', button.dataset.device === 'mobile');
  document.querySelectorAll('[data-device]').forEach((item) => { const selected = item === button; item.classList.toggle('active', selected); item.setAttribute('aria-pressed', String(selected)); });
}));
document.querySelector('#new-project').addEventListener('click', () => {
  state = { project: { ...templates.starter }, messages: [] }; renderConversation(); renderPreview(); save(); setCustomize(false);
});
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
document.querySelector('#download').addEventListener('click', () => {
  const p = state.project;
  const safe = Object.fromEntries(Object.entries(p).map(([key, value]) => [key, escapeHtml(value)]));
  const accent = /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#718b78';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe.name}</title><style>*{box-sizing:border-box}body{margin:0;background:#fdfcf8;color:#202421;font-family:Arial,sans-serif}nav{display:flex;justify-content:space-between;align-items:center;padding:28px 7%}nav strong{font-size:20px}nav a{color:inherit;text-decoration:none}main{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:7%;padding:70px 7%}small{color:${accent};letter-spacing:.14em;font-weight:bold}h1{font-size:clamp(38px,5vw,68px);letter-spacing:-.05em;line-height:1.05}p{color:#687068;line-height:1.7;max-width:420px}.button{display:inline-block;background:#202020;color:white;padding:14px 20px;border-radius:5px;text-decoration:none}.visual{aspect-ratio:1;background:${accent};border-radius:8px;display:grid;place-items:center;color:#ffffffaa;font-size:100px}footer{border-top:1px solid #eee;margin:0 7%;padding:25px 0;color:#777;font-size:12px}@media(max-width:650px){main{grid-template-columns:1fr;padding-top:30px}.visual{aspect-ratio:1.5}}</style></head><body><nav><strong>${safe.name}</strong><a href="#about">About ↗</a></nav><main><div><small>${safe.eyebrow}</small><h1>${safe.headline}</h1><p>${safe.description}</p><a class="button" href="#about">${safe.button} ↗</a></div><div class="visual" aria-hidden="true">✳</div></main><footer id="about">${safe.visual}</footer></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a'); link.href = url; link.download = 'lovable-project.html'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
