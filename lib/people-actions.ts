import {can,requireCap} from './access.mjs';
import {Change,Context,clean,today,record,checkScope} from './server';
import {
  appendAttendanceEvent,karachiDate,lateMinutesFor,openAttendanceFor,syncAttendanceFields,deriveSession,
} from './attendance.mjs';
import {
  classifyAttendanceSession,employeePartialLedger,hasApprovedLeaveOn,isNonWorkingDate,planPartialEntry,
  leaveRequestQuarters,daysToQuarters,quartersToDays,
} from './partial-absence.mjs';
import {
  allocateFifo,availableQuarters,balanceSummary,effectiveAvailable,expireGrantEntries,grantStatus,
  inProbation,grantsToExpire,PROBATION_QUARTERS,
} from './leave-balance.mjs';

function reference(c:Context,id:string,kind?:string,required=true){
  const r=record(c,id,kind);if(!r&&required)throw new Error('Choose a valid '+(kind||'record')+'.');if(r)checkScope(c,r);return r;
}

function isManagerEmployee(c:Context,employeeId:string){
  if(!employeeId)return false;
  if(c.records.some(r=>r.kind==='staff'&&!r.archived&&r.data.managerId===employeeId&&r.data.status!=='Inactive'))return true;
  // Department heads linked to this staff profile are treated as managers for leave routing
  return false;
}

export function requireLeaveAdmin(c:Context){
  if(!can(c.access,'*')&&!can(c.access,'leave.admin'))throw new Error('Only HR or Owner can perform this leave admin action.');
}

export function clockAction(change:Change,action:string,input:any){
  const c=change.c;
  if(!can(c.access,'attendance.own')&&!can(c.access,'attendance.write')&&!can(c.access,'*'))throw new Error('Attendance permission is required.');
  const now=new Date().toISOString();
  const date=karachiDate(now);

  // For break/clock_out, resolve the open session first so employeeId can come from the record.
  let open:any=null;
  if(action!=='clock_in'){
    open=input.id?reference(c,input.id,'attendance'):null;
    if(open&&open.data.status!=='In progress')throw new Error('Attendance session is not in progress.');
  }
  const employeeId=input.employeeId||open?.data?.employeeId||c.access.employeeId;
  if(!employeeId)throw new Error('Link your account to an employee profile first.');
  if(!can(c.access,'attendance.write')&&!can(c.access,'*')&&employeeId!==c.access.employeeId)throw new Error('Choose your own employee profile.');
  const employee=reference(c,employeeId,'staff')!;
  // Prefer explicit → open session → employee default → first active company shift (portal check-in).
  let shiftId=input.shiftId||open?.data?.shiftId||employee.data.shiftId||'';
  if(!shiftId){
    const fallback=c.records.find(r=>r.kind==='shift'&&!r.archived&&r.data.startTime==='19:00')
      ||c.records.find(r=>r.kind==='shift'&&!r.archived);
    if(fallback)shiftId=fallback.id;
  }
  const shift=shiftId?reference(c,shiftId,'shift',false):null;
  const allowMultiple=shift?.data?.allowMultipleBreaks!==false;
  const paidBreaks=!!shift?.data?.paidBreaks;

  if(action==='clock_in'){
    if(openAttendanceFor(c.records,employeeId))throw new Error('This employee already has an open shift.');
    const base:any={name:'Attendance '+date,employeeId,department:employee.data.department,date,shiftId,events:[],status:'In progress'};
    const data=appendAttendanceEvent(base,'clock_in',now,{allowMultipleBreaks:allowMultiple,paidBreaks});
    data.lateMinutes=lateMinutesFor(data.clockIn,date,shift);
    data.classification=data.lateMinutes>0?'Late':'On time';
    change.put('attendance',data);
    change.detail='Clocked in';
    return;
  }

  if(!open)open=openAttendanceFor(c.records,employeeId);
  if(!open)throw new Error('No open attendance session.');
  if(open.data.employeeId!==employeeId&&!can(c.access,'attendance.write')&&!can(c.access,'*'))throw new Error('Not your attendance session.');
  const eventType=action==='break_start'?'break_start':action==='break_end'?'break_end':'clock_out';
  const data=appendAttendanceEvent({...open.data,events:open.data.events||[]},eventType,now,{allowMultipleBreaks:allowMultiple,paidBreaks});
  if(!data.lateMinutes&&data.clockIn)data.lateMinutes=lateMinutesFor(data.clockIn,open.data.date,shift);
  syncAttendanceFields(data);
  change.put('attendance',data,open.id);
  change.detail=action.replace('_',' ');
  if(eventType==='clock_out')classifyAndCharge(change,open.id);
}

