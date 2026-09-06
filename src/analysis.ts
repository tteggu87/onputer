import path from 'node:path';
import { statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { resolvePath, textFile, walk, within } from './files.js';

const exec = promisify(execFile);
const posix = (p: string) => p.split(path.sep).join('/');
export const ANALYSIS_LIMITS = { files: 1000, bytes: 16 * 1024 * 1024, symbols: 20000, references: 50000, nodes: 300000, edges: 10000 };
const languages: Record<string,string> = { '.ts':'typescript','.tsx':'typescript','.mts':'typescript','.cts':'typescript','.js':'javascript','.jsx':'javascript','.mjs':'javascript','.cjs':'javascript','.py':'python','.go':'go','.rs':'rust','.cs':'csharp','.java':'java','.c':'c','.h':'c','.cpp':'cpp','.hpp':'cpp','.swift':'swift' };
const jsFamily = new Set(['typescript','javascript']);
const manifests = new Set(['package.json','tsconfig.json','jsconfig.json','pyproject.toml','requirements.txt','go.mod','Cargo.toml','pom.xml','build.gradle','CMakeLists.txt']);
export type Definition = { name:string; kind:string; path:string; line:number; column:number; exported:boolean; confidence:'syntax'|'heuristic' };
export type Reference = { name:string; path:string; line:number; column:number; confidence:'syntax'|'heuristic' };
export type ImportEdge = { from:string; specifier:string; line:number; to?:string; confidence:'resolved'|'heuristic'|'unresolved' };
type FileInfo = { path:string; language:string; role:string; entrypoint:boolean };
type Analysis = { root:string; files:FileInfo[]; symbols:Definition[]; references:Reference[]; imports:ImportEdge[]; bodies:Map<string,string>; warnings:string[]; coverage:{ inventory_files:number; analyzed_files:number; scanned_bytes:number; truncated:boolean; skipped_files:number } };
function role(file: string) {
  if (/(^|\/)(tests?|__tests__|specs?)(\/|$)|(?:\.|_)(test|spec)\.[^.]+$|(^|\/)test_[^/]+\.py$/i.test(file)) return 'test';
  if (manifests.has(path.posix.basename(file)) || /\.(csproj|sln)$/.test(file)) return 'config';
  if (/\.(md|rst|txt)$/.test(file)) return 'docs';
  return languages[path.extname(file)] ? 'source' : 'other';
}
function entrypoint(file: string) { return /(^|\/)(index|main|app|server|cli)\.(?:[cm]?[jt]s|tsx|jsx|py|go|rs)$|(^|\/)Program\.cs$/.test(file); }

/** Mask strings and comments for heuristic languages while preserving source positions. */
function masked(source: string, python: boolean) {
  const chars = source.split('');
  let i = 0;
  const blank = (start:number, end:number) => { for (let j=start; j<end; j++) if (chars[j] !== '\n' && chars[j] !== '\r') chars[j] = ' '; };
  while(i < source.length) {
    const start = i;
    if ((python && source[i] === '#') || (!python && source.startsWith('//', i))) {
      while(i < source.length && source[i] !== '\n') i++; blank(start,i);
    } else if (!python && source.startsWith('/*', i)) {
      i = source.indexOf('*/',i+2); i = i < 0 ? source.length : i+2; blank(start,i);
    } else if (['"', "'", '`'].includes(source[i])) {
      const quote = source[i]; const triple = python && source.startsWith(quote.repeat(3),i); const marker = triple ? quote.repeat(3) : quote;
      i += marker.length;
      while(i < source.length) { if(source[i] === '\\') {i+=2; continue;} if(source.startsWith(marker,i)) {i+=marker.length; break;} i++; }
      blank(start,Math.min(i,source.length));
    } else i++;
  }
  return chars.join('');
}

export async function buildAnalysis(root: string, changedPaths: string[] = []): Promise<Analysis> {
  const inventory = await walk(root, '.', 20, 5000);
  const files = inventory.entries.filter(e=>e.type === 'file').map(e=>({ path:e.path, language:languages[path.extname(e.path)] ?? 'other', role:role(e.path), entrypoint:entrypoint(e.path) }));
  const a:Analysis = { root, files, symbols:[], references:[], imports:[], bodies:new Map(), warnings:[], coverage:{ inventory_files:files.length, analyzed_files:0, scanned_bytes:0, truncated:inventory.truncated || inventory.entries.some(e=>e.type==='directory' && e.path.split('/').length>=20), skipped_files:0 } };
  const warn = (text:string) => { if(a.warnings.length < 30 && !a.warnings.includes(text)) a.warnings.push(text); };
  for (const file of files.filter(f=>f.language !== 'other' || f.role === 'config')) {
    if(a.coverage.analyzed_files >= ANALYSIS_LIMITS.files) {a.coverage.truncated = true; break;}
    try {
      const body = await textFile(await resolvePath(root,file.path));
      if(a.coverage.scanned_bytes + Buffer.byteLength(body) > ANALYSIS_LIMITS.bytes) {a.coverage.truncated = true; break;}
      a.bodies.set(file.path,body); a.coverage.analyzed_files++; a.coverage.scanned_bytes += Buffer.byteLength(body);
    } catch { a.coverage.skipped_files++; a.coverage.truncated=true; warn('Some files were unreadable, binary, too large, or changed during scanning.'); }
  }
  const resolutionFiles = new Set([...a.bodies.keys(), ...changedPaths]);
  const absPaths = new Map([...resolutionFiles].map(p=>[path.resolve(root,p),p]));
  const directories = new Set<string>();
  for (const absolute of absPaths.keys()) for(let dir=path.dirname(absolute); dir.length >= root.length; dir=path.dirname(dir)) { directories.add(dir); if(dir === path.dirname(dir)) break; }
  // Resolve casing aliases only when the actual filesystem says they are the same object.
  function lookupFor(values:Set<string>) {
    const folded=new Map<string,string|null>();
    for(const value of values) {const key=value.toLowerCase();folded.set(key,folded.has(key)?null:value);}
    const cache=new Map<string,string|undefined>();
    return (input:string) => {
      const value=path.resolve(input);if(values.has(value)) return value;
      if(cache.has(value)) return cache.get(value);
      const candidate=folded.get(value.toLowerCase());let result:string|undefined;
      if(candidate) try {const x=statSync(value),y=statSync(candidate);if(x.dev===y.dev&&x.ino===y.ino) result=candidate;} catch { /* not a real filesystem alias */ }
      cache.set(value,result);return result;
    };
  }
  const lookupFile=lookupFor(new Set(absPaths.keys()));
  const lookupDirectory=lookupFor(directories);
  // Resolve modules only against the bounded in-memory inventory, never node_modules or external files.
  const host:ts.ModuleResolutionHost = { fileExists:p=>lookupFile(p)!==undefined, readFile:p=>a.bodies.get(absPaths.get(lookupFile(p)??'') ?? ''), directoryExists:p=>lookupDirectory(p)!==undefined, getCurrentDirectory:()=>root, realpath:p=>lookupFile(p)??p };
  const compilerOptions:ts.CompilerOptions = { allowJs:true, module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler };
  let outputMapping:{source:string;output:string}|undefined;
  const rootConfig = a.bodies.get('tsconfig.json') ?? a.bodies.get('jsconfig.json');
  if(rootConfig) {
    const parsed = ts.parseConfigFileTextToJson('tsconfig.json',rootConfig);
    if(parsed.error) warn('Root TypeScript config could not be parsed; using relative import resolution.');
    else {
      const selected = parsed.config?.compilerOptions ?? {};
      if(typeof selected.rootDir==='string' && typeof selected.outDir==='string') {
        const source=path.resolve(root,selected.rootDir),output=path.resolve(root,selected.outDir);
        if(within(root,source)&&within(root,output)) outputMapping={source,output};
      }
      if(typeof selected.baseUrl === 'string') compilerOptions.baseUrl = path.resolve(root,selected.baseUrl);
      if(selected.paths && typeof selected.paths === 'object') {
        const safe = Object.fromEntries(Object.entries(selected.paths).filter(([,v])=>Array.isArray(v) && v.every(p=>typeof p === 'string'))) as Record<string,string[]>;
        compilerOptions.paths = safe; compilerOptions.baseUrl ??= root;
      }
      if(parsed.config?.extends || parsed.config?.references) warn('tsconfig extends/project references are not followed; root baseUrl/paths only.');
    }
  }
  const definitions = new Set<string>();
  let nodes = 0;
  function define(name:string,kind:string,file:string,line:number,column:number,exported:boolean,confidence:'syntax'|'heuristic') {
    if(a.symbols.length >= ANALYSIS_LIMITS.symbols) {a.coverage.truncated = true;return;}
    a.symbols.push({name,kind,path:file,line,column,exported,confidence}); definitions.add(`${file}:${line}:${column}`);
  }
  function edge(from:string,specifier:string,line:number) {
    if(a.imports.length >= ANALYSIS_LIMITS.edges) {a.coverage.truncated=true;return;}
    let to:string|undefined; let projected=false;
    try { const resolved=ts.resolveModuleName(specifier,path.resolve(root,from),compilerOptions,host).resolvedModule?.resolvedFileName; if(resolved) to=absPaths.get(lookupFile(resolved)??''); } catch { /* malformed config or unresolved import */ }
    if(!to && outputMapping && specifier.startsWith('.')) {
      const outputPath=path.resolve(root,path.dirname(from),specifier);
      if(within(outputMapping.output,outputPath)) {
        const sourcePath=path.resolve(outputMapping.source,path.relative(outputMapping.output,outputPath));
        const candidates=/\.mjs$/.test(sourcePath)?[sourcePath.replace(/\.mjs$/,'.mts')]:/\.cjs$/.test(sourcePath)?[sourcePath.replace(/\.cjs$/,'.cts')]:/\.jsx?$/.test(sourcePath)?[sourcePath.replace(/\.jsx?$/,'.ts'),sourcePath.replace(/\.jsx?$/,'.tsx')]:[];
        for(const candidate of candidates) {const match=absPaths.get(lookupFile(candidate)??'');if(match){to=match;projected=true;break;}}
      }
    }
    a.imports.push({from,specifier,line,to,confidence:to?(a.bodies.has(to)&&!projected?'resolved':'heuristic'):'unresolved'});
  }
  for(const file of files) {
    const body = a.bodies.get(file.path); if(body === undefined || file.language === 'other') continue;
    if(jsFamily.has(file.language)) {
      try {
        const source = ts.createSourceFile(file.path,body,ts.ScriptTarget.Latest,true);
        const diagnostics = (source as ts.SourceFile & {parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics;
        if(diagnostics?.length) warn('Syntax errors in ' + file.path + '; extracted information may be incomplete.');
        const stack:ts.Node[]=[source];
        while(stack.length) {
          if(++nodes > ANALYSIS_LIMITS.nodes) {a.coverage.truncated=true;break;}
          const node=stack.pop()!;
          const at=(n:ts.Node) => {const p=source.getLineAndCharacterOfPosition(n.getStart(source)); return {line:p.line+1,column:p.character+1};};
          let kind:string|undefined;
          if(ts.isFunctionDeclaration(node)) kind='function'; else if(ts.isClassDeclaration(node)) kind='class'; else if(ts.isInterfaceDeclaration(node)) kind='interface'; else if(ts.isTypeAliasDeclaration(node)) kind='type'; else if(ts.isEnumDeclaration(node)) kind='enum'; else if(ts.isMethodDeclaration(node)||ts.isMethodSignature(node)) kind='method'; else if(ts.isVariableDeclaration(node)) kind=node.initializer && (ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))?'function':'variable';
          const name=(node as ts.NamedDeclaration).name;
          if(kind && name && ts.isIdentifier(name)) {
            const location=at(name); let owner:ts.Node=node;
            if(ts.isVariableDeclaration(node)) owner=node.parent.parent;
            const exported=ts.canHaveModifiers(owner) && (ts.getModifiers(owner)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword) ?? false);
            define(name.text,kind,file.path,location.line,location.column,exported,'syntax');
          }
          if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) {
            if(node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) edge(file.path,node.moduleSpecifier.text,at(node).line);
          } else if(ts.isCallExpression(node) && ((ts.isIdentifier(node.expression)&&node.expression.text==='require')||node.expression.kind===ts.SyntaxKind.ImportKeyword) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) edge(file.path,node.arguments[0].text,at(node).line);
          else if(ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) edge(file.path,node.moduleReference.expression.text,at(node).line);
          if(ts.isIdentifier(node)) {
            if(a.references.length < ANALYSIS_LIMITS.references) a.references.push({name:node.text,path:file.path,...at(node),confidence:'syntax'});
            else a.coverage.truncated=true;
          }
          const children:ts.Node[]=[]; node.forEachChild(child=>{children.push(child);}); stack.push(...children.reverse());
        }
      } catch {warn('Could not parse '+file.path);a.coverage.skipped_files++;a.coverage.truncated=true;}
    } else {
      const clean=masked(body,file.language==='python');
      const lines=clean.split('\n');
      for(const [index,line] of lines.entries()) {
        const pattern=file.language==='python' ? /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/ : /\b(class|interface|struct|enum|trait|protocol|fn|func|function)\s+([A-Za-z_]\w*)/;
        const match=pattern.exec(line);
        if(match) define(match[2],['def','fn','func','function'].includes(match[1])?'function':match[1],file.path,index+1,line.indexOf(match[2],match.index)+1,false,'heuristic');
        for(const ref of line.matchAll(/\b[A-Za-z_]\w*\b/g)) {
          if(a.references.length >= ANALYSIS_LIMITS.references) {a.coverage.truncated=true;break;}
          a.references.push({name:ref[0],path:file.path,line:index+1,column:ref.index!+1,confidence:'heuristic'});
        }
      }
      if(file.language==='python') {
        for(const [index,line] of lines.entries()) {
          const match=/^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w.]+))/.exec(line);
          if(!match || a.imports.length >= ANALYSIS_LIMITS.edges) continue;
          const specifier=match[1] ?? match[2];
          const dots=specifier.match(/^\.+/)?.[0].length ?? 0;
          const module=specifier.slice(dots).replaceAll('.','/');
          let base=dots?path.posix.dirname(file.path):'.';
          for(let i=1;i<dots;i++) base=path.posix.dirname(base);
          let stems=[path.posix.join(base,module)];
          // `from . import sibling` imports the sibling module if present, otherwise __init__.
          if(!module && dots) {
            const imported=/\bimport\s+([A-Za-z_]\w*)/.exec(line)?.[1];
            if(imported) stems.unshift(path.posix.join(base,imported));
          }
          const to=stems.flatMap(s=>[s+'.py',path.posix.join(s,'__init__.py')]).find(p=>resolutionFiles.has(p));
          a.imports.push({from:file.path,specifier,line:index+1,to,confidence:to?'heuristic':'unresolved'});
        }
      }
    }
  }
  if(a.imports.some(e=>!e.to)) warn('Some imports are unresolved (external packages, unsupported aliases, missing files, or scan limits). The impact graph does not cover those edges.');
  a.references=a.references.filter(r=>!definitions.has(`${r.path}:${r.line}:${r.column}`));
  if(a.coverage.truncated) warn('Analysis reached a file/byte/symbol/reference/depth budget. Narrow the project or use search_files/read_file for missing evidence.');
  if(files.some(f=>!jsFamily.has(f.language)&&f.language!=='other')) warn('Non-JavaScript/TypeScript definitions and references are lexical heuristics. Only Python local imports are linked for those languages.');
  warn('References are identifier occurrences, not semantic bindings. Shadowed names may be unrelated. Dynamic imports without literal paths and runtime dispatch are not resolved.');
  return a;
}

