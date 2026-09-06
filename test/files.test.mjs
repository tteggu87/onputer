import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { saveText, digest, textFile } from '../dist/files.js';

test('overlapping workspace roots cannot overwrite each other using a stale hash', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onputer-overlap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'project'));
  await fs.writeFile(path.join(root, 'project/x.txt'), 'original');
  const results = await Promise.allSettled([
    saveText(root, 'project/x.txt', 'first', digest('original')),
    saveText(path.join(root, 'project'), 'x.txt', 'second', digest('original')),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});

test('large and binary files are rejected before returning content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onputer-bounds-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'large'), Buffer.alloc(1048577, 65));
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([65, 0, 66]));
  await assert.rejects(textFile(path.join(root, 'large')), /1 MiB/);
  await assert.rejects(textFile(path.join(root, 'binary')), /Binary/);
});