export function classifyAndCharge(change:Change,attendanceId:string){
  const c=change.c;
  const att=reference(c,attendanceId,'attendance')!;
  if(att.data.partialCharged)return;
  const shift=att.data.shiftId?reference(c,att.data.shiftId,'shift',false):null;
  const holidays=c.records.filter(r=>r.kind==='holiday'&&!r.archived).map(r=>r.data.date);
  const exempt=hasApprovedLeaveOn(c.records,att.data.employeeId,att.data.date)
    ||isNonWorkingDate(att.data.date,c.settings.workingDays,holidays);
  const cls=classifyAttendanceSession(att.data,shift,{onApprovedLeave:exempt,isHoliday:holidays.includes(att.data.date),isNonWorking:exempt});
  const updated={...att.data,classification:cls.label,missedMinutes:(cls as any).missed||0};
  if(cls.exception){updated.classification='Exception';change.put('attendance',updated,att.id);return;}
  if(cls.skipLedger||!cls.units){change.put('attendance',{...updated,partialCharged:true},att.id);return;}
  const prior=employeePartialLedger(c.records,att.data.employeeId);
  // Exclude already-charged entries for this same attendance
  if(c.records.some(r=>r.kind==='leaveledger'&&r.data.sourceId===att.id&&!r.data.reversed)){
    change.put('attendance',{...updated,partialCharged:true},att.id);return;
  }
  const plan=planPartialEntry(prior,cls.units);
  if(plan.toCharge>0){
    change.put('leaveledger',{
      name:`Partial absence ${att.data.date}`,
      employeeId:att.data.employeeId,
      department:att.data.department,
      entryType:'partial',
      leaveType:'Annual',
      units:cls.units,
      charged:plan.toCharge,
      direction:'debit',
      date:att.data.date,
      sourceId:att.id,
      reason:cls.label,
      status:'Posted',
    });
  }
  if(plan.penalty>0){
    change.put('leaveledger',{
      name:`Partial threshold penalty ${att.data.date}`,
      employeeId:att.data.employeeId,
      department:att.data.department,
      entryType:'penalty',
      leaveType:'Annual',
      units:plan.penalty,
      charged:plan.penalty,
      direction:'debit',
      date:att.data.date,
      sourceId:att.id,
      reason:'Three-quarter partial-absence threshold reconciled to one full day',
      status:'Posted',
    });
  }
  change.put('attendance',{...updated,partialCharged:true,partialUnits:cls.units},att.id);
}

export function convertLate(change:Change,attendanceIds:string[],reason:string){
  const c=change.c;
  requireLeaveAdmin(c);
  if(!reason)throw new Error('A conversion reason is required.');
  const ids=Array.isArray(attendanceIds)?attendanceIds:[attendanceIds];
  if(!ids.length)throw new Error('Select at least one late attendance entry.');
  for(const id of ids){
    const att=reference(c,id,'attendance')!;
    if(!(att.data.lateMinutes>0))throw new Error('Select only late attendance entries.');
    if(c.records.some(r=>r.kind==='leaveledger'&&!r.archived&&!r.data.reversed&&r.data.entryType==='late_conversion'&&r.data.sourceId===att.id)){
      throw new Error('Late entry '+att.data.date+' was already converted.');
    }
    const units=1; // short-leave = ¼ day
    change.put('leaveledger',{
      name:`Late conversion ${att.data.date}`,
      employeeId:att.data.employeeId,
      department:att.data.department,
      entryType:'late_conversion',
      leaveType:'Annual',
      units,
      charged:units,
      direction:'debit',
      date:att.data.date,
      sourceId:att.id,
      reason:clean(reason,1000),
      convertedBy:c.user.email,
      convertedAt:new Date().toISOString(),
      status:'Posted',
    });
    change.put('attendance',{...att.data,lateConverted:true,lateConvertedAt:new Date().toISOString()},att.id);
  }
  change.detail='Converted late entries to short leave';
}

