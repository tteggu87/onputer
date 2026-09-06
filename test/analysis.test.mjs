import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { inspectProject,searchCode,analyzeChanges,buildAnalysis } from '../dist/analysis.js';
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'onputer analysis 한글 '));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files={
    'package.json':JSON.stringify({name:'fixture',scripts:{test:'node --test test/*.test.mjs',typecheck:'tsc --noEmit'}}),
    'tsconfig.json':'{"compilerOptions":{"baseUrl":".","paths":{"@core/*":["src/*"]}}}',
    'src/math.ts':'// function Fake() {}\nexport function calculate(n: number) { return n * 2; }\nexport class Calculator {}\nconst text = "calculate Fake";\n',
    'src/service.ts':"import { calculate } from '@core/math';\nexport const run = () => calculate(2);\n",
    'src/index.ts':"export {run} from './service.js';\n",
    'test/service.test.mjs':"import {run} from '../src/index.js';\nif(run() !== 4) throw Error('bad');\n",
    'src/unrelated.ts':'export function unrelated() { return 1; }\n',
    'test/unrelated.test.ts':"import {unrelated} from '../src/unrelated.js';\nunrelated();\n",
    'python/util.py':'# def Ghost(): pass\ndef double(n):\n    return n * 2\n',
    'python/main.py':'from .util import double\nprint(double(2))\n',
    'python/test_util.py':'from .util import double\nassert double(2) == 4\n',
    'csharp/Service.cs':'// class FakeService {}\npublic class Service {}\n',
    '.env':'secret',
  };
  for(const [name,body] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),body);}
  return root;
}
test('syntax definitions, exact references, imports, aliases, transitive dependents and test selection',async t=>{
  const root=await fixture(t);
  const overview=await inspectProject(root,0,2);
  assert.ok(overview.languages.includes('typescript'));assert.ok(overview.project_types.includes('node'));assert.equal(overview.files.length,2);assert.equal(overview.has_more,true);
  assert.ok(overview.entrypoints.some(e=>e.path==='src/index.ts'));
  const symbol=await searchCode(root,'calculate','definitions');
  assert.equal(symbol.matches.length,1);assert.equal(symbol.matches[0].path,'src/math.ts');assert.equal(symbol.matches[0].line,2);assert.equal(symbol.matches[0].kind,'function');
  assert.equal((await searchCode(root,'Fake','definitions')).matches.length,0);
  assert.equal((await searchCode(root,'Fake','references')).matches.length,0);
  const refs=await searchCode(root,'calculate','references');
  assert.deepEqual([...new Set(refs.matches.map(m=>m.path))],['src/service.ts']);
  const analysis=await buildAnalysis(root);
  assert.ok(analysis.imports.some(e=>e.from==='src/service.ts'&&e.to==='src/math.ts'&&e.confidence==='resolved'));
  const impact=await analyzeChanges(root,['src/math.ts']);
  assert.deepEqual(new Set(impact.dependents.map(d=>d.path)),new Set(['src/service.ts','src/index.ts','test/service.test.mjs']));
  assert.ok(impact.related_tests.some(t=>t.path==='test/service.test.mjs'));
  assert.ok(!impact.related_tests.some(t=>t.path==='test/unrelated.test.ts'));
  assert.ok(impact.recommended_commands.some(c=>c.command.endsWith('run test')&&c.source==='package.json'));
  assert.ok(!overview.files.some(f=>f.path==='.env'));
});
test('Python and C# declarations are explicitly heuristic; Python relative imports link tests',async t=>{
  const root=await fixture(t);
  const py=await searchCode(root,'double','definitions');assert.equal(py.matches[0].confidence,'heuristic');assert.equal(py.matches[0].line,2);
  assert.equal((await searchCode(root,'Ghost','definitions')).matches.length,0);
  const cs=await searchCode(root,'Service','definitions');assert.equal(cs.matches[0].confidence,'heuristic');
  assert.equal((await searchCode(root,'FakeService','definitions')).matches.length,0);
  const impact=await analyzeChanges(root,['python/util.py']);
  assert.ok(impact.related_tests.some(t=>t.path==='python/test_util.py'));
  assert.ok(impact.dependents.some(t=>t.path==='python/main.py'));
});
test('fresh analysis sees edits; syntax errors are disclosed; paths outside workspace rejected',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'src/new.ts'),'export function fresh() {}\n');
  assert.equal((await searchCode(root,'fresh','definitions')).matches.length,1);
  await fs.writeFile(path.join(root,'src/new.ts'),'export function replacement() {}\n');
  assert.equal((await searchCode(root,'fresh','definitions')).matches.length,0);
  await fs.writeFile(path.join(root,'src/broken.ts'),'export function ( {');
  assert.ok((await inspectProject(root)).coverage.warnings.some(w=>w.includes('Syntax errors')));
  await assert.rejects(analyzeChanges(root,['../outside.ts']),/outside/);
});
test('Git unstaged/untracked, staged and deleted paths; non-Git explicit paths still work',async t=>{
  const root=await fixture(t);
  await assert.rejects(analyzeChanges(root,undefined));
  assert.equal((await analyzeChanges(root,['src/math.ts'])).changed_files[0],'src/math.ts');
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
  git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','initial');
  await fs.appendFile(path.join(root,'src/math.ts'),'\nexport const added = true;\n');
  await fs.writeFile(path.join(root,'src/한글 new.ts'),'export const newFile = true;\n');
  const unstaged=await analyzeChanges(root,undefined);
  assert.deepEqual(new Set(unstaged.changed_files),new Set(['src/math.ts','src/한글 new.ts']));
  git('add','src/math.ts');
  const staged=await analyzeChanges(root,undefined,true);assert.deepEqual(staged.changed_files,['src/math.ts']);
  assert.ok(staged.coverage.warnings.some(w=>w.includes('index snapshot')));
  await fs.unlink(path.join(root,'src/service.ts'));
  const deleted=await analyzeChanges(root,undefined);
  assert.ok(deleted.dependents.some(d=>d.path==='src/index.ts'));
});