function coverage(a:Analysis) {return {...a.coverage,symbols:a.symbols.length,references:a.references.length,imports:a.imports.length,unresolved_imports:a.imports.filter(e=>!e.to).length,limits:ANALYSIS_LIMITS,warnings:a.warnings};}
export async function inspectProject(root:string,offset=0,limit=100) {
  const a=await buildAnalysis(root);
  const projectTypes=new Set<string>();
  for(const f of a.files) {
    const n=path.posix.basename(f.path);
    if(n==='package.json') projectTypes.add('node');
    if(['pyproject.toml','requirements.txt'].includes(n)) projectTypes.add('python');
    if(n==='go.mod') projectTypes.add('go'); if(n==='Cargo.toml') projectTypes.add('rust'); if(/\.(sln|csproj)$/.test(n)) projectTypes.add('dotnet'); if(['pom.xml','build.gradle'].includes(n)) projectTypes.add('java');
  }
  const areas=new Map<string,number>();for(const f of a.files){const area=f.path.includes('/')?f.path.split('/')[0]:'.';areas.set(area,(areas.get(area)??0)+1);}
  return {project_types:[...projectTypes],languages:[...new Set(a.files.map(f=>f.language).filter(l=>l!=='other'))],entrypoints:a.files.filter(f=>f.entrypoint).slice(0,50).map(f=>({path:f.path,reason:'conventional filename',confidence:'heuristic'})),important_files:a.files.filter(f=>f.role==='config').slice(0,50).map(f=>f.path),areas:[...areas].slice(0,100).map(([path,files])=>({path,files})),files:a.files.slice(offset,offset+limit),next_offset:Math.min(a.files.length,offset+limit),has_more:offset+limit<a.files.length,symbols:a.symbols.slice(0,40),symbol_preview_truncated:a.symbols.length>40,imports:a.imports.slice(0,50),import_preview_truncated:a.imports.length>50,coverage:coverage(a)};
}
export async function searchCode(root:string,query:string,kind:'definitions'|'references',offset=0,limit=50,exact=true) {
  const a=await buildAnalysis(root);
  const matches=(kind==='definitions'?a.symbols:a.references).filter(s=>exact?s.name===query:s.name.toLowerCase().includes(query.toLowerCase()));
  return {kind,query,matches:matches.slice(offset,offset+limit),total:matches.length,next_offset:Math.min(matches.length,offset+limit),has_more:offset+limit<matches.length,coverage:coverage(a)};
}