export function manualLeaveAdjust(change:Change,input:any){
  const c=change.c;
  requireLeaveAdmin(c);
  const employee=reference(c,input.employeeId,'staff')!;
  if(employee.id===c.access.employeeId&&!can(c.access,'*'))throw new Error('Managers cannot alter their own leave balance.');
  const units=Math.abs(Number(input.units||daysToQuarters(input.days||0)));
  if(!units)throw new Error('Enter an adjustment amount.');
  if(!input.reason)throw new Error('A reason is required for leave adjustments.');
  const direction=input.direction==='debit'||input.debit?'debit':'credit';
  change.put('leaveledger',{
    name:`Manual ${direction} ${today()}`,
    employeeId:employee.id,
    department:employee.data.department,
    entryType:'manual',
    leaveType:clean(input.leaveType||input.type||'Annual'),
    units,
    direction,
    date:input.date||today(),
    reason:clean(input.reason,1000),
    adjustedBy:c.user.email,
    status:'Posted',
  });
  change.detail='Manual leave '+direction;
}

export function saveLeaveGrant(change:Change,input:any,id?:string){
  const c=change.c;
  requireLeaveAdmin(c);
  const employee=reference(c,input.employeeId,'staff')!;
  if(employee.id===c.access.employeeId&&!can(c.access,'*'))throw new Error('Managers cannot alter their own leave grants.');
  const amount=Number(input.amount||input.days);
  if(!Number.isFinite(amount)||amount<=0)throw new Error('Enter a positive grant amount in days.');
  const effectiveDate=input.effectiveDate||today();
  const expiryDate=input.expiryDate||'';
  if(expiryDate&&expiryDate<effectiveDate)throw new Error('Expiry must be on or after the effective date.');
  const status=grantStatus({data:{effectiveDate,expiryDate,status:'Active'}});
  const data:any={
    name:`Grant ${input.type||'Annual'} ${amount}d`,
    employeeId:employee.id,
    department:employee.data.department,
    type:clean(input.type||'Annual'),
    amount,
    effectiveDate,
    expiryDate,
    reason:clean(input.reason,1000),
    createdBy:c.user.email,
    status,
  };
  if(!data.reason)throw new Error('A grant reason is required.');
  const row=change.put('leavegrant',data,id);
  if(status==='Active'&&!id){
    change.put('leaveledger',{
      name:`Grant credit ${effectiveDate}`,
      employeeId:employee.id,
      department:employee.data.department,
      entryType:'grant',
      leaveType:data.type,
      grantId:row.id,
      units:daysToQuarters(amount),
      direction:'credit',
      date:effectiveDate,
      reason:data.reason,
      status:'Posted',
    });
  }
  change.detail='Saved leave grant';
  return row;
}

export function runGrantExpiry(change:Change){
  const c=change.c;
  requireLeaveAdmin(c);
  const todayK=karachiDate();
  let n=0;
  for(const g of c.records.filter(r=>r.kind==='leavegrant'&&!r.archived)){
    if(g.data.status==='Expired'||g.data.status==='Exhausted'||g.data.status==='Cancelled')continue;
    if(!g.data.expiryDate||todayK<=g.data.expiryDate)continue;
    const entry=expireGrantEntries(g,c.records);
    if(entry){
      change.put('leaveledger',{...entry,department:g.data.department,status:'Posted'});
      n++;
    }
    change.put('leavegrant',{...g.data,status:'Expired'},g.id);
  }
  change.detail=n?`Expired ${n} leave grant(s)`:'No grants to expire';
}

