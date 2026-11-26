'use strict';
/*
 * A stand-in for the Claude Messages API, for tests: no key, no cost, predictable answers.
 * Streams Server-Sent Events in the same format as https://api.anthropic.com/v1/messages.
 *
 *   - a message containing "log" and "km" -> calls the app's log_km tool (CR-V, 312 700 km)
 *   - after a tool result                -> "Done. <the tool result>"
 *   - anything else                      -> a short text answer
 *
 * Run on its own: node test/mock-claude.js 8788   then set ANTHROPIC_BASE_URL=http://localhost:8788
 */
const http = require('http');

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}
function textEvents(text) {
  const parts = text.match(/.{1,12}/gs) || [''];
  return [
    { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', content: [], model: 'mock', stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...parts.map(p => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
}
function toolEvents(name, input, preface) {
  const json = JSON.stringify(input);
  return [
    { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', content: [], model: 'mock', stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: preface } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_mock1', name, input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(0, 10) } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(10) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
}

function createMock() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      if (req.url !== '/v1/messages' || req.method !== 'POST') { res.writeHead(404); return res.end(); }
      if (!req.headers['x-api-key']) { res.writeHead(401); return res.end('{"type":"error","error":{"type":"authentication_error"}}'); }
      const b = JSON.parse(body); calls.push(b);
      const last = b.messages[b.messages.length - 1];
      if (Array.isArray(last.content)) {
        const r = last.content.find(c => c.type === 'tool_result');
        return sse(res, textEvents(`Done. ${r ? r.content : ''}`));
      }
      const text = String(last.content).toLowerCase();
      if (text.includes('log') && text.includes('km') && (b.tools || []).some(t => t.name === 'log_km')) return sse(res, toolEvents('log_km', { vehicle: 'CR-V', km: 312700 }, 'Logging that now.'));
      return sse(res, textEvents('There are 6 vehicles in the FFSA fleet.'));
    });
  });
  return { server, calls };
}

if (require.main === module) {
  const port = Number(process.argv[2] || 8788);
  createMock().server.listen(port, () => console.log(`Mock Claude API on http://localhost:${port}`));
}
module.exports = { createMock };
