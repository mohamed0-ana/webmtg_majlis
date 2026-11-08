// Majlis - signaling + static server + Claude summary endpoint.
// Media is peer-to-peer (WebRTC mesh), so this server only relays small JSON messages.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';          // optional team password
const MAX_PEERS = parseInt(process.env.MAX_PEERS || '6', 10);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const fs = require('fs');
const INDEX = path.join(__dirname, 'public', 'index.html');

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 1e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
  req.on('error', reject);
});

function config(res) {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  }
  json(res, 200, { iceServers, needsCode: !!ACCESS_CODE, claude: !!ANTHROPIC_API_KEY, maxPeers: MAX_PEERS });
}

async function summarize(req, res) {
  if (ACCESS_CODE && !same(req.headers['x-access-code'] || '', ACCESS_CODE)) return json(res, 401, { error: 'Wrong access code' });
  if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'ANTHROPIC_API_KEY is not set on the server' });
  let body; try { body = await readBody(req); } catch { return json(res, 400, { error: 'Bad request' }); }
  const { transcript = '', title = 'Meeting', language = '' } = body;
  if (transcript.trim().length < 20) return json(res, 400, { error: 'Transcript is empty or too short' });
  const system = 'You are a meeting-notes assistant for a small engineering team. Write clear, accurate notes ' +
    'using only what is in the transcript. Never invent decisions, owners or dates. The transcript is automatic speech ' +
    'recognition, so fix obvious recognition errors only when the meaning is clear.';
  const user = `Meeting title: ${title}\n` +
    (language ? `Write the notes in: ${language}\n` : 'Write the notes in the main language of the transcript.\n') +
    `\nProduce Markdown with these sections:\n## Summary (3-6 sentences)\n## Key decisions\n## Action items (table: Owner | Task | Due)\n## Open questions\n## Topics discussed (short bullets)\n` +
    `Use "Not stated" where an owner or date is missing.\n\n<transcript>\n${transcript.slice(0, 300000)}\n</transcript>`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, system, messages: [{ role: 'user', content: user }] })
    });
    const data = await r.json();
    if (!r.ok) return json(res, 502, { error: data?.error?.message || 'Claude API error' });
    json(res, 200, { notes: (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') });
  } catch (e) {
    json(res, 502, { error: 'Could not reach Claude: ' + e.message });
  }
}

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (req.method === 'GET' && p === '/config') return config(res);
  if (req.method === 'POST' && p === '/api/summarize') return summarize(req, res);
  if (req.method === 'GET' && (p === '/' || p === '/index.html' || p.startsWith('/r/'))) {
    return fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(buf);
    });
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const rooms = new Map(); // room -> Map(id -> {ws, name})

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const name = (url.searchParams.get('name') || 'Guest').slice(0, 40);
  if (ACCESS_CODE && !same(url.searchParams.get('code') || '', ACCESS_CODE)) return ws.close(4001, 'bad code');
  if (!room) return ws.close(4002, 'no room');
  const peers = rooms.get(room) || new Map();
  if (peers.size >= MAX_PEERS) return ws.close(4003, 'room full');
  rooms.set(room, peers);

  const id = crypto.randomBytes(5).toString('hex');
  const send = (sock, msg) => sock.readyState === 1 && sock.send(JSON.stringify(msg));
  send(ws, { type: 'welcome', id, peers: [...peers].map(([pid, p]) => ({ id: pid, name: p.name })) });
  peers.forEach(p => send(p.ws, { type: 'peer-joined', id, name }));
  peers.set(id, { ws, name });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'signal') {                       // 1:1 relay (offers, answers, ICE)
      const t = peers.get(m.to); if (t) send(t.ws, { type: 'signal', from: id, data: m.data });
    } else if (['transcript', 'sharing', 'recording'].includes(m.type)) {   // broadcast
      peers.forEach((p, pid) => pid !== id && send(p.ws, { ...m, from: id, name }));
    }
  });
  ws.on('close', () => {
    peers.delete(id);
    peers.forEach(p => send(p.ws, { type: 'peer-left', id }));
    if (!peers.size) rooms.delete(room);
  });
});

server.listen(PORT, () => console.log(`Majlis running on http://localhost:${PORT}`));