export function approveLeave(change:Change,id:string,action:string,note=''){
  const c=change.c;
  const r=reference(c,id,'leave')!;
  const d={...r.data};
  requireCap(c.access,'leave.approve');
  if(d.employeeId===c.access.employeeId&&!can(c.access,'*'))throw new Error('Your own request needs another approver.');
  const employee=reference(c,d.employeeId,'staff')!;
  if(isManagerEmployee(c,d.employeeId)||employee.data.managerId===d.employeeId){
    // Manager leave → admins only
    if(!can(c.access,'*')&&!can(c.access,'leave.admin'))throw new Error('Only HR or Owner can approve a manager leave request.');
  }
  // Reporting managers may only approve their reports (unless HR/Owner)
  if(!can(c.access,'*')&&!can(c.access,'leave.admin')&&can(c.access,'leave.approve')){
    const okDept=can(c.access,'leave.approve'); // already scoped by recordAllowed
    if(employee.data.managerId&&employee.data.managerId!==c.access.employeeId&&c.access.role==='Staff'){
      throw new Error('You can only approve leave for your assigned employees.');
    }
    void okDept;
  }
  if(action==='reject'){
    d.status='Rejected';d.approvedBy=c.user.email;d.approvedAt=new Date().toISOString();d.approvalNote=note;
    change.put('leave',d,r.id);change.detail='Rejected leave';return;
  }
  if(action==='cancel'||action==='withdraw'){
    if(d.employeeId!==c.access.employeeId&&!can(c.access,'leave.admin')&&!can(c.access,'*'))throw new Error('Not permitted.');
    if(!['Submitted','Pending'].includes(d.status)&&action==='withdraw')throw new Error('Only pending leave can be withdrawn.');
    d.status=action==='withdraw'?'Withdrawn':'Cancelled';
    change.put('leave',d,r.id);change.detail=action+' leave';return;
  }
  if(d.type!=='Unpaid'){
    const quarters=Number(d.quarters||leaveRequestQuarters(d,c.settings.workingDays,c.records.filter(x=>x.kind==='holiday').map(x=>x.data.date)));
    const avail=effectiveAvailable(c.records,employee,d.type);
    if(quarters>avail)throw new Error('Leave exceeds the employee granted balance. Add a grant or allowance first.');
    if(inProbation(employee)&&quarters>PROBATION_QUARTERS)throw new Error('Probation leave quota exceeded.');
    const allocations=allocateFifo(c.records,d.employeeId,d.type,quarters);
    for(const a of allocations){
      change.put('leaveledger',{
        name:`Leave usage ${d.start}`,
        employeeId:d.employeeId,
        department:d.department,
        entryType:'usage',
        leaveType:d.type,
        grantId:a.grantId||'',
        leaveId:r.id,
        units:a.units,
        direction:'debit',
        date:d.start,
        reason:d.reason||'Approved leave',
        status:'Posted',
      });
    }
    d.quarters=quarters;
  }
  d.status='Approved';d.approvedBy=c.user.email;d.approvedAt=new Date().toISOString();d.approvalNote=note;
  change.put('leave',d,r.id);change.detail='Approved leave';
}

export function enrichLeaveOnSave(c:Context,data:any){
  const holidays=c.records.filter(r=>r.kind==='holiday'&&!r.archived).map(r=>r.data.date);
  if(!data.unit)data.unit=data.halfDay?'half':(data.shortLeave?'short':'full');
  if(data.unit==='half')data.halfDay=true;
  if(data.unit==='short'){data.end=data.start;data.halfDay=false;data.units=0.25;}
  else if(data.unit==='half'){data.end=data.start;data.units=0.5;}
  data.quarters=leaveRequestQuarters(data,c.settings.workingDays,holidays);
  if(data.unit==='full')data.units=quartersToDays(data.quarters);
  data.status='Submitted';
  return data;
}

export function leaveBalancesFor(c:Context,employeeId?:string){
  const id=employeeId||c.access.employeeId;
  if(!id)return {};
  const types=['Annual','Sick','Casual'];
  const out:any={};
  for(const t of types)out[t]=balanceSummary(c.records,id,t);
  out.liveAttendance=(()=>{
    const open=openAttendanceFor(c.records,id);
    if(!open)return null;
    const events=open.data.events||[];
    return {id:open.id,...deriveSession(events||open.data),events,date:open.data.date,lateMinutes:open.data.lateMinutes};
  })();
  return out;
}

export {availableQuarters,balanceSummary,deriveSession,openAttendanceFor};
