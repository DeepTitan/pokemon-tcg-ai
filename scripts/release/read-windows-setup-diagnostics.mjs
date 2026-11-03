import { writeFileSync } from 'node:fs';

// Read-only diagnostics from the disposable runner's WebView2. The debug port
// is enabled by a process-scoped test environment variable, never by the app.
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Hosted test only.');
const pages = await fetch('http://127.0.0.1:9222/json/list').then(response => response.json());
const page = pages.find(page => page.type === 'page' && page.url.includes('tracker.html'));
if (!page) throw new Error('Trace WebView2 diagnostic target was not found.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
const diagnostics = { setupWarnings: [] };
const timer = setTimeout(() => { socket.close(); throw new Error('Diagnostic request timed out.'); }, 12_000);
await new Promise((resolve, reject) => {
  socket.addEventListener('error', reject, { once: true });
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    socket.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: {
      expression: `Promise.all(['tracker_environment', 'background_status'].map(command =>
        window.__TAURI_INTERNALS__.invoke(command).then(value => ({command, value}))))`,
      awaitPromise: true, returnByValue: true,
    } }));
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ');
      if (text.startsWith('Trace setup (')) diagnostics.setupWarnings.push(text);
    }
    if (message.id === 2) {
      diagnostics.native = message.result?.result?.value;
      diagnostics.error = message.error ?? message.result?.exceptionDetails;
      resolve();
    }
  });
});
clearTimeout(timer);
socket.close();
writeFileSync(process.argv[2], `${JSON.stringify(diagnostics, null, 2)}\n`);
