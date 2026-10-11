// The SMTP check script: it sends through the real provider path to a local SMTP server and reports the relay's answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'scripts', 'smtp-check.js');

let server, port;
before(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    onRcptTo(address, _session, cb) {
      if (address.address.startsWith('reject@')) { const e = new Error('no such mailbox'); e.responseCode = 550; return cb(e); }
      cb();
    },
    onData(stream, _session, cb) { stream.resume(); stream.on('end', cb); },
    logger: false,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));

function runCheck(args) {
  return new Promise(resolve => {
    const env = {
      PATH: process.env.PATH, NODE_ENV: 'test', SMTP_ALLOW_PLAINTEXT: 'true',
      MESSAGING_EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_FROM: 'notifications@school.test',
    };
    const child = spawn(process.execPath, [script, ...args], { env, cwd: path.join(here, '..') });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => resolve({ code, out }));
  });
}

test('smtp check: an accepted message exits 0 and prints the relay response', async () => {
  const r = await runCheck(['ok@school.test']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ACCEPTED by the relay/);
  assert.match(r.out, /Server response: 250/);
});

test('smtp check: a refused recipient exits 1 and says why', async () => {
  const r = await runCheck(['reject@school.test']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOT SENT/);
  assert.match(r.out, /550/);
  assert.match(r.out, /Hint:/);
});

test('smtp check: no recipient exits 2 without sending', async () => {
  const r = await runCheck([]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Give a recipient/);
});
