/**
 * Event-based attendance: clock_in → break_start/break_end* → clock_out.
 * Live timer is derived from saved events + now — no per-second DB writes.
 */
import {localTimestamp,attendanceDuration} from './finance.mjs';

export const ATT_EVENTS=['clock_in','break_start','break_end','clock_out'];

export function karachiDate(iso=new Date().toISOString()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi'}).format(new Date(iso));
}

export function sessionState(events=[]){
  if(!events.length)return 'Not clocked in';
  const last=events[events.length-1]?.type;
  if(last==='clock_out')return 'Clocked Out';
  if(last==='break_start')return 'On Break';
  if(last==='clock_in'||last==='break_end')return 'Working';
  return 'Exception';
}

/** Break and worked minutes from completed segments; live elapsed while open. */
export function deriveSession(events=[],now=Date.now()){
  const state=sessionState(events);
  let breakMs=0,workMs=0;
  let openWork=null,openBreak=null;
  for(const e of events){
    const t=Date.parse(e.at);
    if(!Number.isFinite(t))continue;
    if(e.type==='clock_in'){openWork=t;openBreak=null;}
    else if(e.type==='break_start'){
      if(openWork!=null){workMs+=t-openWork;openWork=null;}
      openBreak=t;
    }else if(e.type==='break_end'){
      if(openBreak!=null){breakMs+=t-openBreak;openBreak=null;}
      openWork=t;
    }else if(e.type==='clock_out'){
      if(openBreak!=null){breakMs+=t-openBreak;openBreak=null;}
      if(openWork!=null){workMs+=t-openWork;openWork=null;}
    }
  }
  if(openBreak!=null)breakMs+=now-openBreak;
  if(openWork!=null)workMs+=now-openWork;
  const breakMinutes=Math.max(0,Math.round(breakMs/60000));
  const workedMinutes=Math.max(0,Math.round(workMs/60000));
  const clockIn=events.find(e=>e.type==='clock_in')?.at||'';
  const clockOut=events.find(e=>e.type==='clock_out')?.at||'';
  return {
    state,
    clockIn,
    clockOut,
    breakMinutes,
    workedMinutes,
    elapsedMinutes:workedMinutes+breakMinutes,
    live:state==='Working'||state==='On Break',
    exception:state==='Exception'||(events.some(e=>e.type==='break_start')&&!events.some(e=>e.type==='break_end')&&state==='Clocked Out'),
  };
}

export function lateMinutesFor(clockInIso,date,shift,{graceMinutes}={}){
  if(!clockInIso||!shift?.data?.startTime)return 0;
  const grace=Number(graceMinutes??shift.data.graceMinutes??15);
  const scheduled=Date.parse(localTimestamp(date,shift.data.startTime));
  const clock=Date.parse(clockInIso);
  if(!Number.isFinite(scheduled)||!Number.isFinite(clock))return 0;
  return Math.max(0,Math.round((clock-scheduled)/60000)-grace);
}

/** Torix night office default: 19:00–04:00 Karachi (9h) minus 45m unpaid break → 495m. */
export const DEFAULT_OFFICE_START='19:00';
export const DEFAULT_OFFICE_END='04:00';
export const DEFAULT_OFFICE_BREAK_MINUTES=45;
export const DEFAULT_SCHEDULED_WORK_MINUTES=9*60-DEFAULT_OFFICE_BREAK_MINUTES; // 495

export function scheduledWorkMinutes(shift){
  if(!shift?.data?.startTime||!shift?.data?.endTime)return DEFAULT_SCHEDULED_WORK_MINUTES;
  const [sh,sm]=shift.data.startTime.split(':').map(Number);
  const [eh,em]=shift.data.endTime.split(':').map(Number);
  let mins=(eh*60+em)-(sh*60+sm);
  if(mins<=0)mins+=24*60; // overnight (e.g. 19:00→04:00)
  const unpaidBreak=shift.data.paidBreaks===true?0:Number(shift.data.breakMinutes||0);
  return Math.max(1,mins-unpaidBreak);
}

export function nextAttendanceAction(events=[],{allowMultipleBreaks=true}={}){
  const state=sessionState(events);
  if(state==='Not clocked in')return 'clock_in';
  if(state==='Working')return allowMultipleBreaks||!events.some(e=>e.type==='break_start')?'break_start_or_clock_out':'clock_out';
  if(state==='On Break')return 'break_end';
  return null;
}

export function appendAttendanceEvent(session,type,at=new Date().toISOString(),{allowMultipleBreaks=true,paidBreaks=false}={}){
  if(!ATT_EVENTS.includes(type))throw new Error('Unknown attendance event.');
  const events=[...(session.events||[])];
  const state=sessionState(events);
  if(type==='clock_in'){
    if(state!=='Not clocked in')throw new Error('Already clocked in for this session.');
  }else if(type==='break_start'){
    if(state!=='Working')throw new Error('Start break only while working.');
    if(!allowMultipleBreaks&&events.some(e=>e.type==='break_start'))throw new Error('Multiple breaks are disabled for this shift.');
  }else if(type==='break_end'){
    if(state!=='On Break')throw new Error('End break only while on break.');
  }else if(type==='clock_out'){
    if(state==='On Break')throw new Error('End the break before clocking out.');
    if(state!=='Working')throw new Error('Clock out only while working.');
  }
  events.push({id:crypto.randomUUID(),type,at});
  const derived=deriveSession(events,Date.parse(at));
  const status=type==='clock_out'?'Submitted':(type==='clock_in'||type==='break_start'||type==='break_end'?'In progress':session.status||'In progress');
  return {
    ...session,
    events,
    state:derived.state,
    clockIn:derived.clockIn,
    clockOut:derived.clockOut||'',
    breakMinutes:derived.breakMinutes,
    workedMinutes:type==='clock_out'?derived.workedMinutes:derived.workedMinutes,
    elapsedMinutes:derived.elapsedMinutes,
    status,
    paidBreaks:!!paidBreaks,
    name:session.name||'Attendance '+((session.date)||karachiDate(at)),
  };
}

/** Build / refresh attendance payload fields from events (for save compatibility). */
export function syncAttendanceFields(data,now=Date.now()){
  const events=data.events||[];
  if(!events.length&&data.clockIn){
    const legacy=[{id:'legacy-in',type:'clock_in',at:data.clockIn}];
    if(data.clockOut)legacy.push({id:'legacy-out',type:'clock_out',at:data.clockOut});
    data.events=legacy;
  }
  const d=deriveSession(data.events||[],now);
  data.state=d.state;
  data.clockIn=d.clockIn||data.clockIn||'';
  data.clockOut=d.clockOut||'';
  data.breakMinutes=d.breakMinutes;
  data.workedMinutes=d.workedMinutes;
  data.elapsedMinutes=d.elapsedMinutes;
  if(d.exception)data.classification=data.classification||'Exception';
  return data;
}

export function openAttendanceFor(records,employeeId){
  return records.find(r=>r.kind==='attendance'&&!r.archived&&r.data.employeeId===employeeId&&r.data.status==='In progress'&&!r.data.clockOut);
}
