import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDevice, repairDevelopmentPorts } from './app-dev-bridge.mjs';

test('only an authorized unambiguous device is selected', () => {
  assert.equal(selectDevice('List of devices attached\nredmi\tdevice\nother\tunauthorized\n'), 'redmi');
  assert.throws(() => selectDevice('redmi\toffline\n'), /连接一台/);
  assert.throws(() => selectDevice('one\tdevice\ntwo\tdevice\n'), /多台设备/);
  assert.equal(selectDevice('one\tdevice\ntwo\tdevice\n', 'two'), 'two');
  assert.throws(() => selectDevice('one\tdevice\n', 'two'), /指定手机/);
});

test('recovers lost business forwards after reconnect and leaves HBuilder mappings intact', async () => {
  const mappings = new Map([['tcp:8000', 'tcp:8000'], ['tcp:26880', 'tcp:9999']]);
  const writes = [];
  const run = async args => {
    assert.deepEqual(args.slice(0, 3), ['-s', 'redmi', 'reverse']);
    if (args[3] === '--list') return [...mappings].map(([from, to]) => `UsbFfs ${from} ${to}`).join('\n');
    writes.push(args.slice(3)); mappings.set(args[3], args[4]); return '';
  };
  assert.deepEqual(await repairDevelopmentPorts(run, 'redmi'), [26880, 26881]);
  assert.equal(mappings.get('tcp:8000'), 'tcp:8000');
  assert.deepEqual(await repairDevelopmentPorts(run, 'redmi'), []);
  assert.equal(writes.length, 2);
  mappings.clear(); // The reported failure: a connected phone has no reverse entries.
  assert.deepEqual(await repairDevelopmentPorts(run, 'redmi'), [26880, 26881]);
  assert.equal(mappings.get('tcp:26881'), 'tcp:26881');
});

test('offline device fails without writing to another device', async () => {
  const calls = [];
  await assert.rejects(repairDevelopmentPorts(async args => { calls.push(args); throw new Error('device offline'); }, 'redmi'), /offline/);
  assert.deepEqual(calls, [['-s', 'redmi', 'reverse', '--list']]);
});
