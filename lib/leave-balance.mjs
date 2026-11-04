/**
 * Leave grants + ledger balances (quarter-day units).
 * FIFO consumption by earliest expiry; future grants shown separately.
 */
import {karachiDate} from './attendance.mjs';
import {daysToQuarters,quartersToDays,FULL} from './partial-absence.mjs';

export const LEDGER_TYPES=['opening','grant','usage','partial','penalty','late_conversion','expiry','manual','reversal'];

export function karachiEndOfDay(date){
  // End of expiry date in Asia/Karachi = next calendar day 00:00 Karachi minus 1ms, compare as date string >=
  return date;
}

export function grantStatus(grant,today=karachiDate()){
  const g=grant.data||grant;
  if(g.status==='Exhausted'||g.status==='Cancelled')return g.status;
  if(g.expiryDate&&today>g.expiryDate)return 'Expired';
  if(g.effectiveDate&&today<g.effectiveDate)return 'Scheduled';
  return 'Active';
}

export function activeGrants(records,employeeId,type,today=karachiDate()){
  return records
    .filter(r=>r.kind==='leavegrant'&&!r.archived&&r.data.employeeId===employeeId&&(!type||r.data.type===type))
    .map(r=>({...r,computedStatus:grantStatus(r,today)}))
    .filter(r=>r.computedStatus==='Active')
    .sort((a,b)=>{
      const ae=a.data.expiryDate||'9999-12-31',be=b.data.expiryDate||'9999-12-31';
      if(ae!==be)return ae<be?-1:1;
      return (a.data.effectiveDate||'')<(b.data.effectiveDate||'')?-1:1;
    });
}

export function futureGrants(records,employeeId,type,today=karachiDate()){
  return records
    .filter(r=>r.kind==='leavegrant'&&!r.archived&&r.data.employeeId===employeeId&&(!type||r.data.type===type))
    .filter(r=>grantStatus(r,today)==='Scheduled');
}

export function ledgerQuarters(records,employeeId,{type,excludePending=true}={}){
  return records
    .filter(r=>r.kind==='leaveledger'&&!r.archived&&r.data.employeeId===employeeId&&!r.data.reversed)
    .filter(r=>!type||r.data.leaveType===type||r.data.type===type)
    .reduce((n,r)=>{
      const sign=r.data.direction==='debit'||-['usage','partial','penalty','late_conversion','expiry'].includes(r.data.entryType)?-1:1;
      // usage/partial/penalty/late_conversion/expiry are debits (negative to balance)
      const entry=r.data.entryType||r.data.kind;
      const units=Number(r.data.units||0);
      if(['usage','partial','penalty','late_conversion','expiry'].includes(entry))return n-Math.abs(units);
      if(entry==='reversal')return n+Number(r.data.units||0); // reversal restores
      return n+Math.abs(units); // opening, grant, manual credit
    },0);
}

/** Compat: yearly allowance records as non-expiring grant-equivalent quarters. */
export function allowanceQuarters(records,employeeId,type,year){
  return records
    .filter(r=>r.kind==='allowance'&&!r.archived&&r.data.employeeId===employeeId&&r.data.type===type&&Number(r.data.year)===year)
    .reduce((n,r)=>n+daysToQuarters(r.data.days),0);
}

export function approvedUsageQuarters(records,employeeId,type,year){
  return records
    .filter(r=>r.kind==='leave'&&!r.archived&&r.data.employeeId===employeeId&&r.data.type===type&&r.data.status==='Approved'&&String(r.data.start||'').startsWith(String(year)))
    .reduce((n,r)=>n+Number(r.data.quarters||daysToQuarters(r.data.units||0)),0);
}

export function pendingUsageQuarters(records,employeeId,type){
  return records
    .filter(r=>r.kind==='leave'&&!r.archived&&r.data.employeeId===employeeId&&(!type||r.data.type===type)&&['Submitted','Pending'].includes(r.data.status))
    .reduce((n,r)=>n+Number(r.data.quarters||daysToQuarters(r.data.units||0)),0);
}

export function remainingOnGrant(grant,records){
  const used=records
    .filter(r=>r.kind==='leaveledger'&&!r.archived&&!r.data.reversed&&r.data.grantId===grant.id&&['usage','expiry'].includes(r.data.entryType))
    .reduce((n,r)=>n+Math.abs(Number(r.data.units||0)),0);
  return Math.max(0,daysToQuarters(grant.data.amount??grant.data.days??0)-used);
}

/**
 * Available balance in quarter-days for a leave type.
 * Includes active grants (FIFO pool) + legacy allowances − approved usage − ledger debits.
 */
