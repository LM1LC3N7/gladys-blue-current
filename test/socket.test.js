// -----------------------------------------------------------------------------
// The real `ws` client (src/socket.js) against a loopback `ws` server: the
// handshake refusals and their reason header, the size bound, the validation.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { LIMITS } from '../src/constants.js';
import { Channel, defaultSocketFactory, validateToken } from '../src/socket.js';

async function server(t, options = {}, onMessage = () => {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, ...options });
  await new Promise((resolve) => wss.on('listening', resolve));
  wss.on('connection', (socket) => socket.on('message', (data) => onMessage(socket, data)));
  t.after(() => new Promise((resolve) => wss.close(resolve)));
  const { port } = wss.address();
  // The real factory and options, pointed at the loopback server.
  const factory = (_url, socketOptions) =>
    defaultSocketFactory(`ws://127.0.0.1:${port}`, socketOptions);
  return { wss, factory };
}

const refuse = (reason) => ({
  verifyClient: (_info, done) =>
    done(false, 403, 'Forbidden', { 'x-websocket-reject-reason': reason }),
});

test('a handshake refused for the request limit or "Already connected" is told apart', async (t) => {
  for (const [reason, kind] of [
    ['Request limit reached', 'rate_limited'],
    ['Already connected', 'already_connected'],
    ['', 'unauthorized'],
  ]) {
    const { factory } = await server(t, refuse(reason));
    const channel = new Channel({ factory, onMessage: () => {}, onClose: () => {} });
    await assert.rejects(channel.open(), (err) => err.kind === kind, reason);
  }
});

test('a message over the bound closes the connection; smaller ones are read', async (t) => {
  const { wss, factory } = await server(t);
  const messages = [];
  let closed;
  const done = new Promise((resolve) => {
    closed = resolve;
  });
  const channel = new Channel({
    factory,
    onMessage: (m) => messages.push(m),
    onClose: (err) => closed(err),
  });
  await channel.open();
  const [socket] = wss.clients;
  socket.send(JSON.stringify({ object: 'HELLO' }));
  socket.send('x'.repeat(LIMITS.messageBytes + 10));
  const err = await done;
  assert.equal(err.kind, 'closed');
  assert.deepEqual(messages, [{ object: 'HELLO' }]);
});

test('the validation on its own connection: the token, a refusal, the request limit', async (t) => {
  const answers = {
    good: { object: 'STATUS_API_TOKEN', success: true, token: 'abc', customer_id: '1' },
    bad: { object: 'STATUS_API_TOKEN', success: false, error: '' },
    limit: { object: 'ERROR', error: 42, message: 'Request limit reached' },
  };
  const { wss, factory } = await server(t, {}, (socket, data) => {
    const { command, token } = JSON.parse(data);
    assert.equal(command, 'VALIDATE_API_TOKEN');
    socket.send(JSON.stringify(answers[token]));
  });
  assert.equal(await validateToken({ factory, apiToken: 'good' }), 'abc');
  await assert.rejects(validateToken({ factory, apiToken: 'bad' }), { kind: 'refused' });
  await assert.rejects(validateToken({ factory, apiToken: 'limit' }), { kind: 'rate_limited' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(wss.clients.size, 0, 'every validation connection is closed');
});
