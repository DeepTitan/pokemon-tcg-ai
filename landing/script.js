const accessGate = document.getElementById('access-gate');
const accessForm = document.getElementById('access-form');
const accessPassword = document.getElementById('access-password');
const accessError = document.getElementById('access-error');
const page = document.querySelector('main');
const accessHash = 'efb3c41ec1b113f5fecf08e303f6674293f34f2ae607eb8be0b0d268e4f7d458';

const unlockPage = () => {
  accessGate.hidden = true;
  page.removeAttribute('inert');
  document.documentElement.classList.remove('is-locked');
};

const hashPassword = async (value) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

if (sessionStorage.getItem('trace-access') === accessHash) {
  unlockPage();
} else {
  accessPassword.focus();
}

accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submittedHash = await hashPassword(accessPassword.value);

  if (submittedHash === accessHash) {
    sessionStorage.setItem('trace-access', accessHash);
    unlockPage();
    return;
  }

  accessError.hidden = false;
  accessPassword.value = '';
  accessPassword.focus();
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
