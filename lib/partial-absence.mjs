/**
 * Continuous partial-absence accounting in integer quarter-day units.
 * short = 1 (¼ day), half = 2 (½ day), full = 4 (1 day).
 * When accumulated partial units reach 3, reconcile total charge to 4,
 * deducting only the difference already charged.
 */
import {scheduledWorkMinutes} from './attendance.mjs';
import {leaveUnits} from './finance.mjs';

export const QUARTER=1;
export const HALF=2;
export const FULL=4;
export const PARTIAL_THRESHOLD=3; // three quarters → charge one full day equivalent

export function classifyMissedMinutes(missedMinutes,scheduledMinutes){
  if(missedMinutes<=0)return {units:0,label:'Present'};
  if(missedMinutes>=scheduledMinutes)return {units:FULL,label:'Absent'};
  // ≤2 hours short absence; >2 hours half-day (spec: inclusive 2h = short)
  if(missedMinutes<=120)return {units:QUARTER,label:'Short absence'};
  return {units:HALF,label:'Half-day absence'};
}

export function missedScheduledMinutes(attendance,shift){
  const scheduled=scheduledWorkMinutes(shift);
  const worked=Number(attendance.workedMinutes||0);
  // If paid breaks, worked already includes break; unpaid breaks already excluded from scheduled
  const missed=Math.max(0,scheduled-worked);
  return {missed,scheduled};
}

export function classifyAttendanceSession(attendance,shift,{onApprovedLeave=false,isHoliday=false,isNonWorking=false}={}){
  if(onApprovedLeave||isHoliday||isNonWorking)return {units:0,label:'Exempt',skipLedger:true};
  if(attendance.classification==='Exempt')return {units:0,label:'Exempt',skipLedger:true};
  if(!attendance.clockIn&&!attendance.clockOut){
    return {units:FULL,label:'Absent',skipLedger:false};
  }
  if(attendance.clockIn&&!attendance.clockOut){
    return {units:0,label:'Exception',skipLedger:true,exception:true};
  }
  const {missed,scheduled}=missedScheduledMinutes(attendance,shift);
  const cls=classifyMissedMinutes(missed,scheduled);
  return {...cls,missed,scheduled,skipLedger:cls.units===0};
}

/**
 * Ledger entries for an employee: {units, charged?, kind, sourceId, date}
 * Returns {toCharge, penalty, newChargedTotal} for a new partial classification.
 */
export function reconcilePartialCharge(priorLedger=[],newUnits){
  if(!newUnits||newUnits<=0)return {toCharge:0,penalty:0,patternUnits:0};
  // Full-day absences are charged as-is and do not feed the partial counter
  if(newUnits>=FULL){
    return {toCharge:FULL,penalty:0,patternUnits:0,fullDay:true};
  }
  const partials=priorLedger.filter(e=>e.kind==='partial'&&!e.reversed&&Number(e.units)>0&&Number(e.units)<FULL);
  const alreadyCharged=priorLedger
    .filter(e=>['partial','penalty'].includes(e.kind)&&!e.reversed)
    .reduce((n,e)=>n+Number(e.charged||e.units||0),0);
  // Accumulated pattern units (raw short/half classifications, not penalties)
  const patternUnits=partials.reduce((n,e)=>n+Number(e.units||0),0)+newUnits;
  // Charged so far for this open pattern group (before threshold)
  // Spec: when pattern reaches 3, total charge becomes 4; charge only the difference
  if(patternUnits>=PARTIAL_THRESHOLD){
    const requiredTotal=FULL;
    const toCharge=Math.max(0,requiredTotal-alreadyCharged-0); // will add newUnits charge path below
    // Amount already attributed to prior partials' charged fields
    const priorCharged=partials.reduce((n,e)=>n+Number(e.charged??e.units??0),0);
    const additional=Math.max(0,requiredTotal-priorCharged);
    // Split: charge min(newUnits, additional) as partial, rest as penalty if needed
    const partialCharge=Math.min(newUnits,additional);
    const penalty=Math.max(0,additional-partialCharge);
    return {toCharge:partialCharge,penalty,patternUnits,threshold:true,requiredTotal};
  }
  // Below threshold: charge the new units as-is
  return {toCharge:newUnits,penalty:0,patternUnits,threshold:false};
}

/** After two half-days (2+2), total charged should be 4 with no extra penalty. */
export function assertNoDoubleHalf(priorLedger,newUnits){
  const halves=priorLedger.filter(e=>e.kind==='partial'&&!e.reversed&&Number(e.units)===HALF);
  if(newUnits===HALF&&halves.length>=1){
    const priorCharged=halves.reduce((n,e)=>n+Number(e.charged??e.units??0),0);
    const additional=Math.max(0,FULL-priorCharged);
    return {toCharge:Math.min(HALF,additional),penalty:0,patternUnits:HALF*2,twoHalves:true};
  }
  return null;
}

export function planPartialEntry(priorLedger,newUnits){
  const two=assertNoDoubleHalf(priorLedger,newUnits);
  if(two)return two;
  return reconcilePartialCharge(priorLedger,newUnits);
}

export function employeePartialLedger(records,employeeId){
  return records
    .filter(r=>r.kind==='leaveledger'&&!r.archived&&r.data.employeeId===employeeId&&['partial','penalty'].includes(r.data.entryType||r.data.kind))
    .map(r=>({
      id:r.id,
      kind:r.data.entryType||r.data.kind,
      units:Number(r.data.units||0),
      charged:Number(r.data.charged??r.data.units??0),
      reversed:!!r.data.reversed,
      sourceId:r.data.sourceId||'',
      date:r.data.date||r.data.effectiveDate||'',
    }));
}

export function isNonWorkingDate(date,workingDays=[1,2,3,4,5],holidays=[]){
  const d=new Date(date+'T12:00:00Z');
  return !workingDays.includes(d.getUTCDay())||holidays.includes(date);
}

export function hasApprovedLeaveOn(records,employeeId,date){
  return records.some(r=>r.kind==='leave'&&!r.archived&&r.data.employeeId===employeeId&&r.data.status==='Approved'&&r.data.start<=date&&r.data.end>=date);
}

export function quartersToDays(q){return Number(q||0)/FULL}
export function daysToQuarters(d){return Math.round(Number(d||0)*FULL)}

/** Convert leave request shape (full/half/short) to quarter units. */
export function leaveRequestQuarters(data,workingDays,holidays){
  const unit=data.unit||(data.halfDay?'half':data.shortLeave||data.type==='Short'?'short':'full');
  if(unit==='short')return QUARTER;
  if(unit==='half'||data.halfDay)return HALF;
  const days=leaveUnits(data.start,data.end,workingDays,holidays,false);
  return daysToQuarters(days);
}