async function gitChanged(root:string,staged:boolean) {
  const options={cwd:root,encoding:'utf8' as const,windowsHide:true,timeout:15000,maxBuffer:512000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}};
  const args=['--no-pager','diff','--relative','--name-only','-z','--no-renames',...(staged?['--cached']:[]),'--'];
  const tracked=(await exec('git',args,options)).stdout.split('\0').filter(Boolean);
  const untracked=staged?[]:(await exec('git',['ls-files','--others','--exclude-standard','-z'],options)).stdout.split('\0').filter(Boolean);
  return [...new Set([...tracked,...untracked])];
}
export async function analyzeChanges(root:string,paths:string[]|undefined,staged=false) {
  const raw=paths ?? await gitChanged(root,staged);
  if(raw.length>1000) throw new Error('Too many changed files; pass an explicit paths list');
  const changed:string[]=[];let excluded=0;
  for(const name of raw) {try {changed.push(posix(path.relative(root,await resolvePath(root,name))));} catch(e){if(paths) throw e;excluded++;}}
  const a=await buildAnalysis(root,changed);
  const reached=new Set(changed);
  const chainConfidence=new Map(changed.map(p=>[p,'resolved']));
  const affected:{path:string;via:string;depth:number;confidence:string}[]=[];
  for(let depth=1;depth<=8;depth++) {
    const frontier=new Set<string>();
    for(const edge of a.imports) if(edge.to && reached.has(edge.to) && !reached.has(edge.from) && !frontier.has(edge.from)) {
      const confidence=edge.confidence==='resolved' && chainConfidence.get(edge.to)==='resolved'?'resolved':'heuristic';
      frontier.add(edge.from);chainConfidence.set(edge.from,confidence);affected.push({path:edge.from,via:edge.to,depth,confidence});
    }
    if(!frontier.size) break;for(const p of frontier) reached.add(p);
  }
  const relatedTests:{path:string;reason:string;confidence:string}[]=[];
  for(const f of a.files.filter(f=>f.role==='test')) {
    if(reached.has(f.path)) relatedTests.push({path:f.path,reason:changed.includes(f.path)?'changed test':'imports a changed or affected module',confidence:changed.includes(f.path)?'changed':chainConfidence.get(f.path)==='resolved'?'resolved_import_chain':'heuristic_import_chain'});
    else if(changed.some(p=>{const stem=path.posix.basename(p).replace(/\.[^.]+$/,'').replace(/\.(test|spec)$/,'');return stem.length>2&&path.posix.basename(f.path).includes(stem);})) relatedTests.push({path:f.path,reason:'filename matches changed source',confidence:'heuristic'});
  }
  const commands:{command:string;cwd:string;source:string;reason:string}[]=[];
  for(const f of a.files.filter(f=>path.posix.basename(f.path)==='package.json')) {
    try {
      const pkg=JSON.parse(a.bodies.get(f.path)??'{}');
      const cwd=path.posix.dirname(f.path);
      if(cwd!=='.' && ![...reached].some(p=>p.startsWith(cwd+'/'))) continue;
      for(const script of ['test','typecheck','lint']) if(typeof pkg.scripts?.[script]==='string') commands.push({command:(process.platform==='win32'?'npm.cmd':'npm')+' run '+script,cwd,source:f.path,reason:'declared script; not executed'});
    } catch { /* invalid manifest is not executable configuration */ }
  }
  const signals=[];
  if(changed.some(p=>/(^|\/)(package(-lock)?\.json|.*lock.*|.*config.*|.*\.csproj|.*\.sln)$/.test(p))) signals.push({kind:'configuration',reason:'Configuration or dependency change may affect files beyond the import graph.'});
  if(changed.some(p=>/auth|permission|credential|migration|schema/i.test(p))) signals.push({kind:'sensitive_area',reason:'Changed path suggests authentication, permissions, or data schema; manual review recommended.'});
  if(affected.some(f=>f.depth===8)) a.warnings.push('Impact traversal reached depth 8; downstream impact may be incomplete.');
  if(staged) a.warnings.push('Changed paths come from the Git index; dependency analysis describes current working-tree contents, not an index snapshot.');
  return {changed_files:changed,excluded_paths:excluded,affected_areas:[...new Set([...changed,...affected.map(f=>f.path)].map(p=>p.includes('/')?p.split('/')[0]:'.'))],dependents:affected.slice(0,200),dependents_truncated:affected.length>200,related_tests:relatedTests.slice(0,100),tests_truncated:relatedTests.length>100,recommended_commands:commands.slice(0,30),review_signals:signals,coverage:coverage(a)};
}
