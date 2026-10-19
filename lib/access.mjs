export const ROLES=['Owner','Finance','HR','Department head','Sales','Project manager','Staff','Reviewer'];
export const ROLE_CAPS={
 Owner:['*'],Finance:['sales.read','work.read','people.read','salary.read','finance.read','finance.write','payroll.read','payroll.prepare','documents.read','documents.write','reports.read','imports','vendors.write'],
 HR:['people.read','people.write','salary.read','attendance.read','attendance.write','attendance.approve','leave.read','leave.approve','payroll.read','payroll.prepare','documents.read','documents.hr'],
 'Department head':['sales.read','sales.write','work.read','work.write','people.read','attendance.read','attendance.approve','leave.read','leave.approve','finance.department','reports.read','documents.read','documents.write'],
 Sales:['sales.read','sales.write','work.read','documents.read','documents.write'],
 'Project manager':['sales.read','work.read','work.write','people.read','documents.read','documents.write'],
 Staff:['work.own','people.own','attendance.own','leave.own','payroll.own','expense.own','documents.own'],Reviewer:['sales.read','work.read','people.read','reports.read','finance.department','documents.read'],
};
export function capabilities(member){const caps=new Set(ROLE_CAPS[member.role]||[]);if(member.employeeId)for(const cap of ROLE_CAPS.Staff)caps.add(cap);for(const grant of member.grants||[])if(['salary.read','owner.finance','finance.read','finance.department','finance.approve','payroll.approve'].includes(grant))caps.add(grant);return caps}
export function can(access,cap){const caps=access.caps instanceof Set?access.caps:new Set(access.caps||[]);return caps.has('*')||caps.has(cap)}
export function inDepartment(access,department){return can(access,'*')||['Owner','Finance','HR'].includes(access.role)||(access.departments||[]).includes(department)}
export function recordAllowed(access,row,records){
 const d=row.data||{},kind=row.kind;if(can(access,'*'))return true;
 const lookup=id=>records.find(r=>r.id===id),own=d.employeeId===access.employeeId||row.id===access.employeeId;
 const dept=d.department||(kind==='task'?lookup(d.orderId)?.data.department:undefined)||'Corporate';
 if(kind==='settings'||kind==='department'||kind==='service')return true;
 if(kind==='member'||kind==='backup'||kind==='integration'||kind==='period'||kind==='allocation')return can(access,'finance.read')&&kind!=='member'&&kind!=='integration'&&kind!=='backup';
 if(kind==='staff')return (can(access,'people.read')&&inDepartment(access,dept))||(can(access,'people.own')&&own);
 if(['attendance','leave','allowance','worklog'].includes(kind))return (own&&(can(access,'attendance.own')||can(access,'leave.own')||can(access,'work.own')))||((can(access,'attendance.read')||can(access,'work.read')||can(access,'leave.read'))&&inDepartment(access,lookup(d.employeeId)?.data.department||dept));
 if(kind==='payroll')return can(access,'payroll.read')||(d.status==='Posted'&&(d.lines||[]).some(l=>l.employeeId===access.employeeId)&&can(access,'payroll.own'));
 if(kind==='expense')return can(access,'finance.read')||(d.employeeId===access.employeeId&&can(access,'expense.own'));
 if(['invoice','credit','bill','bank','statement','cycle'].includes(kind))return can(access,'finance.read')||(kind==='cycle'&&can(access,'sales.read')&&inDepartment(access,dept));
 if(['lead','proposal','tender','client','order','contract','amendment'].includes(kind)){
  if(can(access,'sales.read')&&inDepartment(access,dept))return access.role!=='Sales'||!d.salesOwner||d.salesOwner===access.employeeId;
  if(can(access,'work.own')&&(kind==='client'||kind==='order')){const assignedOrders=new Set(records.filter(r=>r.kind==='task'&&r.data.assignee===access.employeeId&&!r.archived).map(r=>r.data.orderId));return kind==='order'?assignedOrders.has(row.id):records.some(r=>r.kind==='order'&&assignedOrders.has(r.id)&&r.data.clientId===row.id)}return false;
 }
 if(['task','milestone','revision'].includes(kind))return (can(access,'work.read')&&inDepartment(access,dept))||(can(access,'work.own')&&d.assignee===access.employeeId);
 if(kind==='document'){
  if(d.visibility==='HR')return can(access,'documents.hr')||(d.employeeId===access.employeeId&&can(access,'documents.own'));
  if(d.visibility==='Finance')return can(access,'finance.read');
  if(d.parentId){const parent=lookup(d.parentId);if(!parent||parent.kind==='document'||!recordAllowed(access,parent,records))return false;}
  return (can(access,'documents.read')&&inDepartment(access,dept))||(d.employeeId===access.employeeId&&can(access,'documents.own'));
 }
 if(kind==='costschedule')return can(access,'finance.read');
 if(['vendor','asset','subscription','shift','holiday','notification'].includes(kind))return kind==='notification'?(!d.employeeId||own):can(access,'people.read')||can(access,'finance.read')||can(access,'documents.read');
 return false;
}
export function sanitizedRecord(access,row){const r=structuredClone(row);if(r.kind==='staff'&&!can(access,'salary.read')&&r.id!==access.employeeId){delete r.data.salary;delete r.data.bankDetails;delete r.data.allocations;delete r.data.salaryHistory;}
 if(r.kind==='order'&&!can(access,'sales.read')){delete r.data.amount;delete r.data.rate;delete r.data.paymentTerms;}
 if(r.kind==='payroll'&&!can(access,'payroll.read')){r.data.lines=(r.data.lines||[]).filter(l=>l.employeeId===access.employeeId);r.data.gross=r.data.lines.reduce((n,l)=>n+l.gross,0);r.data.net=r.data.lines.reduce((n,l)=>n+l.net,0);}
 if(r.kind==='settings'&&!can(access,'settings')){delete r.data.approvalLimits;delete r.data.bankDetails;}
 return r;
}
export function requireCap(access,cap){if(!can(access,cap))throw new Error('Your role does not permit this action.');}
