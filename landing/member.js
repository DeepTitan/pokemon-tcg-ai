const root = document.getElementById('account-root');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const planNames = { trace: 'Trace', supporter: 'Supporters Club' };
let email = '';
let renderVersion = 0;
let settling = 0;

function context() {
  const params = new URLSearchParams(location.search);
  const plan = ['trace', 'supporter'].includes(params.get('plan')) ? params.get('plan') : null;
  const code = (params.get('userCode') || params.get('code') || '').replace(/[\s-]/g, '').toUpperCase();
  const userCode = /^[A-Z2-7]{10}$/.test(code) ? code : null;
  const download = ['mac', 'windows'].includes(params.get('download')) ? params.get('download') : null;
  const setup = params.get('setup') === 'payment' ? 'payment' : null;
  return { plan, userCode, download, setup };
}
function route(name, extra = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...context(), ...extra })) if (value) params.set(key, value);
  return `/trace/${name}${params.size ? `?${params}` : ''}`;
}
function navigate(name, extra) { history.pushState({}, '', route(name, extra)); void render(); }
function viewName() {
  const name = location.pathname.split('/').filter(Boolean).at(-1);
  return ['login', 'signup', 'confirm', 'recover', 'reset', 'connect'].includes(name) ? name : 'account';
}
function notice(message, error = false) {
  const target = document.getElementById('message');
  if (!target) return;
  target.textContent = message;
  target.className = `message ${error ? 'error' : 'info'}`;
  target.hidden = !message;
  target.setAttribute('role', error ? 'alert' : 'status');
  if (message) target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
function mount(markup, title) {
  document.title = `${title} — Trace`;
  root.innerHTML = markup;
  root.setAttribute('aria-busy', 'false');
  window.scrollTo({ top: 0, behavior: 'instant' });
  root.querySelectorAll('[data-route]').forEach((link) => link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState({}, '', link.href);
    void render();
  }));
}
async function api(action, data) {
  const response = await fetch(`/trace/api/${action}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || 'Something went wrong. Please try again.');
    error.status = response.status; error.code = body.code;
    throw error;
  }
  return body;
}
async function submitForm(form, label, work) {
  if (form.getAttribute('aria-busy') === 'true') return;
  const button = form.querySelector('[type="submit"]');
  const previous = button.textContent;
  form.setAttribute('aria-busy', 'true'); button.disabled = true; button.textContent = label;
  notice('');
  try { await work(new FormData(form)); }
  catch (error) { notice(error.message || 'Please try again.', true); }
  finally { form.removeAttribute('aria-busy'); button.disabled = false; button.textContent = previous; }
}
const emailField = () => `<label class="form-field">Email<input name="email" type="email" autocomplete="email" maxlength="254" value="${esc(email)}" required /></label>`;
const passwordField = (fresh) => `<label class="form-field">Password<input name="password" type="password" autocomplete="${fresh ? 'new-password' : 'current-password'}" ${fresh ? 'minlength="12"' : ''} maxlength="128" required ${fresh ? 'aria-describedby="password-help"' : ''} />${fresh ? '<small id="password-help">12–128 characters. Include uppercase and lowercase letters, a number, and a symbol.</small>' : ''}</label>`;
const codeField = () => '<label class="form-field">Email code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" minlength="6" maxlength="8" required /></label>';
const messageSlot = () => '<p id="message" class="message" role="status" hidden></p>';
function authCard(title, intro, fields, button, links, extra = '') {
  mount(`<section class="auth-card"><h1>${title}</h1><p class="intro">${intro}</p>${messageSlot()}<form id="auth-form">${fields}<button class="button primary" type="submit">${button}</button></form>${extra}<div class="form-links">${links}</div></section>`, title);
  return document.getElementById('auth-form');
}
const link = (name, label) => `<a data-route href="${esc(route(name))}">${label}</a>`;
function renderAuth(name) {
  if (name === 'signup') {
    const { plan, setup } = context();
    const intro = setup ? 'Use the same email you entered at Stripe checkout. Then we’ll connect your membership to Trace.' : plan ? `Create your Trace account. You can manage ${planNames[plan]} here.` : 'Create an account to download Trace and manage your membership.';
    const form = authCard('Get started.', intro, emailField() + passwordField(true), 'Create account', link('login', 'Already have an account? Sign in'));
    form.addEventListener('submit', (event) => { event.preventDefault(); void submitForm(form, 'Creating account…', async (data) => {
      email = data.get('email').trim();
      await api('auth/signup', { email, password: data.get('password') });
      navigate('confirm');
      notice('Check your inbox for a confirmation code.');
    }); });
  } else if (name === 'confirm') {
    const form = authCard('Check your email.', 'Enter the code from your confirmation email to finish creating your account.', emailField() + codeField(), 'Confirm email', `${link('login', 'Back to sign in')}${link('signup', 'Use a different email')}`, '<button class="text-button" id="resend-code" type="button">Send another code</button>');
    document.getElementById('resend-code').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const address = form.querySelector('[name="email"]');
      if (!address.reportValidity()) return;
      button.disabled = true; button.textContent = 'Sending…'; notice('');
      try { email = address.value.trim(); await api('auth/resend', { email }); notice('If your account needs confirmation, a new code is on its way.'); }
      catch (error) { notice(error.message, true); }
      finally { button.disabled = false; button.textContent = 'Send another code'; }
    });
    form.addEventListener('submit', (event) => { event.preventDefault(); void submitForm(form, 'Confirming…', async (data) => {
      email = data.get('email').trim(); await api('auth/confirm', { email, code: data.get('code') });
      navigate('login'); notice('Email confirmed. Sign in to continue.');
    }); });
  } else if (name === 'recover') {
    const form = authCard('Reset your password.', 'Enter your email. If it matches an account, we’ll send a reset code.', emailField(), 'Send reset code', link('login', 'Back to sign in'));
    form.addEventListener('submit', (event) => { event.preventDefault(); void submitForm(form, 'Sending…', async (data) => {
      email = data.get('email').trim(); await api('auth/recover', { email });
      navigate('reset'); notice('If this email has an account, a reset code is on its way.');
    }); });
  } else if (name === 'reset') {
    const form = authCard('Choose a new password.', 'Enter the code from your email and your new password.', emailField() + codeField() + passwordField(true), 'Save password', `${link('recover', 'Send another reset code')}${link('login', 'Back to sign in')}`);
    form.addEventListener('submit', (event) => { event.preventDefault(); void submitForm(form, 'Saving…', async (data) => {
      email = data.get('email').trim(); await api('auth/reset', { email, code: data.get('code'), password: data.get('password') });
      navigate('login'); notice('Password saved. Sign in with your new password.');
    }); });
  } else {
    const form = authCard('Welcome back.', context().setup ? 'Sign in with the same email you used at Stripe checkout.' : context().userCode ? 'Sign in to link your Trace app.' : 'Sign in to download Trace and manage your membership.', emailField() + passwordField(false), 'Sign in', `${link('recover', 'Forgot password?')}${link('signup', 'Create account')}`, `<p class="form-links">${link('confirm', 'Have an email confirmation code?')}</p>`);
    form.addEventListener('submit', (event) => { event.preventDefault(); void submitForm(form, 'Signing in…', async (data) => {
      email = data.get('email').trim();
      try { await api('auth/login', { email, password: data.get('password') }); }
      catch (error) { if (error.code === 'email_not_verified') { navigate('confirm'); notice(error.message, true); return; } throw error; }
      navigate(context().userCode ? 'connect' : 'account');
    }); });
  }
}
function planCard(plan) {
  const supporter = plan === 'supporter';
  const price = supporter ? '39.99' : '14.99';
  return `<article class="plan ${supporter ? 'supporter' : ''} ${context().plan === plan ? 'plan-selected' : ''}"><h3>${planNames[plan]}</h3><p class="price">$${price}<span>/ month</span></p><ul class="benefits">${supporter ? '<li>Everything in Trace</li><li>Opponent decklists after the match ends</li>' : '<li>Access to the Trace desktop app</li><li>Record and review your matches</li>'}</ul>${supporter ? '<p class="plan-note">Locked during play. Unlocks only when Trace records the end of a match.</p>' : ''}<button type="button" class="button ${supporter ? 'primary' : 'secondary'}" data-checkout="${plan}">Choose ${planNames[plan]} <span aria-hidden="true">→</span></button></article>`;
}
function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
async function billing(action, button, data = {}) {
  if (button.disabled) return;
  const previous = button.textContent; button.disabled = true; button.textContent = 'Opening secure billing…'; notice('');
  try {
    let result;
    if (action.startsWith('checkout')) {
      if (!navigator.locks?.request) throw new Error('Secure checkout needs an up-to-date browser. Please update your browser and try again.');
      result = await navigator.locks.request('trace-checkout', () => api(action, data));
    } else result = await api(action, data);
    if (result.accountRequired === true) { navigate('account'); return; }
    const url = new URL(result.url);
    const host = action.startsWith('checkout') ? 'https://checkout.stripe.com' : 'https://billing.stripe.com';
    if (url.origin !== host || url.username || url.password) throw new Error('We could not open secure billing. Please try again.');
    location.assign(url.href);
  } catch (error) {
    notice(error.message, true); button.disabled = false; button.textContent = previous;
    if (error.code === 'subscription_exists' && !document.getElementById('manage-billing')) {
      const manage = document.createElement('button');
      manage.id = 'manage-billing'; manage.type = 'button'; manage.className = 'button refresh-button'; manage.textContent = 'Manage billing';
      manage.addEventListener('click', () => void billing('portal', manage));
      document.getElementById('message').after(manage);
    }
  }
}
function renderAccount(account) {
  const active = account.traceAccess === true;
  const admin = account.admin === true;
  const memberName = admin ? 'Owner access' : planNames[account.plan] || 'Choose your plan';
  const until = dateLabel(account.expiresAt);
  const status = admin ? 'Enabled' : active ? account.cancelAtPeriodEnd ? 'Ends ' + until : 'Active' : 'No active plan';
  const canceled = new URLSearchParams(location.search).get('checkout') === 'cancel';
  const success = new URLSearchParams(location.search).get('checkout') === 'success';
  const billingText = admin ? 'Your owner access is enabled. No subscription is needed.' : active ? `${account.plan === 'supporter' ? '$39.99' : '$14.99'} USD / month.${until ? ` ${account.cancelAtPeriodEnd ? 'Access ends' : 'Next billing date:'} ${until}.` : ''}` : 'Choose a monthly plan to use Trace. Cancel anytime.';
  mount(`<div class="account-heading"><div><h1>My account</h1><p class="account-email">${esc(account.email)}</p></div><button class="text-button" id="sign-out" type="button">Sign out</button></div>${messageSlot()}
    <section class="account-panel"><div class="panel-top"><h2>${memberName}</h2><span class="status-label ${active ? '' : 'paused'}">${esc(status)}</span></div><p>${billingText}</p>
      ${active ? `<p class="supporter-lock">${account.opponentDecklists ? 'Opponent decklists are included. They unlock after Trace records the end of the match.' : 'Opponent decklists are available with Supporters Club, after the match ends.'}</p>` : ''}
      ${!admin && account.plan !== 'none' ? '<button type="button" class="button" id="manage-billing">Manage billing</button>' : ''}
    </section>
    ${active ? `<section class="account-panel"><h2>Get Trace</h2><p>Download the app, then select Link account in Trace to connect this membership.</p><div class="account-actions"><a class="button secondary" href="/trace/access?action=download&amp;platform=mac"><img src="/trace-assets/apple.svg" alt="" />Download for macOS</a><a class="button secondary" href="/trace/access?action=download&amp;platform=windows"><img src="/trace-assets/windows.svg" alt="" />Download for Windows</a></div><p class="small-note">macOS Apple silicon · Windows 64-bit</p><a class="back-link" data-route href="${esc(route('connect'))}">Have a code from Trace? Link the app</a></section>` : `<div class="plans">${planCard('trace')}${planCard('supporter')}</div><p class="existing-account">Prices in USD. Billed monthly. Cancel anytime.</p><button class="text-button refresh-button" id="refresh-account" type="button">Refresh membership</button>`}
    ${!active && account.plan !== 'none' ? '<p class="small-note">If a payment needs attention, open Manage billing to update it.</p>' : ''}`, 'My account');
  document.getElementById('sign-out').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try { await api('auth/logout', {}); email = ''; navigate('login', { userCode: null, plan: null, download: null }); }
    catch (error) { notice(error.message, true); document.getElementById('sign-out').disabled = false; }
  });
  document.querySelectorAll('[data-checkout]').forEach((button) => button.addEventListener('click', () => void billing('checkout', button, { plan: button.dataset.checkout })));
  document.getElementById('manage-billing')?.addEventListener('click', (event) => void billing('portal', event.currentTarget));
  document.getElementById('refresh-account')?.addEventListener('click', () => void render());
  if (canceled) notice('Checkout canceled. Your plan has not changed.');
  if (success && active) notice('Your membership is ready. Download Trace and link your account.');
  if (success && !active) {
    notice('Confirming your payment. This can take a moment. If you’ve paid, wait here before starting another checkout.');
    document.querySelectorAll('[data-checkout]').forEach((button) => { button.disabled = true; });
    if (settling < 6) { settling += 1; const version = renderVersion; setTimeout(() => { if (version === renderVersion) void render(); }, 3000); }
  }
}
function renderConnect(account) {
  const code = context().userCode;
  mount(`<section class="auth-card"><h1>Link your Trace app.</h1><p class="intro">Connect the app to <strong>${esc(account.email)}</strong>.</p>${messageSlot()}
    <form id="link-form"><label class="form-field">Code shown in Trace<input class="device-code-input" type="text" name="userCode" value="${esc(code ? code.slice(0, 5) + '-' + code.slice(5) : '')}" autocomplete="off" autocapitalize="characters" spellcheck="false" pattern="[A-Za-z2-7\\s\\-]{10,13}" maxlength="13" required /></label>
    <p class="danger-note">Only link an app you opened yourself. Check that this code matches the one in your Trace app.</p>
    <label class="check-row"><input type="checkbox" name="confirm" required /><span>I opened Trace and this is my code.</span></label>
    <button class="button primary" type="submit">Link this app</button></form><a class="back-link" data-route href="${esc(route('account', { userCode: null }))}">Cancel</a></section>`, 'Link your app');
  const form = document.getElementById('link-form');
  form.addEventListener('submit', (event) => { event.preventDefault(); void submitForm(form, 'Linking…', async (data) => {
    if (data.get('confirm') !== 'on') throw new Error('Confirm that this code is from your Trace app.');
    const userCode = data.get('userCode').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-Z2-7]{10}$/.test(userCode)) throw new Error('Enter the 10-character code from Trace.');
    const result = await api('devices/link/approve', { userCode });
    if (!result.linked) throw new Error('We could not link the app. Please try again.');
    history.replaceState({}, '', '/trace/connect');
    mount(`<section class="auth-card"><h1>You’re connected.</h1><p class="intro">Return to Trace. ${account.traceAccess ? 'Your membership is ready to use.' : 'Choose a plan to start using your membership.'}</p><a class="button primary" data-route href="/trace/account">My account</a></section>`, 'App connected');
  }); });
}
function renderPurchase(account, purchase) {
  const plan = planNames[purchase.plan] || 'Trace';
  if (purchase.state === 'paid') {
    const intro = account
      ? `Connect your ${plan} membership to <strong>${esc(account.email)}</strong>. This must be the email you used at Stripe checkout.`
      : `Your ${plan} payment is confirmed. Create an account or sign in with the same email you used at checkout.`;
    mount(`<section class="auth-card"><h1>Let’s get you set up.</h1><p class="intro">${intro}</p>${messageSlot()}${account
      ? '<button class="button primary" type="button" id="activate-membership">Activate membership</button><button class="text-button" type="button" id="switch-account">Use a different account</button>'
      : `<div class="claim-actions"><a class="button primary" data-route href="${esc(route('signup', { setup: 'payment' }))}">Create account</a><a class="button" data-route href="${esc(route('login', { setup: 'payment' }))}">Sign in</a></div>`}<p class="small-note">Already paid? There’s no need to check out again.</p></section>`, 'Set up Trace');
    document.getElementById('activate-membership')?.addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Activating…'; notice('');
      try {
        const result = await api('checkout/claim', {});
        if (result.claimed !== true) throw new Error('We could not activate your membership. Please try again.');
        history.replaceState({}, '', '/trace/account?checkout=success');
        await render();
      } catch (error) { notice(error.message, true); button.disabled = false; button.textContent = 'Activate membership'; }
    });
    document.getElementById('switch-account')?.addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { await api('auth/logout', {}); email = ''; navigate('login', { setup: 'payment' }); }
      catch (error) { notice(error.message, true); button.disabled = false; }
    });
    return;
  }
  if (purchase.state === 'open' || (purchase.state === 'expired' && purchase.plan !== 'none')) {
    mount(`<section class="auth-card"><h1>${purchase.state === 'expired' ? 'Your checkout expired.' : 'Finish checkout.'}</h1><p class="intro">${purchase.state === 'expired' ? `This ${plan} checkout was not completed. You can open a new checkout with Stripe.` : `Your ${plan} checkout is still open. Continue with Stripe to finish, or return to Trace.`}</p>${messageSlot()}<button class="button primary" type="button" id="resume-checkout">Continue to Stripe</button><a class="back-link" href="/trace">Back to Trace</a><p class="small-note">If you already paid, <button class="text-button" id="refresh-purchase" type="button">check your payment</button> before trying again.</p></section>`, 'Finish checkout');
    document.getElementById('resume-checkout').addEventListener('click', (event) => void billing('checkout/guest', event.currentTarget, { plan: purchase.plan }));
    document.getElementById('refresh-purchase').addEventListener('click', () => void render());
    return;
  }
  if (purchase.reason === 'purchase_not_active') {
    mount(`<section class="auth-card"><h1>Your membership needs attention.</h1><p class="intro">We found your purchase, but its subscription is no longer active. Please check your billing or contact support before paying again.</p>${messageSlot()}${account && account.plan !== 'none' && !account.admin ? '<button class="button primary" type="button" id="purchase-billing">Manage billing</button>' : `<a class="button primary" data-route href="${esc(route('login', { setup: 'payment' }))}">Sign in with your checkout email</a>`}<a class="back-link" href="/discord">Get help with my purchase</a></section>`, 'Membership help');
    document.getElementById('purchase-billing')?.addEventListener('click', (event) => void billing('portal', event.currentTarget));
    return;
  }
  if (purchase.state === 'processing') {
    mount(`<section class="auth-card"><h1>Confirming your payment.</h1><p class="intro">This can take a moment. Keep this page open, and please don’t pay again.</p>${messageSlot()}<button class="button primary" type="button" id="check-purchase">Check again</button><a class="back-link" href="/discord">Need help? Contact support</a></section>`, 'Confirming payment');
    document.getElementById('check-purchase').addEventListener('click', () => void render());
    if (settling < 6) { settling += 1; const version = renderVersion; setTimeout(() => { if (version === renderVersion) void render(); }, 3000); }
    return;
  }
  // A URL, cookie, or old paid checkout is never enough to grant access.
  mount(`<section class="auth-card"><h1>Finish setting up Trace.</h1><p class="intro">${purchase.state === 'claimed' ? 'This purchase is already connected to an account. Sign in with the email you used at checkout.' : 'We couldn’t find a completed purchase in this browser. If you already paid, use the same browser and email you used at checkout. Please don’t pay again.'}</p>${messageSlot()}<div class="claim-actions"><a class="button primary" data-route href="${esc(route('login', { setup: 'payment' }))}">Sign in</a><a class="button" href="/discord">Get help with my purchase</a></div><a class="back-link" href="/trace">Back to Trace</a></section>`, 'Set up Trace');
}
async function render() {
  const version = ++renderVersion;
  const name = viewName();
  if (!['account', 'connect'].includes(name)) { renderAuth(name); return; }
  root.setAttribute('aria-busy', 'true');
  root.innerHTML = '<p class="loading">Loading your account…</p>';
  try {
    let account = null;
    try { account = await api('account'); } catch (error) { if (error.status !== 401) throw error; }
    if (version !== renderVersion) return;
    let purchase = { state: 'none', plan: 'none', expiresAt: null };
    if (name === 'account') {
      try { purchase = await api('checkout/status', {}); }
      catch (error) { if (!account?.traceAccess) throw error; }
      if (version !== renderVersion) return;
      const returned = new URLSearchParams(location.search).get('checkout') === 'success' || context().setup === 'payment';
      if (['paid', 'processing'].includes(purchase.state) || (!account?.traceAccess && ['open', 'expired', 'claimed'].includes(purchase.state)) || (!account?.traceAccess && returned && ['none', 'expired', 'claimed'].includes(purchase.state))) {
        renderPurchase(account, purchase); return;
      }
    }
    if (!account) { history.replaceState({}, '', route('login')); renderAuth('login'); return; }
    email = account.email;
    if (name === 'connect') renderConnect(account); else renderAccount(account);
  } catch (error) {
    if (version !== renderVersion) return;
    mount(`<section class="auth-card"><h1>One moment.</h1><p class="intro">We couldn’t load your membership. If you already paid, please don’t pay again.</p>${messageSlot()}<button class="button primary" id="retry" type="button">Try again</button><a class="back-link" href="/discord">Contact support</a><a class="back-link" href="/trace">Back to Trace</a></section>`, 'My account');
    notice(error.message, true);
    document.getElementById('retry').addEventListener('click', () => void render());
  }
}
window.addEventListener('popstate', () => void render());
void render();
