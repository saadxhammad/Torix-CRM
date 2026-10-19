import {getChatGPTUser} from '@/app/chatgpt-auth';
import {env} from './runtime-env';
import {createDatabase, type SqlStatement} from './sql';
import {createBucket} from './storage';
import {DEFAULT_SETTINGS} from './modules.mjs';
import {capabilities,can,recordAllowed,sanitizedRecord} from './access.mjs';
import {validateFinancialState,summary,normalizedLines,cashCarrying,sumBalance} from './finance.mjs';
export type Item={id:string,kind:string,data:any,archived?:boolean,sourceKey?:string|null,createdAt?:string,updatedAt?:string};
export type Context={ws:string,mode:string,ownerId:string,user:any,access:any,revision:number,records:Item[],events:any[],audit:any[],settings:any};
export const database=()=>createDatabase();
export const bucket=()=>createBucket();
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi'}).format(new Date());
export const clean=(v:unknown,n=500)=>String(v??'').trim().slice(0,n);
export function validDate(v:string){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v}
export const record=(c:Context,id:string,kind?:string)=>c.records.find(r=>r.id===id&&(!kind||r.kind===kind)&&!r.archived);
export function assertOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==new URL(request.url).host)throw new Error('Invalid request origin.');}
export async function context(mode='live',service=false):Promise<Context>{
 if(!/^(live|restored-[a-z0-9-]{8,80})$/.test(mode))throw new Error('Invalid workspace.');
 const user=await getChatGPTUser(),ownerEmail=env.TORIX_OWNER_EMAIL?.toLowerCase();
 if(!ownerEmail)throw new Error('Owner configuration is missing.');
 if(!user&&!service)throw new Error('Sign in to use Torix Solutions.');
 let company:any=await database().prepare('SELECT * FROM companies WHERE id=?').bind('torix-solutions').first();
 if(!company){
  if((!user||user.email.toLowerCase()!==ownerEmail)&&!(service&&env.TORIX_OWNER_ID))throw new Error('The company owner must initialize the workspace first.');
  await database().prepare('INSERT INTO companies (id,owner_id,created_at) VALUES (?,?,?) ON CONFLICT (id) DO NOTHING').bind('torix-solutions',user?.userId||env.TORIX_OWNER_ID,new Date().toISOString()).run();
  company=await database().prepare('SELECT * FROM companies WHERE id=?').bind('torix-solutions').first();
 }
 let access:any;
 if(service||user?.userId===company.owner_id){access={role:'Owner',departments:[],grants:[],employeeId:'',caps:['*']};}
 else{
  const member:any=await database().prepare('SELECT * FROM company_members WHERE company_id=? AND email=? AND active=1').bind('torix-solutions',user!.email.toLowerCase()).first();
  if(!member||member.user_id&&member.user_id!==user!.userId)throw new Error('Your account has not been granted company access.');
  if(!member.user_id)await database().prepare('UPDATE company_members SET user_id=? WHERE id=? AND user_id IS NULL').bind(user!.userId,member.id).run();
  access={role:member.role,departments:JSON.parse(member.departments),grants:JSON.parse(member.grants),employeeId:member.employee_id||'',caps:[]};access.caps=Array.from(capabilities(access));
  if(mode!=='live')throw new Error('Staff accounts use the company workspace.');
 }
 const ws=company.owner_id+':'+mode;
 if(mode.startsWith('restored-')){const existing:any=await database().prepare('SELECT mode FROM workspaces WHERE id=?').bind(ws).first();if(!existing||existing.mode==='restore_pending')throw new Error('The restored workspace is not ready.');}
 await database().prepare('INSERT INTO workspaces (id,user_id,mode,revision) VALUES (?,?,?,0) ON CONFLICT (id) DO NOTHING').bind(ws,company.owner_id,mode).run();
 const r=await database().batch([
 database().prepare('SELECT revision FROM workspaces WHERE id=?').bind(ws),
 database().prepare('SELECT * FROM records WHERE workspace_id=? ORDER BY created_at DESC').bind(ws),
 database().prepare('SELECT * FROM finance_events WHERE workspace_id=? ORDER BY event_date,created_at,id').bind(ws),
 database().prepare('SELECT * FROM audit_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 150').bind(ws),
 ]);
 const records:Item[]=r[1].results.map((x:any)=>({id:x.id,kind:x.kind,data:JSON.parse(x.payload),archived:!!x.archived,sourceKey:x.source_key,createdAt:x.created_at,updatedAt:x.updated_at}));
 const settings={...DEFAULT_SETTINGS,...records.find(x=>x.kind==='settings'&&!x.archived)?.data,companyName:'Torix Solutions'};
 return {ws,mode,ownerId:company.owner_id,user:user||{userId:'service',email:'service',displayName:'Scheduled maintenance'},access,revision:Number((r[0].results[0] as any).revision),records,settings,events:r[2].results.map((e:any)=>({id:e.id,kind:e.kind,amount:e.amount,date:e.event_date,department:e.department,clientId:e.client_id||'',orderId:e.order_id||'',person:e.person||'',note:e.note,ledger:JSON.parse(e.ledger),reverses:e.reverses,meta:JSON.parse(e.meta||'{}'),createdAt:e.created_at})),audit:r[3].results.map((a:any)=>({action:a.action,recordId:a.record_id,detail:a.detail,createdAt:a.created_at,actor:a.actor}))};
}
export function exposed(c:Context,month=""){
 const full=can(c.access,'*'),finance=can(c.access,'finance.read'),dept=can(c.access,'finance.department'),allocations=c.records.filter(r=>r.kind==='allocation'&&!r.archived).map(r=>r.data);
 const records=c.records.filter(r=>recordAllowed(c.access,r,c.records)).map(r=>{const safe=sanitizedRecord(c.access,r),d=safe.data;if(r.kind==='invoice'&&r.data.status==='Issued'){const due=sumBalance(c.events,'receivable',{ref:r.id,currency:d.currency}),credited=c.records.filter(x=>x.kind==='credit'&&x.data.status==='Posted'&&x.data.invoiceId===r.id).reduce((n,x)=>n+x.data.amount,0);d.outstanding=due;d.paymentStatus=credited>=d.amount?'Credited':due===0?'Paid':due<d.amount-credited?'Partly paid':'Unpaid';}if(r.kind==='payroll'&&d.status==='Posted'){d.lines=d.lines.map((l:any)=>({...l,outstanding:0-sumBalance(c.events,'payroll_payable',{ref:r.id,currency:d.currency,party:l.employeeId})}));d.outstanding=d.lines.reduce((n:number,l:any)=>n+l.outstanding,0);d.paymentStatus=!d.outstanding?'Paid':d.outstanding<d.net?'Partly paid':'Unpaid';}if(r.kind==='bill'&&d.status==='Posted'){d.outstanding=0-sumBalance(c.events,'payable',{ref:r.id,currency:d.currency});d.paymentStatus=!d.outstanding?'Paid':d.outstanding<d.amount?'Partly paid':'Unpaid';}return safe;});
 const financial=full||finance||dept;
 const events=(full||finance?c.events:dept?c.events.filter(e=>c.access.departments.includes(e.department)):[]).map(e=>{
  if(full||can(c.access,'owner.finance'))return e;
  if(['owner_loan','loan_repayment','capital','drawing','owner_repayment'].includes(e.kind))return null;
  return {...e,person:'',ledger:e.ledger.filter((l:any)=>!['owner_due','owner_loan','equity'].includes(l.account)).map((l:any)=>({...l,party:['owner_due','owner_loan','equity'].includes(l.account)?'':l.party}))};
 }).filter(Boolean);
 const metrics:any={};if(financial)for(const d of ['All departments',...c.settings.departments]){if(full||finance||c.access.departments.includes(d)){metrics[d]=summary(c.events,month,d,allocations);if(!full&&!finance)for(const key of ['cash','available','receivable','unbilled','ownerDue','ownerLoan','clientAdvance','clientFunds','clientCredit','payables','payrollDue'])delete metrics[d][key];if(!full&&!can(c.access,'owner.finance')){delete metrics[d].ownerDue;delete metrics[d].ownerLoan;}}}
 if(financial&&!full&&!finance)metrics['All departments']=Object.values(metrics).reduce((t:any,m:any)=>({revenue:t.revenue+m.revenue,expenses:t.expenses+m.expenses,profit:t.profit+m.profit,fx:t.fx+m.fx}),{revenue:0,expenses:0,profit:0,fx:0});
 return {ws:c.ws,revision:c.revision,records,events,audit:full?c.audit:[],settings:full?c.settings:{...c.settings,bankDetails:'',approvalLimits:undefined},access:{...c.access,caps:Array.from(c.access.caps)},metrics,financial,mode:c.mode};
}
export class Change {
 original:Item[];c:Context;rows=new Map<string,Item>();newEvents:any[]=[];action:string;requestId:string;detail='';
 constructor(c:Context,action:string,requestId:string){this.original=structuredClone(c.records);this.c={...c,records:structuredClone(c.records),events:structuredClone(c.events)};this.action=action;this.requestId=clean(requestId,120);if(this.requestId.length<12)throw new Error('Missing request ID.');}
 put(kind:string,data:any,id:string=crypto.randomUUID(),sourceKey?:string|null){let r=this.c.records.find(x=>x.id===id);if(r&&r.kind!==kind)throw new Error('Record type conflict.');if(!r){r={id,kind,data,sourceKey:sourceKey||null,archived:false,createdAt:new Date().toISOString()};this.c.records.push(r)}else r.data=data;r.updatedAt=new Date().toISOString();if(sourceKey)r.sourceKey=sourceKey;this.rows.set(id,r);return r;}
 archive(id:string){const r=record(this.c,id);if(!r)throw new Error('Record not found.');r.archived=true;r.updatedAt=new Date().toISOString();this.rows.set(id,r);}
 event(kind:string,amount:number,date:string,ledger:any[],meta:any={},id:string=crypto.randomUUID()){
  if(!validDate(date)||date>today())throw new Error('Use a valid posting date today or earlier.');
  if(this.c.records.some(r=>r.kind==='period'&&r.data.status==='Closed'&&r.data.month===date.slice(0,7)))throw new Error('This financial period is closed.');
  const e={id,kind,amount,date,department:meta.department||'Corporate',clientId:meta.clientId||'',orderId:meta.orderId||'',person:meta.person||'',note:meta.note||kind,meta,ledger:kind==='reversal'?ledger:cashCarrying(ledger,this.c.events),reverses:meta.reverses||null,createdAt:new Date().toISOString()};this.newEvents.push(e);this.c.events.push(e);return e;
 }
 async commit(){
  const {c}=this,db=database(),op=c.ws+':'+this.requestId;
  const exists=await db.prepare('SELECT id FROM operations WHERE id=? AND workspace_id=?').bind(op,c.ws).first();if(exists)return;
  if(!this.rows.size&&!this.newEvents.length)return;
  validateFinancialState(c.events);
  const guard='EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=?)',stmts:SqlStatement[]=[],now=new Date().toISOString();
  for(const r of this.rows.values()){
   if(c.records.filter(x=>x.id===r.id).length!==1)throw new Error('Duplicate record ID.');
   const isExisting=await db.prepare('SELECT id FROM records WHERE id=? AND workspace_id=?').bind(r.id,c.ws).first();
   if(isExisting)stmts.push(db.prepare(`UPDATE records SET payload=?,archived=?,updated_at=?,source_key=? WHERE id=? AND workspace_id=? AND ${guard}`).bind(JSON.stringify(r.data),r.archived?1:0,now,r.sourceKey||null,r.id,c.ws,c.ws,c.revision));
   else stmts.push(db.prepare(`INSERT INTO records (id,workspace_id,kind,payload,archived,created_at,updated_at,source_key) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(r.id,c.ws,r.kind,JSON.stringify(r.data),r.archived?1:0,r.createdAt||now,now,r.sourceKey||null,c.ws,c.revision));
  }
  for(const e of this.newEvents)stmts.push(db.prepare(`INSERT INTO finance_events (id,workspace_id,kind,amount,event_date,department,client_id,order_id,person,note,ledger,reverses,created_at,meta) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(e.id,c.ws,e.kind,e.amount,e.date,e.department,e.clientId||null,e.orderId||null,e.person||null,e.note,JSON.stringify(e.ledger),e.reverses||null,now,JSON.stringify(e.meta||{}),c.ws,c.revision));
  const changes=Array.from(this.rows.values()).map(r=>({id:r.id,kind:r.kind,before:this.original.find(x=>x.id===r.id)?.data||null,after:r.data,archived:!!r.archived}));
  stmts.push(db.prepare(`INSERT INTO audit_events (id,workspace_id,action,record_id,detail,created_at,actor) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),c.ws,this.action,this.rows.keys().next().value||this.newEvents[0]?.id||c.ws,JSON.stringify({note:this.detail||this.action,changes,events:this.newEvents.map(e=>e.id)}),now,c.user.email,c.ws,c.revision));
  stmts.push(db.prepare(`INSERT INTO operations (id,workspace_id,created_at) SELECT ?,?,? WHERE ${guard}`).bind(op,c.ws,now,c.ws,c.revision));
  stmts.push(db.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=? AND revision=?').bind(c.ws,c.revision));
  if(stmts.length>95)throw new Error('This operation is too large. Use a smaller batch of up to 30 records.');
  const result=await db.batch(stmts);if(!result[0].meta.changes)throw new Error('Another user saved a change first. Refresh and try again.');
 }
}
export function checkScope(c:Context,r:Item){if(!recordAllowed(c.access,r,c.records))throw new Error('This record is outside your access scope.');}
export function ensureDate(date:string,label='Date'){if(!validDate(date))throw new Error(label+' is invalid.');return date;}
