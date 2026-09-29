import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../training/dashboard.js', import.meta.url), 'utf8');
test('training selector is present before data loads', () => {
 const html = fs.readFileSync(new URL('../training/index.html', import.meta.url), 'utf8');
 assert.match(html, /<select[^>]*id="runSelector"/);
 assert.match(html, /<label[^>]*for="runSelector"/);
});
test('all runners remain selectable across refreshes and fast uses its own steps', () => {
 const nodes = new Map();
 const node = key => { if (!nodes.has(key)) nodes.set(key, {style:{}, children:[], replaceChildren(...children){this.children=children;}}); return nodes.get(key); };
 const context = vm.createContext({document:{getElementById:node, querySelector:node, createElement:()=>({})},
 ResizeObserver:class {observe(){}}, fetch:()=>new Promise(()=>{}), setInterval:()=>{}, console});
 vm.runInContext(source, context);
 const runs = ['strength-standard','strength-fast','original'].map(runId=>({runId,runName:runId, phases:[{id:'phase',offset:323725381}]}));
 context.payload = {defaultRunId:'strength-standard',runs};
 vm.runInContext('render=()=>{}; chooseRun(payload)',context);
 assert.equal(node('runSelector').children.length,3);
 assert.equal(node('runSelector').disabled,false);
 node('runSelector').value='strength-fast'; node('runSelector').onchange();
 assert.equal(vm.runInContext('data.runId',context),'strength-fast');
 assert.equal(vm.runInContext('checkpointSteps({phase:"phase",milestone:80000000})',context),80000000);
 vm.runInContext('chooseRun(payload)',context);
 assert.equal(node('runSelector').value,'strength-fast');
 node('runSelector').value='original'; node('runSelector').onchange();
 assert.equal(vm.runInContext('data.runId',context),'original');
});
