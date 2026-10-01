// Capture a creator link once; checkout waits for the server-only cookie.
const referralCode = new URL(location.href).searchParams.get('ref');
const referralReady = referralCode ? fetch('/trace/api/referrals/start', {
  method: 'POST', credentials: 'same-origin', cache: 'no-store',
  signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: referralCode }),
}).then(async response => {
  const result = await response.json();
  if (!response.ok || !result.recorded) throw new Error('We could not save the creator link. Enter the creator code at checkout.');
  const clean = new URL(location.href); clean.searchParams.delete('ref');
  history.replaceState(history.state, '', clean.pathname + clean.search + clean.hash);
}).catch(() => {
  const notice = document.getElementById('checkout-message');
  notice.textContent = 'Enter your creator code at checkout to make sure they receive credit.';
  notice.hidden = false;
}) : Promise.resolve();
document.getElementById('year').textContent = new Date().getFullYear();
let openingCheckout = false;
const buttons = [...document.querySelectorAll('[data-plan]')];
const message = document.getElementById('checkout-message');
buttons.forEach((button) => button.addEventListener('click', async () => {
  if (openingCheckout) return;
  openingCheckout = true;
  const previous = button.textContent;
  buttons.forEach((item) => { item.disabled = true; });
  button.textContent = 'Opening Stripe…'; message.hidden = true; message.replaceChildren();
  try {
    if (!navigator.locks?.request) throw new Error('Secure checkout needs an up-to-date browser. Please update your browser and try again.');
    await referralReady;
    const result = await navigator.locks.request('trace-checkout', async () => {
      const prepare = await fetch('/trace/api/checkout/prepare', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const prepared = await prepare.json().catch(() => ({}));
      if (!prepare.ok || prepared.ready !== true) throw new Error(prepared.error || 'We could not start checkout. Please try again.');
      const response = await fetch('/trace/api/checkout/guest', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: button.dataset.plan }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || 'We could not open checkout. Please try again.');
        error.code = result.code; throw error;
      }
      return result;
    });
    if (result.accountRequired === true) { location.assign('/trace/account'); return; }
    const url = new URL(result.url);
    if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password || !/^\/(?:c\/)?pay\/[^/]+/.test(url.pathname)) throw new Error('We could not open secure checkout. Please try again.');
    location.assign(url.href);
  } catch (error) {
    message.textContent = error.message || 'We could not open checkout. Please try again.';
    if (['subscription_exists', 'payment_already_completed', 'purchase_already_claimed'].includes(error.code)) {
      const link = document.createElement('a'); link.href = '/trace/account'; link.textContent = 'Open My account';
      message.append(' ', link);
    }
    message.hidden = false; message.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    buttons.forEach((item) => { item.disabled = false; }); button.textContent = previous; openingCheckout = false;
  }
}));
