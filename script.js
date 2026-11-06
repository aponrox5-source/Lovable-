const promptForm = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt');

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    promptInput.value = button.dataset.prompt;
    promptInput.focus();
  });
});

promptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const destination = new URL('builder.html', window.location.href);
  const prompt = promptInput.value.trim();
  if (prompt) destination.searchParams.set('prompt', prompt);
  window.location.href = destination.toString();
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((filter) => {
      const selected = filter === button;
      filter.classList.toggle('active', selected);
      filter.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-category]').forEach((project) => {
      project.hidden = button.dataset.filter !== 'all' && project.dataset.category !== button.dataset.filter;
    });
  });
});