test('deleted alias and Python modules still expose their importers',async t=>{
  const root=await fixture(t);
  await fs.unlink(path.join(root,'src/math.ts'));
  await fs.unlink(path.join(root,'python/util.py'));
  const result=await analyzeChanges(root,['src/math.ts','python/util.py']);
  assert.ok(result.dependents.some(d=>d.path==='src/service.ts'&&d.confidence==='heuristic'));
  assert.ok(result.related_tests.some(d=>d.path==='test/service.test.mjs'&&d.confidence==='heuristic_import_chain'));
  assert.ok(result.dependents.some(d=>d.path==='python/main.py'));
  assert.ok(result.related_tests.some(d=>d.path==='python/test_util.py'));
});
test('Git change paths are relative to a subdirectory workspace, excluding siblings',async t=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'onputer-subroot-'));
  t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  const root=path.join(parent,'project');await fs.mkdir(path.join(root,'src'),{recursive:true});
  await fs.writeFile(path.join(root,'src/lib.ts'),'export const value = 1;\n');
  await fs.writeFile(path.join(root,'src/main.ts'),"import {value} from './lib.js';\nconsole.log(value);\n");
  await fs.writeFile(path.join(parent,'outside.txt'),'before');
  const git=(...args)=>execFileSync('git',args,{cwd:parent,stdio:'ignore'});
  git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','initial');
  await fs.writeFile(path.join(root,'src/lib.ts'),'export const value = 2;\n');
  await fs.writeFile(path.join(parent,'outside.txt'),'after');
  const result=await analyzeChanges(root,undefined);
  assert.deepEqual(result.changed_files,['src/lib.ts']);
  assert.ok(result.dependents.some(d=>d.path==='src/main.ts'));
});
test('analysis file limit reports incomplete coverage',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'onputer-analysis-cap-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(let i=0;i<1001;i++) await fs.writeFile(path.join(root,`file-${i}.ts`),`export const value${i} = ${i};\n`);
  const result=await inspectProject(root);
  assert.equal(result.coverage.analyzed_files,1000);
  assert.equal(result.coverage.truncated,true);
  assert.ok(result.coverage.warnings.some(w=>w.includes('budget')));
});

test('module path casing follows the actual filesystem',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'src/case.ts'),"import {calculate} from './Math';\ncalculate(1);\n");
  const caseAliasExists=await fs.stat(path.join(root,'src/Math.ts')).then(()=>true,()=>false);
  const result=await analyzeChanges(root,['src/math.ts']);
  assert.equal(result.dependents.some(d=>d.path==='src/case.ts'),caseAliasExists);
  if(!caseAliasExists) assert.ok(result.coverage.unresolved_imports>0);
});

test('tests importing compiled output are linked heuristically using explicit rootDir/outDir',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{rootDir:'src',outDir:'dist'}}));
  await fs.writeFile(path.join(root,'test/built.test.mjs'),"import {calculate} from '../dist/math.js';\ncalculate(2);\n");
  const result=await analyzeChanges(root,['src/math.ts']);
  assert.ok(result.related_tests.some(t=>t.path==='test/built.test.mjs'&&t.confidence==='heuristic_import_chain'));
});
