const accessGate = document.getElementById('access-gate');
const accessForm = document.getElementById('access-form');
const accessPassword = document.getElementById('access-password');
const accessError = document.getElementById('access-error');
const page = document.querySelector('main');
const accessSubmit = document.getElementById('access-submit');
const endpoint = '/trace/access';
let submitting = false;

const unlockPage = () => {
  accessGate.hidden = true;
  page.removeAttribute('inert');
  document.documentElement.classList.remove('is-locked');
};

// The server checks a signed HttpOnly cookie. No password hashes or access
// grants live in JavaScript/sessionStorage, and download links are gated too.
const sessionReady = fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
  .then(async (response) => {
    if (!response.ok) throw new Error('Download access is temporarily unavailable. Please refresh to retry.');
    const status = await response.json();
    if (status.unlocked) unlockPage(); else accessPassword.focus();
  })
  .catch((error) => { accessError.textContent = error.message || 'Please refresh and try again.'; accessError.hidden = false; })
  .finally(() => { accessSubmit.disabled = false; accessSubmit.textContent = 'Unlock Trace'; });

accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting) return;
  submitting = true;
  accessSubmit.disabled = true;
  accessSubmit.textContent = 'Unlocking…';
  accessForm.setAttribute('aria-busy', 'true');
  accessError.hidden = true;
  try {
    await sessionReady;
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: accessPassword.value.trim() }) });
    const result = await response.json();
    if (!response.ok || !result.unlocked) throw new Error(result.error || 'Please try again.');
    accessPassword.value = '';
    unlockPage();
    document.querySelector('.download-button.detected, .download-button')?.focus();
  } catch (error) {
    accessError.textContent = error.message || 'Download access is temporarily unavailable. Please retry.';
    accessError.hidden = false;
    accessPassword.focus();
  } finally {
    submitting = false;
    accessSubmit.disabled = false;
    accessSubmit.textContent = 'Unlock Trace';
    accessForm.removeAttribute('aria-busy');
  }
});

const platform = navigator.userAgentData?.platform || navigator.platform || '';
const normalizedPlatform = platform.toLowerCase();
const detectedPlatform = normalizedPlatform.includes('mac')
  ? 'mac'
  : normalizedPlatform.includes('win')
    ? 'windows'
    : null;

if (detectedPlatform) {
  document.querySelector(`[data-download="${detectedPlatform}"]`)?.classList.add('detected');
}

document.getElementById('year').textContent = new Date().getFullYear();
