import { z } from 'zod';
const id=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/);
const outcome=z.enum(['completed','failed','unknown']);
export const dataSchemas = {
  'task/opened': z.object({title:z.string(),workspace_key:hash,workspace_path:z.string(),automatic:z.boolean(),owner:z.literal('local-owner')}),
  'tool/requested': z.object({name:z.string(),input_hash:hash,input_ref:id,idempotency_key:z.string().optional()}),
  'tool/completed': z.object({ok:z.boolean(),result_ref:id}),
  'process/started': z.object({process_id:id,pid:z.number().int().positive().optional(),output_ref:id,command:z.string(),cwd:z.string()}),
  'process/stopping': z.object({process_id:id,reason:z.enum(['cancelled','timeout','shutdown'])}),
  'process/exited': z.object({process_id:id,state:z.enum(['completed','failed','stopped','timed_out','unknown']),exit_code:z.number().int().nullable(),signal:z.string().nullable(),output_ref:id,recording_error:z.string().optional()}),
  'artifact/created': z.object({artifact_id:id,kind:z.enum(['input','result','output','diff'])}),
  'artifact/sealed': z.object({artifact_id:id,bytes:z.number().int().nonnegative(),total_bytes:z.number().int().nonnegative(),truncated:z.boolean(),sha256:hash}),
  'file/planned': z.object({changes:z.array(z.object({path:z.string(),before_hash:hash.nullable(),after_hash:hash.nullable(),diff_ref:id,diff_complete:z.boolean()}))}),
  'file/changed': z.object({plan_seq:z.number().int().nonnegative()}),
  'context/provided': z.object({kind:z.enum(['instructions','skill']),path:z.string(),sha256:hash,partial:z.boolean(),result_ref:id}),
  'task/recovered': z.object({operation_ids:z.array(id),process_ids:z.array(id),truncated_bytes:z.number().int().nonnegative()}),
  'task/closed': z.object({outcome,summary:z.string(),reported_by:z.enum(['client','server'])}),
};
export type EventType=keyof typeof dataSchemas;
export type Data<K extends EventType>=z.infer<(typeof dataSchemas)[K]>;
export type HistoryEvent={ [K in EventType]: {v:1;task_id:string;seq:number;time:string;type:K;operation_id?:string;data:Data<K>;prev_hash:string|null;hash:string} }[EventType];
export const envelope=z.object({v:z.literal(1),task_id:id,seq:z.number().int().nonnegative(),time:z.string().datetime(),type:z.string(),operation_id:id.optional(),data:z.unknown(),prev_hash:hash.nullable(),hash});
export type OperationContext={taskId:string;operationId:string;workspaceKey:string};
export type ProcessView={process_id:string;task_id:string;operation_id:string;state:string;exit_code:number|null;signal:string|null;output_ref:string;command:string;cwd:string;pid?:number;started_at:string;ended_at?:string;recording_error?:string};
export function project(events:readonly HistoryEvent[]) {
  const first=events[0];if(!first || first.type!=='task/opened') throw new Error('History must start with task/opened');
  const operations:Record<string,{name:string;state:string;input_hash:string;input_ref:string;result_ref?:string;idempotency_key?:string}>={};
  const processes:Record<string,ProcessView>={};
  const artifacts:Record<string,{kind:string;bytes?:number;total_bytes?:number;truncated?:boolean;sha256?:string}>={};
  const contexts:Record<string,string>={};const fileChanges:Data<'file/planned'>['changes']=[];
  let closed:Data<'task/closed'>|undefined;
  for(const e of events) switch(e.type) {
    case 'tool/requested': if(e.operation_id) operations[e.operation_id]={...e.data,state:'pending'};break;
    case 'tool/completed': if(e.operation_id && operations[e.operation_id]) Object.assign(operations[e.operation_id],{state:e.data.ok?'completed':'failed',result_ref:e.data.result_ref});break;
    case 'process/started': processes[e.data.process_id]={...e.data,task_id:e.task_id,operation_id:e.operation_id!,state:'running',exit_code:null,signal:null,started_at:e.time};break;
    case 'process/stopping': if(processes[e.data.process_id]) processes[e.data.process_id].state='stopping';break;
    case 'process/exited': if(processes[e.data.process_id]) Object.assign(processes[e.data.process_id],e.data,{ended_at:e.time});break;
    case 'artifact/created': artifacts[e.data.artifact_id]={kind:e.data.kind};break;
    case 'artifact/sealed': if(artifacts[e.data.artifact_id]) Object.assign(artifacts[e.data.artifact_id],e.data);break;
    case 'context/provided': contexts[e.data.kind+':'+e.data.path]=e.data.sha256;break;
    case 'file/changed': {const plan=events[e.data.plan_seq];if(plan?.type==='file/planned')fileChanges.push(...plan.data.changes);break;}
    case 'task/recovered':
      for(const id of e.data.operation_ids) if(operations[id]) operations[id].state='unknown';
      for(const id of e.data.process_ids) if(processes[id]) processes[id].state='unknown';break;
    case 'task/closed': closed=e.data;break;
    case 'task/opened': case 'file/planned':break;
  }
  const pending=Object.values(operations).some(o=>o.state==='pending');
  const running=Object.values(processes).some(p=>['running','stopping'].includes(p.state));
  const unknown=Object.values(operations).some(o=>o.state==='unknown') || Object.values(processes).some(p=>p.state==='unknown');
  return {task_id:first.task_id,...first.data,created_at:first.time,updated_at:events.at(-1)!.time,as_of_seq:events.length-1,status:closed?.outcome ?? (running||pending?'running':unknown?'needs_review':'open'),closed,operations,processes,artifacts,contexts,file_changes:fileChanges};
}
