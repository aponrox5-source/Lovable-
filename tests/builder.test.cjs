const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../builder.js'), 'utf8');

class Node {
  children = [];
  listeners = {};
  style = { setProperty() {} };
  classList = { toggle() {} };
  append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
  replaceChildren() { this.children = []; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  setAttribute() {}
  focus() {}
}
function workspace({ saved = null, search = '', confirm = true } = {}) {
  const nodes = new Map();
  const select = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  select('#customize-form').elements = Object.fromEntries(['name', 'headline', 'description', 'button', 'accent'].map(key => [key, {}]));
  let storage = saved && JSON.stringify(saved);
  let failSaving = false;
  let confirmations = 0;
  let clearedUrl = false;
  const context = vm.createContext({
    document: { querySelector: select, querySelectorAll: () => [], createElement: () => new Node() },
    localStorage: { getItem: () => storage, setItem: (_, value) => { if (failSaving) throw new Error('Storage unavailable'); storage = value; } },
    location: { search, pathname: '/builder.html' },
    history: { replaceState() { clearedUrl = true; } },
    window: { confirm() { confirmations++; return confirm; } }, URLSearchParams
  });
  vm.runInContext(source, context);
  return { run: text => vm.runInContext(text, context), nodes, setSaveFailure: value => { failSaving = value; }, saved: () => storage, confirmations: () => confirmations, cleared: () => clearedUrl };
}
test('layout words use boundaries and preserve intended variants', () => {
  for (const text of ['Happy days', 'A workshop for makers']) {
    const app = workspace(); app.run(`applyPrompt(${JSON.stringify(text)})`);
    assert.equal(app.run('state.project.name'), 'My lovely project');
  }
  for (const [text, name] of [['Build an application', 'Flowly'], ['Build a shopping site', 'Forme Studio'], ['Build a blogging site', 'The Daily Note'], ['A café site', 'The Daily Brew']]) {
    const app = workspace(); app.run(`applyPrompt(${JSON.stringify(text)})`);
    assert.equal(app.run('state.project.name'), name);
  }
});
test('field values cannot select templates or colors, mixed instructions still work', () => {
  const app = workspace();
  app.run('applyPrompt("headline: My blue coffee shop\\ndescription: Happy blogging")');
  assert.equal(app.run('state.project.name'), 'My lovely project');
  assert.equal(app.run('state.project.accent'), '#718b78');
  app.run('applyPrompt("make it purple\\nheadline: Green coffee shop")');
  assert.equal(app.run('state.project.accent'), '#827ac1');
  assert.equal(app.run('state.project.headline'), 'Green coffee shop');
  const multiline = workspace();
  multiline.run(`applyPrompt(${JSON.stringify('description:\nmy blue coffee shop')})`);
  assert.equal(multiline.run('state.project.description'), 'my blue coffee shop');
  assert.equal(multiline.run('state.project.name'), 'My lovely project');
  assert.equal(multiline.run('state.project.accent'), '#718b78');
});
test('explicit layout replacement asks before discarding edited fields', () => {
  for (const confirm of [false, true]) {
    const app = workspace({ confirm });
    app.run('applyPrompt("headline: Personal headline")');
    app.run('applyPrompt("Build a blog")');
    assert.equal(app.confirmations(), 1);
    assert.equal(app.run('state.project.headline'), confirm ? 'Good ideas live here.' : 'Personal headline');
  }
});
test('template cancellation preserves storage and URL; acceptance consumes template and prompt', () => {
  const saved = { project: { name: 'Keep me', headline: 'My work' }, messages: [{ role: 'user', text: 'Existing conversation' }] };
  for (const confirm of [false, true]) {
    const app = workspace({ saved, search: '?template=saas&prompt=headline%3A%20New%20headline', confirm });
    assert.equal(app.confirmations(), 0);
    assert.equal(app.nodes.get('#template-decision').hidden, false);
    assert.equal(app.saved(), JSON.stringify(saved));
    assert.equal(app.cleared(), false);
    app.nodes.get(confirm ? '#accept-template' : '#keep-project').listeners.click();
    assert.equal(app.cleared(), confirm);
    if (!confirm) assert.equal(app.saved(), JSON.stringify(saved));
    assert.equal(app.run('state.project.name'), confirm ? 'Flowly' : 'Keep me');
    assert.equal(app.run('state.project.headline'), confirm ? 'New headline' : 'My work');
  }
});
test('conversation appends new nodes, caps history, and resets', () => {
  const app = workspace(); const log = app.nodes.get('#conversation');
  app.run('applyPrompt("headline: First")'); const first = log.children[1]; const welcome = log.children[0];
  app.run('applyPrompt("headline: Second")'); assert.equal(log.children[1], first);
  for (let i = 0; i < 16; i++) app.run('applyPrompt("make it blue")');
  assert.equal(log.children.length, 31); assert.equal(log.children[0], welcome);
  assert.equal(app.run('state.messages.length'), 30);
  app.nodes.get('#new-project').listeners.click();
  assert.equal(log.children.length, 1); assert.equal(app.run('state.messages.length'), 0);
});
test('declining a new project preserves the project, conversation, and saved data', () => {
  const app = workspace({ confirm: false });
  app.run('applyPrompt("headline: My work")');
  const saved = app.saved();
  const log = app.nodes.get('#conversation');
  const messages = [...log.children];
  app.nodes.get('#new-project').listeners.click();
  assert.equal(app.confirmations(), 1);
  assert.equal(app.saved(), saved);
  assert.equal(app.run('state.project.headline'), 'My work');
  assert.equal(app.run('state.messages.length'), 2);
  assert.deepEqual(log.children, messages);
});
test('long prompts survive initial navigation and subsequent submission', () => {
  const text = 'x'.repeat(1200) + '\nheadline: After character 1000';
  const app = workspace({ search: '?prompt=' + encodeURIComponent(text) });
  assert.equal(app.run('state.messages[0].text'), text);
  assert.equal(app.run('state.project.headline'), 'After character 1000');
  const input = app.nodes.get('#builder-prompt'); input.value = text;
  app.nodes.get('#builder-form').listeners.submit({ preventDefault() {} });
  assert.equal(app.run('state.messages[2].text'), text);
  assert.equal(input.value, '');
});

test('both save indicators report storage failure and recovery', () => {
  const app = workspace();
  app.setSaveFailure(true);
  app.run('applyPrompt("headline: Unsaved edit")');
  for (const id of ['#save-status', '#demo-save-status']) {
    assert.equal(app.nodes.get(id).textContent, 'Unable to save on this device');
  }
  assert.equal(app.saved(), null);
  app.setSaveFailure(false);
  app.run('save()');
  for (const id of ['#save-status', '#demo-save-status']) {
    assert.equal(app.nodes.get(id).textContent, 'Saved on this device');
  }
  assert.equal(JSON.parse(app.saved()).project.headline, 'Unsaved edit');
});
