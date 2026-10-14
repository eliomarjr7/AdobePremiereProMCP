// Chama uma função do premiere.jsx direto no painel CEP (ws://127.0.0.1:9801), sem passar pelo MCP.
// uso: node cep-call.cjs <funcao> '{"arg":"valor"}'   ex.: node cep-call.cjs hostReload '{}'
// CEP_TIMEOUT=ms aumenta o tempo de espera (render/exportação). Se a porta recusar e o Premiere estiver aberto,
// reinicia só o processo do painel (painel travado / tela preta) e tenta de novo uma vez.
const WebSocket = require('ws'); const fs = require('fs'); const os = require('os'); const path = require('path');
const token = fs.readFileSync(os.homedir() + '/.premierpro-mcp/cep-token', 'utf8').trim();
const [fn, args] = [process.argv[2], process.argv[3]];
const TIMEOUT = parseInt(process.env.CEP_TIMEOUT || '120000', 10);

function call() {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:9801', { headers: { Authorization: 'Bearer ' + token } });
    const t = setTimeout(() => { resolve({ out: 'timeout', code: 1 }); try { ws.terminate(); } catch (e) {} }, TIMEOUT);
    ws.on('open', () => ws.send(JSON.stringify({ requestId: 'x1', action: 'evalCommand', params: { function_name: fn, args_json: args } })));
    ws.on('message', d => { clearTimeout(t); resolve({ out: String(d), code: 0 }); ws.close(); });
    ws.on('error', e => { clearTimeout(t); resolve({ out: 'ERR ' + e.message, code: 1, refused: /ECONNREFUSED/.test(e.message) }); });
  });
}

(async () => {
  let r = await call();
  if (r.refused) {
    const { recoverCepPanel } = await import(path.join(__dirname, 'dist/bridge/cep-panel-recovery.js'));
    const rec = await recoverCepPanel(9801);
    if (rec.attempted) { console.error('[recuperação do painel] ' + rec.reason); r = await call(); }
  }
  console.log(r.out);
  process.exit(r.code);
})();
