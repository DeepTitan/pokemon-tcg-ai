const platform = navigator.userAgentData?.platform || navigator.platform || '';
const normalizedPlatform = platform.toLowerCase();
const detectedPlatform = normalizedPlatform.includes('mac')
  ? 'mac'
  : normalizedPlatform.includes('win')
    ? 'windows'
    : null;

if (detectedPlatform) {
  document.querySelector(`[data-platform-card="${detectedPlatform}"]`)?.classList.add('detected');
}

document.getElementById('year').textContent = new Date().getFullYear();
