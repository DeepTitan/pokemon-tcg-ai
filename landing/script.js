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
const billingButtons = [...document.querySelectorAll('[data-billing-interval]')];
let billingInterval = 'month';
function selectBillingInterval(interval) {
  billingInterval = interval === 'year' ? 'year' : 'month';
  billingButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.billingInterval === billingInterval)));
  const yearly = billingInterval === 'year';
  document.querySelector('#pro-price .price-amount').textContent = yearly ? '$49.99' : '$4.99';
  document.querySelector('#pro-price .price-interval').textContent = yearly ? '/ year' : '/ month';
  const disclosure = document.getElementById('billing-disclosure');
  if (disclosure) disclosure.textContent = `Pro: ${yearly ? '$49.99 billed yearly — save $9.89 compared with monthly' : '$4.99 billed monthly'}. Supporters Club: $39.99 billed monthly. Secure checkout with Stripe.`;
}
for (const control of billingButtons) control.addEventListener('click', () => {
  if (!openingCheckout) selectBillingInterval(control.dataset.billingInterval);
});

const message = document.getElementById('checkout-message');
buttons.forEach((button) => button.addEventListener('click', async () => {
  if (openingCheckout) return;
  openingCheckout = true;
  const previous = button.textContent;
  [...buttons, ...billingButtons].forEach((item) => { item.disabled = true; });
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
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: button.dataset.plan, billingInterval: button.dataset.plan === 'trace' ? billingInterval : 'month' }),
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
    const handoff = document.getElementById('trace-checkout-handoff');
    if (handoff && !handoff.hidden) { handoff.hidden = true; document.body.classList.remove('checkout-handoff'); }
    message.textContent = error.message || 'We could not open checkout. Please try again.';
    if (['subscription_exists', 'payment_already_completed', 'purchase_already_claimed'].includes(error.code)) {
      const link = document.createElement('a'); link.href = '/trace/account'; link.textContent = 'Open My account';
      message.append(' ', link);
    }
    message.hidden = false; message.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    [...buttons, ...billingButtons].forEach((item) => { item.disabled = false; }); button.textContent = previous; openingCheckout = false;
  }
}));

// The desktop already collected the plan choice. Continue through the same
// cookie-bound, idempotent checkout used by the website, without another plan form.
const desktopChoice = new URL(location.href).searchParams;
if (desktopChoice.get('checkout') === 'trace' && ['month', 'year'].includes(desktopChoice.get('billingInterval'))) {
  selectBillingInterval(desktopChoice.get('billingInterval'));
  const clean = new URL(location.href);
  clean.searchParams.delete('checkout'); clean.searchParams.delete('billingInterval');
  history.replaceState(history.state, '', clean.pathname + clean.search + clean.hash);
  const handoff = document.getElementById('trace-checkout-handoff');
  if (handoff) {
    document.getElementById('trace-checkout-price').textContent = `Trace Pro · ${billingInterval === 'year' ? '$49.99 / year' : '$4.99 / month'}`;
    handoff.hidden = false; document.body.classList.add('checkout-handoff'); handoff.focus();
  }
  buttons.find(button => button.dataset.plan === 'trace')?.click();
}
