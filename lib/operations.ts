import {can,requireCap,recordAllowed,inDepartment} from './access.mjs';
import {MODULES,MONEY_FIELDS,DEFAULT_SETTINGS} from './modules.mjs';
import {parseMoney} from './domain.mjs';
import {zeroMoney,rateMicros,attendanceDuration,localTimestamp,leaveUnits,parseCSV,sumBalance,normalizedLines} from './finance.mjs';
import {Change,Context,record,checkScope,clean,ensureDate,today,database} from './server';
import {syncAttendanceFields} from './attendance.mjs';
import {approveLeave,enrichLeaveOnSave,saveLeaveGrant} from './people-actions';
import {ensureMemberPasswordColumn,hashPassword,validateLoginPassword,verifyPassword} from './passwords';
export function reference(c:Context,id:string,kind?:string,required=true){const r=record(c,id,kind);if(!r&&required)throw new Error('Choose a valid '+(kind||'record')+'.');if(r)checkScope(c,r);return r;}
function number(value:any,min=0,max=1e8){const n=Number(value||0);if(!Number.isFinite(n)||n<min||n>max)throw new Error('Numeric value is outside its permitted range.');return n;}
export function canEdit(c:Context,kind:string,data:any){
 if(can(c.access,'*'))return;
 if(kind==='settings'){requireCap(c.access,'settings');return;}
 if(kind==='task'&&can(c.access,'work.own')&&data.assignee===c.access.employeeId)return;
 if(kind==='worklog'&&can(c.access,'work.own')&&data.employeeId===c.access.employeeId)return;
 if(kind==='attendance'&&(can(c.access,'attendance.write')||can(c.access,'attendance.approve')||can(c.access,'attendance.own')&&data.employeeId===c.access.employeeId))return;
 if(['leave','allowance','leavegrant','leaveledger'].includes(kind)&&(can(c.access,'leave.admin')||can(c.access,'leave.approve')||kind==='leave'&&can(c.access,'leave.own')&&data.employeeId===c.access.employeeId))return;
 if(kind==='expense'&&(can(c.access,'finance.write')||can(c.access,'expense.own')&&data.employeeId===c.access.employeeId))return;
 const built:any={client:'sales.write',order:'sales.write',staff:'people.write',task:'work.write',amendment:'sales.write',costschedule:'finance.write',holiday:'people.write'};
 const cfg:any=Object.values(MODULES).find((m:any)=>m.kind===kind);requireCap(c.access,built[kind]||cfg?.write||'settings');
 if(data.department&&!inDepartment(c.access,data.department))throw new Error('This department is outside your access scope.');
}
export function saveRecord(change:Change,kind:string,input:any,id?:string,sourceKey?:string){
 const c=change.c,old=id?reference(c,id,kind):undefined;if(old&&['Posted','Issued','Credited','Closed'].includes(old.data.status))throw new Error('Posted or issued records require their correction workflow.');
 let data:any={};const cfg:any=Object.values(MODULES).find((m:any)=>m.kind===kind);
 if(cfg){for(const field of cfg.fields){const [key,label,type,required]=field;const v=input[key];if(required&&(v==null||v===''))throw new Error(label+' is required.');if(type==='money')data[key]=zeroMoney(v);else if(type==='number')data[key]=number(v);else if(type==='checkbox')data[key]=v===true||v==='on'||v==='true';else data[key]=clean(v,type==='textarea'?5000:500);if(type==='date'&&data[key])ensureDate(data[key],label);}}
 else if(!['client','order','staff','task','amendment','costschedule','holiday','settings'].includes(kind))throw new Error('Unsupported record type.');
 if(['client','order','staff','task'].includes(kind)){
  for(const key of ['name','department','status','email','contact','phone','role','clientId','orderId','assignee','model','scope','paymentTerms','acceptance','priority','date','due','joinDate','salaryEffective','shiftId','currency','bankDetails'])data[key]=clean(input[key],['scope','paymentTerms','acceptance'].includes(key)?5000:500);
  if(!data.name)throw new Error('Name is required.');
  if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw new Error('Use a valid email address.');
  if(kind==='staff'){
   if(data.email)data.email=String(data.email).trim().toLowerCase();
   // Never persist plaintext login passwords on the staff HR record.
   delete data.loginPassword;delete data.password;delete data.passwordHash;
   data.salary=zeroMoney(input.salary);data.currency=input.currency==='USD'?'USD':'PKR';data.status=input.status==='Inactive'?'Inactive':'Active';data.joinDate=input.joinDate?ensureDate(input.joinDate):today();
   data.managerId=clean(input.managerId);if(data.managerId){if(data.managerId===(id||'self'))throw new Error('An employee cannot be their own manager.');reference(c,data.managerId,'staff');}
   data.probationStart=input.probationStart?ensureDate(input.probationStart):'';data.probationEnd=input.probationEnd?ensureDate(input.probationEnd):'';
   if(data.probationStart&&data.probationEnd&&data.probationEnd<data.probationStart)throw new Error('Probation end must follow the start date.');
   data.allocations=input.allocations?typeof input.allocations==='string'?JSON.parse(input.allocations):input.allocations:[{department:data.department,percent:100}];
   if(Math.round(data.allocations.reduce((n:number,a:any)=>n+Number(a.percent),0)*100)!==10000||data.allocations.some((a:any)=>!c.settings.departments.includes(a.department)||Number(a.percent)<0))throw new Error('Salary allocation percentages must total 100.');
   data.salaryHistory=old?.data.salaryHistory||[];if(!old||old.data.salary!==data.salary||old.data.currency!==data.currency){const effective=input.salaryEffective?ensureDate(input.salaryEffective):today();if(old&&!data.salaryHistory.length)data.salaryHistory.push({effective:old.data.joinDate||'2000-01-01',salary:old.data.salary,currency:old.data.currency||'PKR'});data.salaryHistory.push({effective,salary:data.salary,currency:data.currency});}
  }
  if(kind==='order'){
   const client=reference(c,data.clientId,'client')!;data.amount=parseMoney(input.amount);data.currency=input.currency==='USD'?'USD':'PKR';ensureDate(data.date);ensureDate(data.due);if(data.due<data.date)throw new Error('Due date must follow the order date.');
   if(!['Draft','Submitted','Active','On hold','Completed','Cancelled'].includes(data.status))data.status='Draft';if(!can(c.access,'finance.approve')&&!can(c.access,'*')&&!['Draft','Submitted'].includes(data.status))throw new Error('Commercial terms need approval. Submit this order for review.');
   if(old&&c.events.some(e=>e.orderId===old.id)){if(old.data.currency!==data.currency||old.data.clientId!==data.clientId||old.data.department!==data.department)throw new Error('Financial history locks the order currency, client and department.');const earned=0-normalizedLines(c.events).filter((l:any)=>l.orderId===old.id&&l.account==='revenue').reduce((n:number,l:any)=>n+l.units,0);if(data.amount<earned)throw new Error('Order value cannot be less than earned service.');}
   data.salesOwner=clean(input.salesOwner)||old?.data.salesOwner||c.access.employeeId;data.versions=[...(old?.data.versions||[])];if(old&&(old.data.amount!==data.amount||old.data.scope!==data.scope))data.versions.push({date:today(),amount:old.data.amount,scope:old.data.scope,actor:c.user.email});
   data.clientName=client.data.name;
  }
  if(kind==='task'){
   const order=reference(c,data.orderId,'order')!;data.department=order.data.department;if(data.assignee)reference(c,data.assignee,'staff');ensureDate(data.due);if(!['To do','In progress','Waiting','In review','Done','Cancelled'].includes(data.status))data.status='To do';
   if(!can(c.access,'work.write')&&old){if(old.data.assignee!==c.access.employeeId)throw new Error('Only your assigned task can be updated.');data={...old.data,status:data.status};}
  }
 }
 if(input.currency&&!['PKR','USD'].includes(input.currency))throw new Error('Choose PKR or USD.');
 if(['expense','bill','subscription','contract'].includes(kind)&&data.currency==='USD'&&!input.rate)throw new Error('Enter the booked PKR per USD exchange rate.');
 if(data.currency){data.currency=input.currency||'PKR';data.rate=data.currency==='PKR'?1000000:rateMicros(input.rate||'1');}
 if(['proposal','expense','bill'].includes(kind)){data.status=old?.data.status||'Draft';if(input.status==='Submitted')data.status='Submitted';}
 if(['proposal','contract'].includes(kind)&&data.clientId)reference(c,data.clientId,'client');
 if(['proposal','tender'].includes(kind)&&!data.amount)throw new Error('Enter an amount.');
 if(kind==='lead'){if(!data.nextFollowup&&!['Won','Lost'].includes(data.stage))throw new Error('Set a follow up date for an active lead.');if(!can(c.access,'*')&&!data.salesOwner)data.salesOwner=c.access.employeeId;}
 if(['contract','milestone','worklog','amendment'].includes(kind)){
  const order=reference(c,data.orderId||input.orderId,'order')!;data.orderId=order.id;data.department=order.data.department;data.clientId=order.data.clientId;data.currency=order.data.currency||'PKR';
  if(kind==='contract'){
   if(!can(c.access,'finance.approve')&&!['Paused','Cancelled','Completed'].includes(data.status))data.status='Draft';if(can(c.access,'finance.approve')&&data.status==='Active')data.approvedBy=c.user.email;
   data.dueDays=number(input.dueDays||14,0,365);data.rate=data.currency==='PKR'?1000000:rateMicros(input.rate||'1');if(!data.amount)throw new Error('Enter the cycle fee.');if(data.endDate&&data.endDate<data.nextDate)throw new Error('Contract end date is before its next cycle.');
  }
  if(kind==='milestone'){if(data.status==='Accepted')throw new Error('Use the acceptance action for approval.');}
  if(kind==='worklog'){reference(c,data.employeeId,'staff');data.minutes=number(input.minutes,1,1440);if(data.date>today())throw new Error('Work date cannot be in the future.');if(!can(c.access,'work.write')){data.employeeId=c.access.employeeId;data.status='Submitted';}else if(data.status==='Approved')data.status='Submitted';}
  if(kind==='amendment'){data={name:clean(input.name)||'Order amendment',orderId:order.id,department:order.data.department,clientId:order.data.clientId,amount:parseMoney(input.amount),scope:clean(input.scope,5000),reason:clean(input.reason,3000),status:'Submitted'};if(!data.reason)throw new Error('Explain the commercial change.');}
 }
 if(kind==='attendance'){
  const employee=reference(c,data.employeeId,'staff')!;data.department=employee.data.department;
  if(!can(c.access,'attendance.write')&&!can(c.access,'attendance.approve')){if(data.employeeId!==c.access.employeeId)throw new Error('Only your own attendance can be submitted.');}
  // Prefer event payload when provided; otherwise build legacy clock fields
  if(Array.isArray(input.events)&&input.events.length){data.events=input.events;syncAttendanceFields(data);}
  else{
   if(input.clockIn)data.clockIn=toTimestamp(input.clockIn);if(input.clockOut)data.clockOut=toTimestamp(input.clockOut);
   data.breakMinutes=number(input.breakMinutes||0,0,1440);
   if(data.clockIn&&data.clockOut)Object.assign(data,attendanceDuration(data.clockIn,data.clockOut,data.breakMinutes));
   else if(data.clockIn){data.status='In progress';data.workedMinutes=0;data.events=[{id:crypto.randomUUID(),type:'clock_in',at:data.clockIn}];}
  }
  data.shiftId=input.shiftId||employee.data.shiftId||old?.data.shiftId||'';if(old&&old.data.status==='Approved'&&!data.reason)throw new Error('A correction reason is required.');
  data.status=data.clockOut?'Submitted':(data.status||'In progress');
  if(data.shiftId&&data.clockIn){const shift=reference(c,data.shiftId,'shift')!;const scheduled=Date.parse(localTimestamp(data.date,shift.data.startTime));data.lateMinutes=Math.max(0,Math.round((Date.parse(data.clockIn)-scheduled)/60000)-Number(shift.data.graceMinutes??c.settings.graceMinutesDefault??15));}
  if(data.clockIn&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi'}).format(new Date(data.clockIn))!==data.date)throw new Error('Assign the shift to its Karachi start date.');
  for(const r of c.records.filter(r=>r.kind==='attendance'&&!r.archived&&r.id!==id&&r.data.employeeId===data.employeeId&&r.data.status!=='Rejected')){
   if(!r.data.clockOut&&!data.clockOut)throw new Error('This employee already has an open shift.');if(r.data.clockIn&&data.clockIn&&Date.parse(data.clockIn)<Date.parse(r.data.clockOut||'9999-01-01')&&Date.parse(data.clockOut||'9999-01-01')>Date.parse(r.data.clockIn))throw new Error('Attendance overlaps an existing shift.');
  }
 }
 if(kind==='leave'){
  const employee=reference(c,data.employeeId,'staff')!;data.department=employee.data.department;if(!can(c.access,'leave.approve')&&!can(c.access,'leave.admin')&&data.employeeId!==c.access.employeeId)throw new Error('Only your own leave may be requested.');
  if(data.start.slice(0,4)!==(data.end||data.start).slice(0,4))throw new Error('Use separate leave requests for each calendar year.');
  enrichLeaveOnSave(c,data);
  if(!data.units&&!data.quarters)throw new Error('This leave range contains no working time.');
  if(c.records.some(r=>r.kind==='leave'&&!r.archived&&r.id!==id&&r.data.employeeId===data.employeeId&&!['Rejected','Cancelled','Withdrawn'].includes(r.data.status)&&r.data.start<=data.end&&r.data.end>=data.start))throw new Error('Leave overlaps another request.');
  data.name=data.name||`${data.type} leave ${data.start}`;
 }
 if(kind==='allowance'){if(!can(c.access,'leave.admin')&&!can(c.access,'*'))throw new Error('Only HR or Owner can change leave allowances.');const employee=reference(c,data.employeeId,'staff')!;data.department=employee.data.department;data.year=number(input.year,2020,2100);data.days=number(input.days,0,366);}
 if(kind==='leavegrant'){return saveLeaveGrant(change,input,id);}
 if(kind==='leaveledger'){if(!can(c.access,'leave.admin')&&!can(c.access,'*'))throw new Error('Only HR or Owner can post leave ledger entries.');const employee=reference(c,data.employeeId,'staff')!;data.department=employee.data.department;data.units=number(input.units,1,366*4);data.entryType=clean(input.entryType||'manual');data.direction=input.direction==='debit'?'debit':'credit';data.date=ensureDate(input.date||today());data.reason=clean(input.reason,1000);if(!data.reason)throw new Error('A reason is required.');data.name=data.name||`${data.entryType} ${data.date}`;data.status='Posted';}
 if(kind==='expense'){
  data.employeeId=input.employeeId||c.access.employeeId||'';if(data.employeeId)reference(c,data.employeeId,'staff');if(data.orderId){const o=reference(c,data.orderId,'order')!;data.department=o.data.department;}
  if(!data.amount)throw new Error('Enter an expense amount.');if(data.date>today())throw new Error('Use a date today or earlier.');data.person=clean(input.person,120);if(data.paidBy==='Owner'&&!data.person)throw new Error('Enter the owner name.');
  if(!can(c.access,'finance.write')){data.employeeId=c.access.employeeId;data.paidBy='Employee';data.status='Submitted';}
 }
 if(kind==='bill'){reference(c,data.vendorId,'vendor');if(!data.amount)throw new Error('Enter a bill amount.');if(data.due<data.date)throw new Error('Due date must follow service date.');}
 if(kind==='bank'){data.ledgerKey=old?.data.ledgerKey||id||'';if(old&&old.data.currency!==data.currency&&normalizedLines(c.events).some((l:any)=>l.account==='cash'&&l.accountId===(old.data.ledgerKey||old.id)))throw new Error('An account with transactions keeps its currency.');}
 if(kind==='shift'){for(const k of ['startTime','endTime'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data[k]))throw new Error('Choose a valid shift time.');data.breakMinutes=number(input.breakMinutes||0,0,720);data.graceMinutes=number(input.graceMinutes??c.settings.graceMinutesDefault??15,0,180);data.paidBreaks=input.paidBreaks===true||input.paidBreaks==='on'||input.paidBreaks==='true';data.allowMultipleBreaks=input.allowMultipleBreaks!==false&&input.allowMultipleBreaks!=='off'&&input.allowMultipleBreaks!=='false';}
 if(kind==='subscription'){reference(c,data.vendorId,'vendor');data.remindDays=number(input.remindDays||7,0,365);if(!data.amount)throw new Error('Enter the renewal amount.');}
 if(kind==='holiday'){data={name:clean(input.name),date:ensureDate(input.date),department:'Corporate'};}
 if(kind==='settings'){
  requireCap(c.access,'settings');data={...c.settings};for(const k of ['address','email','phone','taxId','invoicePrefix','bankDetails','paymentTerms'])data[k]=clean(input[k],5000);data.companyName='Torix Solutions';
  data.departments=Array.from(new Set(String(input.departments||c.settings.departments.join('\n')).split(/[\n,]/).map(x=>x.trim()).filter(Boolean)));if(!data.departments.includes('Corporate'))data.departments.push('Corporate');if(data.departments.length>30)throw new Error('Use at most 30 departments.');
  const used=new Set(c.records.map(r=>r.data.department).filter(Boolean));if(Array.from(used).some(d=>!data.departments.includes(d)))throw new Error('Keep departments that already have records.');
  data.payrollDays=number(input.payrollDays||30,1,31);data.defaultLeaveDays=number(input.defaultLeaveDays||0,0,366);data.probationLeaveDays=number(input.probationLeaveDays||3,0,30);data.partialAbsenceThreshold=number(input.partialAbsenceThreshold||3,1,4);data.graceMinutesDefault=number(input.graceMinutesDefault||15,0,180);data.workingDays=String(input.workingDays||'1,2,3,4,5').split(',').map(Number);if(data.workingDays.some((d:number)=>!Number.isInteger(d)||d<0||d>6))throw new Error('Working days must be weekday numbers 0 to 6.');
  data.autoIssueInvoices=input.autoIssueInvoices===true||input.autoIssueInvoices==='on';data.maintenanceEnabled=input.maintenanceEnabled===true||input.maintenanceEnabled==='on';id=c.records.find(r=>r.kind==='settings')?.id||c.ws+':settings';
 }
 if(data.department&&!c.settings.departments.includes(data.department)&&kind!=='settings')throw new Error('Choose a configured department.');
 canEdit(c,kind,data);if(old&&old.kind==='task'&&!recordAllowed(c.access,old,c.records))throw new Error('This task is outside your access.');
 const result=change.put(kind,data,id,sourceKey);change.detail=(old?'Updated ':'Created ')+kind+': '+(data.name||data.number||result.id);return result;
}
export function toTimestamp(input:string){if(!input)throw new Error('Clock in is required.');if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input))return localTimestamp(input.slice(0,10),input.slice(11,16));const n=new Date(input);if(!Number.isFinite(n.getTime()))throw new Error('Invalid timestamp.');return n.toISOString();}
export function approveOperational(change:Change,id:string,action:string,note=''){
 const c=change.c,r=reference(c,id)!;const d={...r.data};
 if(r.kind==='leave'&&['approve','reject','cancel','withdraw'].includes(action)){
  approveLeave(change,id,action,note);return;
 }
 if(['attendance','worklog'].includes(r.kind)){
  const cap=r.kind==='attendance'?'attendance.approve':'work.write';requireCap(c.access,cap);if(d.employeeId===c.access.employeeId&&!can(c.access,'*'))throw new Error('Your own request needs another approver.');
  if(r.kind==='attendance'&&action==='approve'&&!d.clockOut)throw new Error('Complete clock out before approval.');d.status=action==='reject'?'Rejected':'Approved';
 }else if(r.kind==='proposal'||r.kind==='order'||r.kind==='amendment'){
  requireCap(c.access,'finance.approve');if(!note.trim())throw new Error('Record the approval or rejection evidence.');d.status=action==='reject'?'Rejected':r.kind==='proposal'?'Accepted':r.kind==='order'?'Active':'Approved';
  if(r.kind==='amendment'&&action!=='reject'){const o=reference(c,d.orderId,'order')!;change.put('order',{...o.data,amount:d.amount,scope:d.scope,versions:[...(o.data.versions||[]),{date:today(),amount:o.data.amount,scope:o.data.scope,reason:d.reason}]},o.id);}
 }else if(r.kind==='milestone'){requireCap(c.access,'work.write');if(!note)throw new Error('Record acceptance evidence.');d.status=action==='reject'?'Rejected':'Accepted';}
 else if(r.kind==='contract'&&['pause','resume','approve'].includes(action)){requireCap(c.access,action==='pause'?'sales.write':'finance.approve');d.status=action==='pause'?'Paused':'Active';}
 else throw new Error('This action is not available for this record.');
 d.approvedBy=c.user.email;d.approvedAt=new Date().toISOString();d.approvalNote=note;change.put(r.kind,d,r.id);change.detail=action+' '+r.kind;
}
/**
 * When Team saves an employee with an email, grant Staff login access.
 * Never downgrade an existing elevated role (HR/Finance/…).
 * Optional loginPassword (Admin/HR) sets or resets the member password hash.
 */
