import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTwoFilesPatch } from 'diff';
import { applyWorkspacePatch } from '../dist/patch.js';
import { digest, saveText } from '../dist/files.js';

const diff = (oldPath,newPath,before,after) => createTwoFilesPatch(oldPath ? 'a/'+oldPath : '/dev/null',newPath ? 'b/'+newPath : '/dev/null',before,after);
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'onputer patch 한글 '));
  t.after(()=>fs.rm(root,{recursive:true,force:true})); return root;
}
test('multi-file dry run, CRLF update, create, delete, move and no-final-newline',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'한글 file.txt'),'one\r\ntwo\r\n');
  await fs.writeFile(path.join(root,'delete.txt'),'remove\n');
  await fs.writeFile(path.join(root,'old.txt'),'old');
  const patch=diff('한글 file.txt','한글 file.txt','one\ntwo\n','one\nchanged\n')+diff(null,'nested/new.txt','','new\n')+diff('delete.txt',null,'remove\n','')+diff('old.txt','renamed.txt','old','new');
  const hashes={'한글 file.txt':digest('one\r\ntwo\r\n'),'delete.txt':digest('remove\n'),'old.txt':digest('old')};
  const preview=await applyWorkspacePatch(root,patch,hashes,true);
  assert.equal(preview.applied,false);assert.equal(preview.files.length,4);
  await assert.rejects(fs.stat(path.join(root,'nested')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(root,'old.txt'),'utf8'),'old');
  const applied=await applyWorkspacePatch(root,patch,hashes);
  assert.equal(applied.applied,true);
  assert.equal(await fs.readFile(path.join(root,'한글 file.txt'),'utf8'),'one\r\nchanged\r\n');
  assert.equal(await fs.readFile(path.join(root,'nested/new.txt'),'utf8'),'new\n');
  assert.equal(await fs.readFile(path.join(root,'renamed.txt'),'utf8'),'new');
  await assert.rejects(fs.stat(path.join(root,'delete.txt')),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(root,'old.txt')),{code:'ENOENT'});
});
test('invalid later hunk, missing/stale hash and occupied destination leave all files unchanged',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'a.txt'),'a\n');await fs.writeFile(path.join(root,'b.txt'),'b\n');
  const valid=diff('a.txt','a.txt','a\n','A\n');
  const invalid=valid+diff('b.txt','b.txt','WRONG\n','B\n');
  await assert.rejects(applyWorkspacePatch(root,invalid,{'a.txt':digest('a\n'),'b.txt':digest('b\n')}),/context/);
  assert.equal(await fs.readFile(path.join(root,'a.txt'),'utf8'),'a\n');
  await assert.rejects(applyWorkspacePatch(root,valid,{}),/expected_hashes/);
  await assert.rejects(applyWorkspacePatch(root,valid,{'a.txt':digest('stale')}),/expected_hashes/);
  await assert.rejects(applyWorkspacePatch(root,diff('a.txt','b.txt','a\n','A\n'),{'a.txt':digest('a\n')}),/already exists/);
});
test('reject path traversal, secret paths, links, binary patches, aliases and partial deletions',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'a.txt'),'a\nb\n');
  for(const name of ['../escape','.env','.git/config','C:/escape']) await assert.rejects(applyWorkspacePatch(root,diff(null,name,'','bad\n'),{}));
  await fs.mkdir(path.join(root,'outside'));await fs.symlink(path.join(root,'outside'),path.join(root,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(applyWorkspacePatch(root,diff(null,'link/x','','bad\n'),{}),/links|junctions/);
  await assert.rejects(applyWorkspacePatch(root,'diff --git a/x b/x\nnew file mode 120000\n--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+outside\n',{}),/regular/);
  await assert.rejects(applyWorkspacePatch(root,'diff --git a/x b/x\nGIT binary patch\n',{}),/Binary/);
  await assert.rejects(applyWorkspacePatch(root,diff(null,'Z.txt','','a\n')+diff(null,'z.txt','','b\n'),{}),/case-alias/);
  await assert.rejects(applyWorkspacePatch(root,diff('a.txt',null,'a\n',''),{'a.txt':digest('a\nb\n')}),/complete file/);
});
test('I/O failure during second replacement rolls back the first replacement',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'a.txt'),'a');await fs.writeFile(path.join(root,'b.txt'),'b');
  const original=fs.rename;
  fs.rename=async(from,to)=>{if(to===path.join(root,'b.txt'))throw new Error('simulated rename failure');return original(from,to);};
  try {
    await assert.rejects(applyWorkspacePatch(root,diff('a.txt','a.txt','a','A')+diff('b.txt','b.txt','b','B'),{'a.txt':digest('a'),'b.txt':digest('b')}),/simulated/);
  } finally {fs.rename=original;}
  assert.equal(await fs.readFile(path.join(root,'a.txt'),'utf8'),'a');
  assert.equal(await fs.readFile(path.join(root,'b.txt'),'utf8'),'b');
  assert.deepEqual((await fs.readdir(root)).sort(),['a.txt','b.txt']);
});
test('patch and write_file share the same collision lock',async t=>{
  const root=await fixture(t);await fs.writeFile(path.join(root,'a.txt'),'old');
  const results=await Promise.allSettled([applyWorkspacePatch(root,diff('a.txt','a.txt','old','patch'),{'a.txt':digest('old')}),saveText(root,'a.txt','write',digest('old'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('pure Git rename and empty file creation',async t=>{
  const root=await fixture(t);await fs.writeFile(path.join(root,'old.txt'),'unchanged');
  await applyWorkspacePatch(root,'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n',{'old.txt':digest('unchanged')});
  assert.equal(await fs.readFile(path.join(root,'new.txt'),'utf8'),'unchanged');
  await applyWorkspacePatch(root,'diff --git a/empty.txt b/empty.txt\nnew file mode 100644\nindex 0000000..e69de29\n',{});
  assert.equal(await fs.readFile(path.join(root,'empty.txt'),'utf8'),'');
});
