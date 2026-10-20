export const runtime = "nodejs";
import {context,exposed,Change,database,record,clean,today,assertOrigin} from '@/lib/server';
import {saveRecord,archiveRecord,approveOperational,memberAction,reference} from '@/lib/operations';
import {postSimple,saveInvoice,issue,approveFinancial,postCredit,postExpenseOrBill,payBillAction,preparePayroll,updatePayroll,payrollAction,allocateCosts,periodAction,postTransfer,reconcile,nextNumber} from '@/lib/finance-actions';
import {saveCostSchedule,postScheduledCost,generateCycle,createBackup,restoreBackup,importPreview,commitImport,alerts} from '@/lib/maintenance';
import {can,requireCap,recordAllowed} from '@/lib/access.mjs';
import {parseMoney} from '@/lib/domain.mjs';
import {sampleWorkspace} from '@/lib/seed.mjs';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){try{const mode=new URL(request.url).searchParams.get('mode')||'live',c=await context(mode),out:any=exposed(c,new URL(request.url).searchParams.get('month')||'');out.alerts=alerts(c).filter(a=>{const r=record(c,a.id);return r&&recordAllowed(c.access,r,c.records)});if(can(c.access,'settings')){const rows=await database().prepare('SELECT id,email,role,departments,grants,employee_id,active FROM company_members WHERE company_id=?').bind('torix-solutions').all();out.members=rows.results.map((m:any)=>({...m,departments:JSON.parse(m.departments),grants:JSON.parse(m.grants)}));out.workspaces=(await database().prepare("SELECT mode FROM workspaces WHERE user_id=? AND mode LIKE 'restored-%'").bind(c.ownerId).all()).results.map((r:any)=>r.mode);}return json(out)}catch(e){const error=e instanceof Error?e.message:'Could not load workspace.';return json({error},/Sign in/.test(error)?401:/access|owner|granted/i.test(error)?403:400)}}
export async function POST(request:Request){try{
 assertOrigin(request);const text=await request.text();if(text.length>1600000)return json({error:'Request is too large.'},413);const body=JSON.parse(text),mode=body.mode||'live',c=await context(mode),requestId=clean(body.requestId||crypto.randomUUID(),120);
 const duplicate=await database().prepare('SELECT id FROM operations WHERE id=? AND workspace_id=?').bind(c.ws+':'+requestId,c.ws).first();if(duplicate)return json(exposed(c));
 if(body.action==='member'){await memberAction(c,body.data||{});return json(exposed(await context(mode)));}
 if(body.action==='import_preview')return json(await importPreview(c,body.data||{}));
 if(body.action==='backup'){const id=await createBackup(c,'Torix Solutions manual backup');return json({...exposed(await context(mode)),createdBackup:id});}
 if(body.action==='restore'){const result=await restoreBackup(c,body.id);return json({...exposed(await context(result.mode)),restoredMode:result.mode});}
 const ch=new Change(c,body.action,requestId),input=body.data||{};
 if(body.action==='seed'){
  requireCap(c.access,'*');
  if(c.records.some(r=>!r.archived&&r.kind!=='settings'))throw new Error('Sample data can only be loaded into an empty workspace. Archive or clear demo records first.');
  const s=sampleWorkspace(new Date().toISOString());
  for(const r of s.records)ch.put(r.kind,r.data,r.id);
  for(const e of s.events){ch.newEvents.push({...e});ch.c.events.push({...e});}
  ch.detail='Loaded Torix sample company data';
 }else if(body.action==='save'){
  if(body.kind==='invoice')saveInvoice(ch,input,body.id);
  else if(body.kind==='payroll'){if(body.id)updatePayroll(ch,body.id,input);else preparePayroll(ch,input);}
  else if(body.kind==='allocation')allocateCosts(ch,input,body.id);
  else if(body.kind==='costschedule')saveCostSchedule(ch,input,body.id);
  else if(body.kind==='credit'){
   requireCap(c.access,'finance.write');const inv=reference(c,input.invoiceId,'invoice')!,l=inv.data.lines.find((l:any)=>l.id===input.lineId)||inv.data.lines[0],number=body.id?reference(c,body.id,'credit')!.data.number:nextNumber(c,'credit','TX-CN');const old=body.id?record(c,body.id,'credit'):null;if(old?.data.status==='Posted')throw new Error('Posted credit notes are locked.');ch.put('credit',{name:number,number,invoiceId:inv.id,lineId:l.id,net:parseMoney(input.net),amount:parseMoney(input.net),currency:inv.data.currency,department:l.department,clientId:inv.data.clientId,reason:clean(input.reason,1000),status:'Draft'},body.id);
  }else saveRecord(ch,clean(body.kind),input,body.id);
 }else if(body.action==='archive')archiveRecord(ch,body.id);
 else if(body.action==='post')postSimple(ch,input);
 else if(body.action==='void_source'){
  requireCap(c.access,'finance.approve');const r=reference(c,body.id)!;if(!['bill','expense','payroll'].includes(r.kind)||r.data.status!=='Posted')throw new Error('Choose a posted cost or payroll.');if(!input.note)throw new Error('A correction reason is required.');if(c.events.some(e=>e.meta?.targetId===r.id&&['bill_payment','payroll_payment'].includes(e.kind))||c.records.some(x=>x.kind==='costschedule'&&x.data.sourceId===r.id&&x.data.postedPeriods?.length))throw new Error('This source has dependent payments or scheduled cost postings. Record a correcting adjustment instead.');const originals=c.events.filter(e=>e.meta?.targetId===r.id&&e.kind===r.kind);if(!originals.length)throw new Error('Source posting not found.');for(const e of originals){if(c.events.some(x=>x.reverses===e.id))throw new Error('Source already reversed.');ch.event('reversal',e.amount,today(),e.ledger.map((l:any)=>({...l,amount:-l.amount,units:-(l.units??l.amount)})),{...e.meta,reverses:e.id,note:'Source correction: '+clean(input.note)});}ch.put(r.kind,{...r.data,status:'Cancelled',correctionReason:clean(input.note),cancelledBy:c.user.email},r.id);for(const schedule of c.records.filter(x=>x.kind==='costschedule'&&x.data.sourceId===r.id&&!x.data.postedPeriods?.length))ch.put('costschedule',{...schedule.data,status:'Cancelled'},schedule.id);ch.detail='Reversed source '+r.kind;
 }else if(body.action==='transfer')postTransfer(ch,input);
 else if(body.action==='import')await commitImport(ch,input);
 else if(body.action==='period')periodAction(ch,input);
 else if(body.action==='reconcile')reconcile(ch,body.id,input.eventId||'');
 else if(body.action==='clock_in'){
  if(!can(c.access,'attendance.own')&&!can(c.access,'attendance.write')&&!can(c.access,'*'))throw new Error('Attendance permission is required.');const employeeId=input.employeeId||c.access.employeeId;if(!can(c.access,'attendance.write')&&!can(c.access,'*')&&employeeId!==c.access.employeeId)throw new Error('Choose your own employee profile.');saveRecord(ch,'attendance',{name:'Clock in',employeeId,date:today(),clockIn:new Date().toISOString(),breakMinutes:0,status:'In progress'});
 }else if(body.action==='clock_out'){
  const attendance=reference(c,body.id,'attendance')!;saveRecord(ch,'attendance',{...attendance.data,clockOut:new Date().toISOString(),breakMinutes:input.breakMinutes||0,status:'Submitted'},attendance.id);
 }else if(body.action==='reverse'){
  requireCap(c.access,'finance.approve');const e=c.events.find(e=>e.id===body.eventId);if(!e||e.kind==='reversal'||c.events.some(x=>x.reverses===e.id))throw new Error('Transaction is missing or already reversed.');if(['invoice','credit','payroll','bill','expense','scheduled_cost'].includes(e.kind))throw new Error('Use the source document correction workflow for this posting.');if(!body.reason)throw new Error('A correction reason is required.');ch.event('reversal',e.amount,today(),e.ledger.map((l:any)=>({...l,amount:-l.amount,units:-(l.units??l.amount)})),{...e.meta,department:e.department,clientId:e.clientId,orderId:e.orderId,person:e.person,reverses:e.id,note:'Reversal: '+clean(body.reason)});ch.detail='Recorded financial reversal';
 }else if(body.action==='transition'){
  const r=reference(c,body.id)!,action=clean(body.transition);
  if(r.kind==='payroll')payrollAction(ch,r.id,action,input);
  else if(r.kind==='invoice'){
   if(action==='issue')issue(ch,r.id);else if(action==='approve'||action==='reject')approveFinancial(ch,r.id,action,input.note||'');else if(action==='submit'){requireCap(c.access,'finance.write');if(r.data.status!=='Draft')throw new Error('Only draft invoices can be submitted.');ch.put('invoice',{...r.data,status:'Submitted'},r.id);}else if(action==='earn')postSimple(ch,{...input,kind:'earned',invoiceId:r.id,clientId:r.data.clientId,currency:r.data.currency,rate:r.data.rate/1000000,note:input.note||'Approved service earning'});else if(action==='receive')postSimple(ch,{...input,kind:'collection',invoiceId:r.id,clientId:r.data.clientId,currency:r.data.currency,note:input.note||'Invoice payment '+r.data.number});else throw new Error('Unknown invoice action.');
  }else if(r.kind==='credit'&&action==='post')postCredit(ch,{},r.id);
  else if(['expense','bill'].includes(r.kind)){
   if(action==='post')postExpenseOrBill(ch,r.id);else if(action==='pay')payBillAction(ch,r.id,input);else if(action==='approve'||action==='reject')approveFinancial(ch,r.id,action,input.note||'');else if(action==='submit'){if(!can(c.access,'finance.write')&&r.data.employeeId!==c.access.employeeId)throw new Error('Not permitted.');ch.put(r.kind,{...r.data,status:'Submitted'},r.id);}else throw new Error('Unknown cost action.');
  }else if(['contract','subscription'].includes(r.kind)&&action==='generate')generateCycle(ch,r.id);
  else if(r.kind==='costschedule'){
   requireCap(c.access,'finance.approve');if(action==='activate')ch.put('costschedule',{...r.data,status:'Active',approvedBy:c.user.email},r.id);else if(action==='pause')ch.put('costschedule',{...r.data,status:'Paused'},r.id);else if(action==='post')postScheduledCost(ch,r.id);else throw new Error('Unknown cost schedule action.');
  }else if(r.kind==='lead'&&action==='convert'){
   requireCap(c.access,'sales.write');const client=ch.put('client',{name:r.data.name,contact:r.data.contact,email:r.data.email,phone:r.data.phone,department:r.data.department,status:'Active'});ch.put('lead',{...r.data,stage:'Won',clientId:client.id},r.id);if(r.data.value)ch.put('order',{name:r.data.name+' services',clientId:client.id,department:r.data.department,amount:r.data.value,currency:r.data.currency||'PKR',date:today(),due:today(),status:'Draft',model:'Fixed project',scope:r.data.note||'',sourceLeadId:r.id});
  }else if(r.kind==='tender'&&action==='award'){
   requireCap(c.access,'sales.write');const client=input.clientId?reference(c,input.clientId,'client')!:ch.put('client',{name:r.data.organization,department:r.data.department,status:'Active'});ch.put('order',{name:r.data.name,clientId:client.id,department:r.data.department,amount:r.data.amount,currency:r.data.currency,date:today(),due:input.due||today(),status:'Draft',model:'Fixed project',scope:r.data.checklist||'',tenderId:r.id});ch.put('tender',{...r.data,status:'Won'},r.id);
  }else approveOperational(ch,r.id,action,input.note||'');
 }else throw new Error('Unsupported action.');
 await ch.commit();const out:any=exposed(await context(mode));return json(out);
 }catch(e){const error=e instanceof Error?e.message:'Could not save changes.';return json({error},/Sign in/.test(error)?401:/permit|access|role|permission/i.test(error)?403:/saved a change first/.test(error)?409:400)}}