export async function ensureStaffLoginAccess(c:Context,staff:{id:string,data:any},loginPassword?:string){
 if(!can(c.access,'*')&&!can(c.access,'people.write')&&!can(c.access,'leave.admin'))return;
 const email=String(staff.data?.email||'').trim().toLowerCase();
 if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return;
 await ensureMemberPasswordColumn(database());
 const department=staff.data.department&&c.settings.departments.includes(staff.data.department)?staff.data.department:'Corporate';
 const existing:any=await database().prepare('SELECT * FROM company_members WHERE company_id=? AND email=?').bind('torix-solutions',email).first();
 const elevated=existing?.role&&!['Staff',''].includes(String(existing.role));
 const keepRole=elevated?String(existing.role):'Staff';
 let departments:string[]=[];
 try{departments=existing?.departments?JSON.parse(existing.departments):[department];}catch{departments=[department];}
 if(!departments.includes(department))departments.push(department);
 let grants:any[]=[];
 try{grants=existing?.grants?JSON.parse(existing.grants):[];}catch{grants=[];}
 const active=staff.data.status==='Inactive'?0:1;
 const pwd=validateLoginPassword(loginPassword||'',{required:!existing});
 const passwordHash=pwd?hashPassword(pwd):(existing?.password_hash||null);
 const id=existing?.id||crypto.randomUUID();
 await database().prepare('INSERT INTO company_members (id,company_id,email,user_id,role,departments,grants,employee_id,password_hash,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,email) DO UPDATE SET employee_id=excluded.employee_id,active=excluded.active,departments=excluded.departments,role=excluded.role,password_hash=COALESCE(excluded.password_hash,company_members.password_hash),updated_at=excluded.updated_at').bind(id,'torix-solutions',email,existing?.user_id||null,keepRole,JSON.stringify(departments),JSON.stringify(grants),staff.id,passwordHash,active,new Date().toISOString()).run();
 if(pwd){
  await database().prepare('UPDATE company_members SET password_hash=?,updated_at=? WHERE company_id=? AND email=?').bind(passwordHash,new Date().toISOString(),'torix-solutions',email).run();
 }
 await database().prepare('INSERT INTO audit_events (id,workspace_id,action,record_id,detail,created_at,actor) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),c.ws,'member',staff.id,'Ensured Staff login for '+email+' → employee '+staff.id+(pwd?' (password set)':''),new Date().toISOString(),c.user.email).run();
}

export async function memberAction(c:Context,input:any){
 requireCap(c.access,'settings');const email=clean(input.email,200).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Use a valid staff email.');
 const roles=['Owner','Finance','HR','Department head','Sales','Project manager','Staff','Reviewer'];if(!roles.includes(input.role))throw new Error('Choose a valid role.');
 await ensureMemberPasswordColumn(database());
 const existing:any=await database().prepare('SELECT * FROM company_members WHERE company_id=? AND email=?').bind('torix-solutions',email).first();
 const employee=input.employeeId?reference(c,input.employeeId,'staff'):null;
 const departments=Array.isArray(input.departments)?input.departments:String(input.departments||'').split(',').filter(Boolean);if(departments.some((d:string)=>!c.settings.departments.includes(d)))throw new Error('Choose configured departments.');
 if(['Staff','Sales','Department head','Project manager'].includes(input.role)&&!employee)throw new Error('Link this account to its employee profile.');
 const grants=(Array.isArray(input.grants)?input.grants:[]).filter((g:string)=>['salary.read','owner.finance','finance.read','finance.department','finance.approve','payroll.approve'].includes(g));
 const pwd=validateLoginPassword(input.loginPassword||'',{required:!existing});
 const passwordHash=pwd?hashPassword(pwd):(existing?.password_hash||null);
 await database().prepare('INSERT INTO company_members (id,company_id,email,user_id,role,departments,grants,employee_id,password_hash,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,email) DO UPDATE SET role=excluded.role,departments=excluded.departments,grants=excluded.grants,employee_id=excluded.employee_id,active=excluded.active,password_hash=COALESCE(excluded.password_hash,company_members.password_hash),updated_at=excluded.updated_at').bind(existing?.id||crypto.randomUUID(),'torix-solutions',email,existing?.user_id||null,input.role,JSON.stringify(departments),JSON.stringify(grants),employee?.id||null,passwordHash,input.active===false?0:1,new Date().toISOString()).run();
 if(pwd){
  await database().prepare('UPDATE company_members SET password_hash=?,updated_at=? WHERE company_id=? AND email=?').bind(passwordHash,new Date().toISOString(),'torix-solutions',email).run();
 }
 await database().prepare('INSERT INTO audit_events (id,workspace_id,action,record_id,detail,created_at,actor) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),c.ws,'member',existing?.id||email,'Changed company access for '+email+(pwd?' (password set)':''),new Date().toISOString(),c.user.email).run();
}

/** Employee changes their own password (requires current password when a hash already exists). */
export async function changeOwnPassword(c:Context,input:any){
 await ensureMemberPasswordColumn(database());
 const email=String(c.user.email||'').toLowerCase();
 if(!email)throw new Error('Sign in again to change your password.');
 const member:any=await database().prepare('SELECT * FROM company_members WHERE company_id=? AND email=? AND active=1').bind('torix-solutions',email).first();
 if(!member)throw new Error('Your account is not linked to workspace access.');
 const current=String(input.currentPassword||'');
 const next=validateLoginPassword(input.newPassword,{required:true});
 if(input.newPassword!==input.confirmPassword)throw new Error('New password and confirmation do not match.');
 if(member.password_hash){
  if(!verifyPassword(current,member.password_hash))throw new Error('Current password is incorrect.');
 }else{
  // Legacy shared-password accounts: accept current staff/owner env password once, then set personal hash.
  const {env}=await import('./runtime-env');
  const legacy=env.TORIX_STAFF_PASSWORD||env.TORIX_OWNER_PASSWORD||'';
  if(!current||current!==legacy)throw new Error('Current password is incorrect.');
 }
 const passwordHash=hashPassword(next);
 await database().prepare('UPDATE company_members SET password_hash=?,updated_at=? WHERE id=?').bind(passwordHash,new Date().toISOString(),member.id).run();
 await database().prepare('INSERT INTO audit_events (id,workspace_id,action,record_id,detail,created_at,actor) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),c.ws,'member',member.id,'Password changed by account holder',new Date().toISOString(),email).run();
}
export function archiveRecord(change:Change,id:string){const c=change.c,r=reference(c,id)!;canEdit(c,r.kind,r.data);if(['Posted','Issued'].includes(r.data.status))throw new Error('Posted records use their source correction workflow.');if(['invoice','credit','bill','payroll','period','allocation','settings','backup'].includes(r.kind))throw new Error('Financial records use their correction workflow.');if(r.kind==='client'){
 if(['receivable','unbilled','advance','client_credit','ad_funds'].some(a=>Math.abs(sumBalance(c.events,a,{party:id},true))>0))throw new Error('Settle client balances before archiving.');if(c.records.some(x=>x.kind==='order'&&!x.archived&&x.data.clientId===id&&!['Completed','Cancelled'].includes(x.data.status)))throw new Error('Complete or cancel open orders first.');}
 if(r.kind==='order'&&c.records.some(x=>x.kind==='task'&&!x.archived&&x.data.orderId===id&&!['Done','Cancelled'].includes(x.data.status)))throw new Error('Complete or cancel open tasks first.');change.archive(id);change.detail='Archived '+r.kind;
}
