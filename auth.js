let countries = [], ascending = true, signup = true;
const $ = s => document.querySelector(s);
async function request(url, body) { const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data; }
function renderCountries() {
  const selected = $('#country').value, query = $('#country-search').value.toLowerCase();
  const list = countries.filter(c => `${c.name} +${c.callingCode}`.toLowerCase().includes(query)).sort((a, b) => ascending ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = list.length ? 'Choose your country' : 'No countries match';
  $('#country').replaceChildren(placeholder, ...list.map(c => { const option = document.createElement('option'); option.value = c.code; option.textContent = `${c.name} +${c.callingCode}`; return option; }));
  $('#country').value = list.some(c => c.code === selected) ? selected : '';
}
$('#country-search').addEventListener('input', renderCountries);
$('#sort').addEventListener('click', () => { ascending = !ascending; $('#sort').textContent = ascending ? 'A–Z ↓' : 'Z–A ↑'; renderCountries(); });
function mode(value) { signup = value; $('#signup-fields').hidden = !signup; $('#country').required = signup; $('#phone').required = signup; $('#password').autocomplete = signup ? 'new-password' : 'current-password'; $('#submit').textContent = signup ? 'Create account' : 'Sign in'; $('#signup-tab').classList.toggle('active', signup); $('#login-tab').classList.toggle('active', !signup); $('#status').textContent = ''; }
$('#signup-tab').addEventListener('click', () => mode(true)); $('#login-tab').addEventListener('click', () => mode(false));
$('#account-form').addEventListener('submit', async event => { event.preventDefault(); $('#submit').disabled = true; $('#status').textContent = 'Connecting…'; try { await request(signup ? '/api/register' : '/api/login', { email: $('#email').value, password: $('#password').value, country: $('#country').value, phone: $('#phone').value }); location.href = '/workspace.html'; } catch (error) { $('#status').textContent = error.message; } finally { $('#submit').disabled = false; } });
request('/api/countries').then(data => { countries = data; renderCountries(); }).catch(error => { $('#status').textContent = error.message; });
