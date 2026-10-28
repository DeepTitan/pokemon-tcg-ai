import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
function page(query = '', result = { url: 'https://checkout.stripe.com/c/pay/cs_test_desktop' }, fail = false) {
  const requests = [], redirects = [], elements = new Map(), classes = new Set();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '', replaceChildren() {}, append() {}, scrollIntoView() {}, focus() {}, setAttribute(k,v) { this[k]=v; } });
    return elements.get(id);
  };
  let pending;
  const makeButton = (dataset) => ({ dataset, disabled: false, textContent: 'Get Pro',
    addEventListener(_event, callback) { this.callback = callback; },
    setAttribute(k,v) { this[k]=v; },
    click() { pending = this.callback(); return pending; } });
  const pro = makeButton({ plan: 'trace' });
  const controls = ['month', 'year'].map(billingInterval => makeButton({ billingInterval }));
  const location = { href: `https://victoryroad.app/trace${query}`, assign(url) { redirects.push(url); } };
  const history = { state: null, replaceState(_s,_t,url) { location.href = new URL(url,location.href).href; } };
  const context = { URL, Date, location, history,
    document: { getElementById: element, querySelector: element,
      querySelectorAll: selector => selector === '[data-plan]' ? [pro] : controls,
      createElement: () => element('link'), body: { classList: { add: value=>classes.add(value), remove: value=>classes.delete(value) } } },
    navigator: { locks: { request: async (_name, callback) => callback() } },
    fetch: async (url, options) => { requests.push({url,body:JSON.parse(options.body)}); const prepare=url.endsWith('/prepare');
      return { ok: prepare || !fail, json: async () => prepare ? {ready:true} : result }; },
  };
  vm.runInNewContext(script,context);
  return { requests, redirects, pro, controls, location, classes, element, done:()=>pending, retry:()=>{fail=false;return pro.click();} };
}
for (const interval of ['month','year']) test(`desktop ${interval} choice goes directly to the matching Trace checkout`, async () => {
  const p=page(`?checkout=trace&billingInterval=${interval}#plans`);
  await p.done();
  assert.deepEqual(p.requests.map(x=>x.url), ['/trace/api/checkout/prepare','/trace/api/checkout/guest']);
  assert.deepEqual(p.requests[1].body, {plan:'trace',billingInterval:interval});
  assert.equal(p.controls.find(x=>x.dataset.billingInterval===interval)['aria-pressed'],'true');
  assert.deepEqual(p.redirects,['https://checkout.stripe.com/c/pay/cs_test_desktop']);
  assert.equal(p.location.href,'https://victoryroad.app/trace#plans');
  assert.match(p.element('trace-checkout-price').textContent,interval==='year'?/49\.99 \/ year/:/4\.99 \/ month/);
});
test('ordinary visits and invalid desktop choices never start checkout',()=>{
  for(const query of ['', '?checkout=trace', '?checkout=trace&billingInterval=week', '?checkout=supporter&billingInterval=year']) {
    const p=page(query);assert.equal(p.requests.length,0);assert.equal(p.redirects.length,0);
  }
});
test('repeated clicks do not start parallel checkout requests',async()=>{
  const p=page('?checkout=trace&billingInterval=year'); const pending=p.done();
  await p.pro.click();await pending;assert.equal(p.requests.filter(x=>x.url.endsWith('/guest')).length,1);
});
test('failed handoff returns to the chosen plan and permits retry',async()=>{
  const p=page('?checkout=trace&billingInterval=year',{error:'Try again.'},true);
  await p.done();assert.equal(p.element('trace-checkout-handoff').hidden,true);assert.equal(p.classes.has('checkout-handoff'),false);
  assert.equal(p.element('checkout-message').hidden,false);assert.equal(p.pro.disabled,false);
  assert.equal(p.element('pro-details').open,true);
  await p.retry();assert.equal(p.requests.at(-1).body.billingInterval,'year');
});
test('an existing member is sent to their account instead of another checkout',async()=>{
  const p=page('?checkout=trace&billingInterval=month',{accountRequired:true});await p.done();
  assert.deepEqual(p.redirects,['/trace/account']);
});
test('handoff rejects untrusted billing destinations',async()=>{
  const p=page('?checkout=trace&billingInterval=month',{url:'https://checkout.stripe.com.evil.test/c/pay/anything'});await p.done();
  assert.equal(p.redirects.length,0);assert.equal(p.element('trace-checkout-handoff').hidden,true);
});

test('legacy plan links reveal Pro without starting a checkout',()=>{
  const p=page('#plans');assert.equal(p.element('pro-details').open,true);assert.equal(p.requests.length,0);
});