export function availableQuarters(records,employeeId,type,today=karachiDate()){
  const year=Number(today.slice(0,4));
  const grants=activeGrants(records,employeeId,type,today);
  let fromGrants=grants.reduce((n,g)=>n+remainingOnGrant(g,records),0);
  // Legacy allowances not yet mirrored as grants
  const allow=allowanceQuarters(records,employeeId,type,year);
  const used=approvedUsageQuarters(records,employeeId,type,year);
  // Partial/penalty/late/manual ledger outside grant links
  const extraDebit=records
    .filter(r=>r.kind==='leaveledger'&&!r.archived&&!r.data.reversed&&r.data.employeeId===employeeId&&(!r.data.leaveType||r.data.leaveType===type)&&['partial','penalty','late_conversion'].includes(r.data.entryType)&&!r.data.grantId)
    .reduce((n,r)=>n+Math.abs(Number(r.data.units||0)),0);
  const manual=records
    .filter(r=>r.kind==='leaveledger'&&!r.archived&&!r.data.reversed&&r.data.employeeId===employeeId&&(!r.data.leaveType||r.data.leaveType===type)&&r.data.entryType==='manual')
    .reduce((n,r)=>n+(r.data.direction==='debit'?-1:1)*Math.abs(Number(r.data.units||0)),0);
  // Prefer grant pool; if no grants, fall back to allowance − used
  if(grants.length){
    return Math.max(0,fromGrants+manual-extraDebit);
  }
  return Math.max(0,allow-used+manual-extraDebit);
}

export function balanceSummary(records,employeeId,type,today=karachiDate()){
  const year=Number(today.slice(0,4));
  const available=availableQuarters(records,employeeId,type,today);
  const pending=pendingUsageQuarters(records,employeeId,type);
  const granted=activeGrants(records,employeeId,type,today).reduce((n,g)=>n+daysToQuarters(g.data.amount??g.data.days??0),0)
    +allowanceQuarters(records,employeeId,type,year);
  const used=approvedUsageQuarters(records,employeeId,type,year)
    +records.filter(r=>r.kind==='leaveledger'&&!r.archived&&!r.data.reversed&&r.data.employeeId===employeeId&&['partial','penalty','late_conversion'].includes(r.data.entryType)).reduce((n,r)=>n+Math.abs(Number(r.data.units||0)),0);
  const future=futureGrants(records,employeeId,type,today).map(g=>({
    id:g.id,amount:g.data.amount??g.data.days,effectiveDate:g.data.effectiveDate,expiryDate:g.data.expiryDate,type:g.data.type,reason:g.data.reason,
  }));
  const expiring=activeGrants(records,employeeId,type,today)
    .filter(g=>g.data.expiryDate)
    .map(g=>({id:g.id,remaining:quartersToDays(remainingOnGrant(g,records)),expiryDate:g.data.expiryDate,type:g.data.type}));
  return {
    availableDays:quartersToDays(available),
    availableQuarters:available,
    grantedDays:quartersToDays(granted),
    usedDays:quartersToDays(used),
    pendingDays:quartersToDays(pending),
    future,expiring,year,type,
  };
}

/** FIFO: allocate usage quarters across grants by earliest expiry. */
export function allocateFifo(records,employeeId,type,quarters,today=karachiDate()){
  const grants=activeGrants(records,employeeId,type,today);
  let left=quarters;
  const allocations=[];
  for(const g of grants){
    if(left<=0)break;
    const rem=remainingOnGrant(g,records);
    if(rem<=0)continue;
    const take=Math.min(rem,left);
    allocations.push({grantId:g.id,units:take});
    left-=take;
  }
  if(left>0&&!grants.length){
    // Legacy allowance pool — single synthetic allocation
    const allow=allowanceQuarters(records,employeeId,type,Number(today.slice(0,4)));
    const used=approvedUsageQuarters(records,employeeId,type,Number(today.slice(0,4)));
    if(allow-used<left)throw new Error('Leave exceeds the employee granted balance. Add a grant or allowance first.');
    allocations.push({grantId:null,units:left});
    left=0;
  }
  if(left>0)throw new Error('Leave exceeds the employee granted balance. Add a grant or allowance first.');
  return allocations;
}

export function inProbation(staff,today=karachiDate()){
  const s=staff?.data||staff;
  if(!s?.probationStart)return false;
  const end=s.probationEnd||'9999-12-31';
  return today>=s.probationStart&&today<=end;
}

export const PROBATION_QUARTERS=3*FULL; // 3 full-day equivalents

export function effectiveAvailable(records,employee,type,today=karachiDate()){
  const base=availableQuarters(records,employee.id||employee,type,today);
  if(inProbation(employee,today))return Math.min(base,PROBATION_QUARTERS);
  return base;
}

export function grantsToExpire(records,today=karachiDate()){
  return records.filter(r=>
    r.kind==='leavegrant'&&!r.archived
    &&r.data.expiryDate&&today>r.data.expiryDate
    &&!['Expired','Exhausted','Cancelled'].includes(r.data.status)
  );
}

export function expireGrantEntries(grant,records){
  const rem=remainingOnGrant(grant,records);
  if(rem<=0)return null;
  return {
    entryType:'expiry',
    employeeId:grant.data.employeeId,
    leaveType:grant.data.type,
    grantId:grant.id,
    units:rem,
    direction:'debit',
    date:grant.data.expiryDate,
    reason:'Unused grant expired',
    name:`Expiry ${grant.data.type} ${grant.data.expiryDate}`,
  };
}
