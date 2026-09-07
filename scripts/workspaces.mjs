import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';

function inputPath(value, baseDir) {
  let text=value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text=text.slice(1,-1);
  if (text==='~') text=os.homedir();
  else if (/^~[/\\]/.test(text)) text=path.join(os.homedir(),text.slice(2));
  return path.resolve(baseDir,text);
}
async function directory(value,baseDir) {
  const target=inputPath(value,baseDir);
  const real=await fs.realpath(target);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('폴더가 아닙니다');
  return real;
}
const errorMessage=error=>error?.code==='ENOENT'?'폴더를 찾을 수 없습니다':error?.code==='EACCES'?'폴더에 접근할 수 없습니다':error?.message??String(error);

/** Edits a draft list only. Cancellation never changes the supplied roots or saved config. */
export async function editWorkspaces(initialRoots,ask,print, {baseDir=process.cwd(),firstRun=false}={}) {
  const roots=[...initialRoots];
  if(firstRun) {
    while(true) {
      const answer=await ask(`처음 사용할 작업 폴더 (Enter: ${roots[0]}): `);
      if(answer===undefined)return {start:false,roots:initialRoots};
      try{roots.splice(0,roots.length,await directory(answer.trim()?answer:roots[0],baseDir));break;}
      catch(error){print(`등록 실패: ${errorMessage(error)}. 경로를 다시 입력하세요.`);}
    }
  }
  while(true) {
    print('\n등록된 워크스페이스');
    for(const [index,root] of roots.entries()) {
      const available=await fs.stat(root).then(s=>s.isDirectory(),()=>false);
      print(`  [${index}] ${root}${available?'':'  (현재 접근 불가)'}`);
    }
    print('Enter/S: 서버 시작 | A: 추가 | E: 경로 변경 | R: 등록 해제 | Q: 종료');
    print('변경은 서버 시작을 선택할 때 저장됩니다. 등록 해제는 폴더의 파일을 삭제하지 않습니다.');
    const answer=await ask('선택: ');
    if(answer===undefined||answer.trim().toUpperCase()==='Q')return {start:false,roots:initialRoots};
    const action=answer.trim().toUpperCase();
    if(action===''||action==='S') {
      if(roots.length<1||roots.length>32){print('워크스페이스는 1개 이상 32개 이하여야 합니다. 목록을 수정하세요.');continue;}
      let invalid=false;
      for(const root of roots)try{await directory(root,baseDir);}catch(error){invalid=true;print(`${root}: ${errorMessage(error)}. 경로를 변경하거나 등록을 해제하세요.`);}
      if(!invalid)return {start:true,roots};
      continue;
    }
    if(!['A','E','R'].includes(action)){print('Enter, S, A, E, R, Q 중에서 선택하세요.');continue;}
    if(action==='A'&&roots.length>=32){print('최대 32개까지 등록할 수 있습니다.');continue;}
    let index;
    if(action!=='A') {
      const chosen=await ask('워크스페이스 번호 (0부터, Enter: 취소): ');
      if(chosen===undefined)return {start:false,roots:initialRoots};
      if(!chosen.trim())continue;
      index=/^\d+$/.test(chosen.trim())?Number(chosen):NaN;
      if(!Number.isSafeInteger(index)||index<0||index>=roots.length){print('목록에 있는 번호를 입력하세요.');continue;}
    }
    if(action==='R') {
      if(roots.length===1){print('워크스페이스는 최소 하나가 필요합니다. 먼저 추가하거나 경로를 변경하세요.');continue;}
      roots.splice(index,1);continue;
    }
    const value=await ask('폴더 경로 (한 번에 하나, Enter: 취소): ');
    if(value===undefined)return {start:false,roots:initialRoots};
    if(!value.trim())continue;
    try {
      const target=await directory(value,baseDir);
      const existing=await Promise.all(roots.map(p=>fs.realpath(p).catch(()=>path.resolve(baseDir,p))));
      const duplicate=existing.findIndex((p,i)=>p===target&&i!==index);
      if(duplicate>=0){print(`이미 [${duplicate}]에 등록된 폴더입니다.`);continue;}
      if(action==='A')roots.push(target);else roots[index]=target;
    } catch(error){print(`등록 실패: ${errorMessage(error)}. 기존 목록을 유지합니다.`);}
  }
}

export async function manageWorkspaces(roots,options) {
  const rl=createInterface({input:process.stdin,output:process.stdout,terminal:!!(process.stdin.isTTY&&process.stdout.isTTY)});
  const lines=rl[Symbol.asyncIterator]();
  rl.on('SIGINT',()=>rl.close());
  const ask=async message=>{if(rl.terminal){rl.setPrompt(message);rl.prompt();}else process.stdout.write(message);const next=await lines.next();return next.done?undefined:next.value;};
  try{return await editWorkspaces(roots,ask,message=>console.log(message),options);}
  finally{rl.close();}
}
