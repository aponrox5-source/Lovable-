const promptForm = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt');

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    promptInput.value = button.dataset.prompt;
    promptInput.setCustomValidity('');
    promptInput.focus();
  });
});

promptInput.addEventListener('input', () => promptInput.setCustomValidity(''));

promptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const destination = new URL('workspace.html', window.location.href);
  const prompt = promptInput.value.trim();
  try { sessionStorage.setItem('darker-draft', prompt); } catch { promptInput.setCustomValidity('Allow browser storage to carry your idea into the workspace.'); promptInput.reportValidity(); return; }
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

// Treat each template as a fixed canvas, like a screenshot, instead of a tiny page.
const previewObserver = new ResizeObserver((entries) => {
  entries.forEach(({ target, contentRect }) => {
    target.style.setProperty('--preview-scale', String(contentRect.width * 0.88 / 480));
  });
});
document.querySelectorAll('.project-image').forEach((preview) => previewObserver.observe(preview));
