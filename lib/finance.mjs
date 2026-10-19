import {parseMoney} from './domain.mjs';
export const liabilityAccounts=['advance','client_credit','ad_funds','owner_due','employee_due','owner_loan','payable','payroll_payable','deduction_payable','deferred','tax'];
export function zeroMoney(v){return v===''||v==null||Number(v)===0?0:parseMoney(v)}
export function rateMicros(value=1){const s=String(value);if(!/^\d{1,7}(\.\d{1,6})?$/.test(s))throw new Error('Exchange rate must be a positive decimal with at most six decimal places.');const [a,b='']=s.split('.'),n=Number(a)*1000000+Number(b.padEnd(6,'0'));if(n<=0)throw new Error('Exchange rate must be positive.');return n}
export function convert(units,rate){if(!Number.isSafeInteger(units)||!Number.isSafeInteger(rate))throw new Error('Invalid money precision.');const sign=units<0?-1:1;const n=(BigInt(Math.abs(units))*BigInt(rate)+BigInt(500000))/BigInt(1000000);const result=Number(n)*sign;if(!Number.isSafeInteger(result))throw new Error('Amount is too large.');return result}
export function fraction(value,numerator,denominator){if(!denominator)throw new Error('No balance available.');const sign=value<0?-1:1;return sign*Number((BigInt(Math.abs(value))*BigInt(numerator)+BigInt(Math.floor(denominator/2)))/BigInt(denominator))}
export function percent(value,pct){const s=String(pct||0);if(!/^\d{1,3}(\.\d{1,2})?$/.test(s))throw new Error('Percentage must have at most two decimal places.');const [a,b='']=s.split('.'),bp=Number(a)*100+Number(b.padEnd(2,'0'));if(bp>10000)throw new Error('Percentage cannot exceed 100.');return fraction(value,bp,10000)}
export function normalizedLines(events){return events.flatMap(e=>e.ledger.map(l=>({...l,currency:l.currency||e.meta?.currency||'PKR',units:l.units??l.amount,accountId:l.accountId||(l.account==='cash'?'default-pkr':''),ref:l.ref||(l.account==='revenue'&&e.kind==='earned'?e.orderId||'':''),eventId:e.id,date:e.date,orderId:e.orderId||'',party:l.party||'',department:l.department||e.department||'Corporate'})))}
export function sumBalance(events,account,filter={},base=false){return normalizedLines(events).filter(l=>l.account===account&&Object.entries(filter).every(([k,v])=>v==null||l[k]===v)).reduce((n,l)=>n+(base?l.amount:l.units),0)}
export function carrying(events,account,filter,units){const u=Math.abs(sumBalance(events,account,filter)),b=Math.abs(sumBalance(events,account,filter,true));if(!Number.isSafeInteger(units)||units<=0||units>u)throw new Error('Amount exceeds the available balance.');return units===u?b:fraction(b,units,u)}
export function line(account,units,data={},base){return {account,units,currency:data.currency||'PKR',amount:base??convert(units,data.rate||1000000),party:data.party||'',department:data.department||'Corporate',accountId:account==='cash'?(data.accountId||'default-pkr'):'',ref:data.ref||'',sourceLineId:data.sourceLineId||''}}
export function balanceLines(lines){const total=lines.reduce((n,l)=>n+l.amount,0);if(total)lines.push(line('fx',-total,{currency:'PKR',department:'Corporate'},-total));return lines}
export function cashCarrying(lines,events){
 if(!lines.some(l=>l.account==='cash'&&(l.units??l.amount)<0))return lines;
 const result=[],staged=[...events];for(const original of lines.filter(l=>l.account!=='fx')){let l={...original};if(l.account==='cash'&&(l.units??l.amount)<0){const units=-(l.units??l.amount),currency=l.currency||'PKR',accountId=l.accountId||'default-pkr';l.amount=-carrying(staged,'cash',{currency,accountId},units);}result.push(l);staged.push({id:'partial',date:'',ledger:[l],meta:{}});}return balanceLines(result);
}
function match(events,account,data,units,sign,ref){const filter={currency:data.currency,party:data.party,...(ref!==undefined?{ref}: {}),...(data.sourceLineId&&account!=='receivable'?{sourceLineId:data.sourceLineId}:{})},b=carrying(events,account,filter,units);return line(account,sign*units,{...data,ref:ref||''},sign*b)}
export function simplePosting(kind,units,data,events){
 const d={currency:'PKR',rate:1000000,department:'Corporate',...data};let lines=[];const client={...d,party:d.clientId},owner={...d,party:d.person},employee={...d,party:d.employeeId};
 if(kind==='earned'){
  if(d.invoiceId){lines=[match(events,'deferred',client,units,1,d.invoiceId)];lines.push(line('revenue',-units,{...client,ref:d.invoiceId},-lines[0].amount));}
  else lines=[line('unbilled',units,{...client,ref:d.orderId}),line('revenue',-units,{...client,ref:d.orderId})];
 }else if(kind==='collection'){
  const ref=d.invoiceId||'',cleared=match(events,'receivable',client,units,-1,ref),fee=d.fee||0;if(fee>=units)throw new Error('Payment fee must be less than the gross receipt.');lines=[line('cash',units-fee,d),cleared];if(fee)lines.push(line('expense',fee,{...d,ref:d.category||'Payment fees'}));
 }else if(kind==='client_advance')lines=[line('cash',units,d),line('advance',-units,client)];
 else if(kind==='apply_advance'){if(!d.invoiceId)throw new Error('Choose an invoice to settle.');lines=[match(events,'advance',client,units,1),match(events,'receivable',client,units,-1,d.invoiceId)];}
 else if(kind==='expense')lines=[line(d.treatment==='Asset'?'asset':d.treatment==='Prepaid'?'prepaid':'expense',units,{...d,ref:d.assetId||d.category||''}),line('cash',-units,d)];
 else if(kind==='owner_expense')lines=[line(d.treatment==='Asset'?'asset':d.treatment==='Prepaid'?'prepaid':'expense',units,{...d,ref:d.assetId||d.category||''}),line('owner_due',-units,owner)];
 else if(kind==='owner_repayment')lines=[match(events,'owner_due',owner,units,1),line('cash',-units,d)];
 else if(kind==='owner_loan')lines=[line('cash',units,d),line('owner_loan',-units,owner)];
 else if(kind==='loan_repayment')lines=[match(events,'owner_loan',owner,units,1),line('cash',-units,d)];
 else if(kind==='capital')lines=[line('cash',units,d),line('equity',-units,owner)];
 else if(kind==='drawing')lines=[line('equity',units,owner),line('cash',-units,d)];
 else if(kind==='ad_deposit')lines=[line('cash',units,d),line('ad_funds',-units,client)];
 else if(kind==='ad_spend')lines=[match(events,'ad_funds',client,units,1),line('cash',-units,d)];
 else if(kind==='staff_advance')lines=[line('staff_advance',units,employee),line('cash',-units,d)];
 else if(kind==='tender_deposit')lines=[line('deposit',units,{...d,party:d.tenderId}),line('cash',-units,d)];
 else if(kind==='deposit_refund')lines=[line('cash',units,d),match(events,'deposit',{...d,party:d.tenderId},units,-1)];
 else if(kind==='refund'){const account=d.refundSource==='advance'?'advance':'client_credit';lines=[match(events,account,client,units,1),line('cash',-units,d)];}
 else throw new Error('Unsupported financial entry type.');
 return balanceLines(lines);
}
export function issueInvoice(invoice,events,options={}){
 const d={currency:invoice.currency,rate:invoice.rate,department:invoice.department,party:invoice.clientId,ref:invoice.id,sourceLineId:invoice.sourceLineId||''};const n=invoice.net,t=invoice.tax||0,lines=[line('receivable',n+t,d)];
 if(options.previousEarning){
  let left=n;const unbilled=Math.max(0,sumBalance(events,'unbilled',{currency:d.currency,party:d.party,ref:invoice.orderId})),take=Math.min(left,unbilled);
  if(take){lines.push(match(events,'unbilled',{...d,ref:invoice.orderId,sourceLineId:''},take,-1,invoice.orderId));left-=take;}
  if(left)lines.push(match(events,'receivable',{...d,sourceLineId:''},left,-1,''));
  const moved=0-lines.slice(1).reduce((s,l)=>s+l.amount,0);lines.push(line('revenue',n,{...d,ref:invoice.orderId,sourceLineId:''},moved),line('revenue',-n,d,-moved));
 }else lines.push(line('deferred',-n,d));
 if(t)lines.push(line('tax',-t,d));return balanceLines(lines);
}
export function creditInvoice(invoice,units,taxUnits,events){
 const d={currency:invoice.currency,rate:invoice.rate,department:invoice.department,party:invoice.clientId,ref:invoice.id,sourceLineId:invoice.sourceLineId||''},lines=[];
 const deferred=Math.max(0,0-sumBalance(events,'deferred',{currency:d.currency,party:d.party,ref:d.ref,...(d.sourceLineId?{sourceLineId:d.sourceLineId}:{})})),unearned=Math.min(units,deferred),earned=units-unearned;
 if(unearned)lines.push(match(events,'deferred',d,unearned,1,d.ref));if(earned)lines.push(match(events,'revenue',d,earned,1,d.ref));if(taxUnits)lines.push(match(events,'tax',d,taxUnits,1,d.ref));
 const ar=Math.max(0,sumBalance(events,'receivable',{currency:d.currency,party:d.party,ref:d.ref})),settle=Math.min(ar,units+taxUnits),credit=units+taxUnits-settle;
 if(settle)lines.push(match(events,'receivable',d,settle,-1,d.ref));if(credit)lines.push(line('client_credit',-credit,d));return balanceLines(lines);
}
export function postBill(bill){const d={currency:bill.currency,rate:bill.rate,department:bill.department,party:bill.vendorId,ref:bill.id};return [line(bill.treatment==='Asset'?'asset':bill.treatment==='Prepaid'?'prepaid':'expense',bill.amount,d),line('payable',-bill.amount,d)]}
export function settleBill(bill,units,payment,events){const d={currency:bill.currency,rate:payment.rate,department:bill.department,party:bill.vendorId,ref:bill.id,accountId:payment.accountId},cleared=match(events,'payable',d,units,1,bill.id);return balanceLines([cleared,payment.paidBy==='Owner'?line('owner_due',-units,{...d,party:payment.person,ref:''}):line('cash',-units,d)])}
export function transferPosting(units,from,to){if(from.accountId===to.accountId)throw new Error('Choose different accounts.');if(!to.units||to.units<=0)throw new Error('Enter the received amount.');return balanceLines([line('cash',-units,from),line('cash',to.units,to),...(from.fee?[line('expense',from.fee,from),line('cash',-from.fee,from)]:[])])}
export function payrollCalculation(salary,options={}){
 const bonus=options.bonus||0,allowance=options.allowance||0,overtime=options.overtime||0,deduction=options.deduction||0,recovery=options.recovery||0,unpaidDays=options.unpaidDays||0,days=options.standardDays||30;
 if([salary,bonus,allowance,overtime,deduction,recovery].some(n=>!Number.isSafeInteger(n)||n<0)||unpaidDays<0||unpaidDays>days)throw new Error('Invalid payroll components.');
 const unpaid=fraction(salary,Math.round(unpaidDays*100),Math.round(days*100)),gross=salary-unpaid+bonus+allowance+overtime,net=gross-deduction-recovery;if(net<0)throw new Error('Payroll deductions exceed gross earnings.');
 return {salary,bonus,allowance,overtime,deduction,recovery,unpaidDays,standardDays:days,unpaid,gross,net};
}
export function payrollPosting(run,events=[]){
 const lines=[];for(const employee of run.lines){const d={currency:run.currency,rate:run.rate,department:employee.department,party:employee.employeeId,ref:run.id},parts=employee.allocations?.length?employee.allocations:[{department:employee.department,percent:100}];
  const distribution=splitCost(employee.gross,parts);for(const part of distribution)if(part.amount)lines.push(line('expense',part.amount,{...d,department:part.department}));
  if(employee.net)lines.push(line('payroll_payable',-employee.net,d));if(employee.recovery)lines.push(line('staff_advance',-employee.recovery,{...d,ref:''},-carrying(events,'staff_advance',{currency:d.currency,party:employee.employeeId},employee.recovery)));if(employee.deduction)lines.push(line('deduction_payable',-employee.deduction,d));
 }return balanceLines(lines);
}
export function payPayroll(run,employeeId,units,payment,events){const person=run.lines.find(l=>l.employeeId===employeeId);if(!person)throw new Error('Employee is not in this payroll.');const d={currency:run.currency,rate:payment.rate,department:person.department,party:employeeId,ref:run.id,accountId:payment.accountId};return balanceLines([match(events,'payroll_payable',d,units,1,run.id),line('cash',-units,d)])}
export function splitCost(amount,parts){const bps=parts.map(p=>Math.round(Number(p.percent)*100));if(!Number.isSafeInteger(amount)||amount<0||!parts.length||bps.some(n=>!Number.isInteger(n)||n<0)||bps.reduce((a,b)=>a+b,0)!==10000)throw new Error('Allocation percentages must total 100.');const exact=bps.map((p,i)=>{const n=BigInt(amount)*BigInt(p);return {i,amount:Number(n/10000n),remainder:Number(n%10000n)}});let left=amount-exact.reduce((n,p)=>n+p.amount,0);for(const p of [...exact].sort((a,b)=>b.remainder-a.remainder||a.i-b.i)){if(left--<=0)break;exact[p.i].amount++;}return parts.map((p,i)=>({...p,amount:exact[i].amount}));}
export function validateFinancialState(events){
 for(const event of events){if(!event.ledger.length||event.ledger.some(l=>!Number.isSafeInteger(l.amount)||!Number.isSafeInteger(l.units??l.amount))||event.ledger.reduce((n,l)=>n+l.amount,0)!==0)throw new Error('Journal entries must balance using integer money.');}
 const grouped=new Map();for(const l of normalizedLines(events)){
  const key=[l.account,l.account==='cash'?'':l.party,l.currency,l.account==='cash'?l.accountId:'', ['receivable','payable','payroll_payable','prepaid','deferred','tax','deposit'].includes(l.account)?l.ref:'', ['deferred','tax'].includes(l.account)?l.sourceLineId||'':''].join('|');const old=grouped.get(key)||{...l,total:0};old.total+=l.units;grouped.set(key,old);
 }
 for(const b of grouped.values()){
  if(['cash','receivable','unbilled','staff_advance','prepaid','deposit'].includes(b.account)&&b.total<0)throw new Error('This exceeds an available cash, receivable or advance balance.');
  if(liabilityAccounts.includes(b.account)&&b.total>0)throw new Error('This exceeds an outstanding liability or client funds balance.');
 }
 const lines=normalizedLines(events);for(const currency of new Set(lines.map(l=>l.currency))){const cash=lines.filter(l=>l.account==='cash'&&l.currency===currency).reduce((n,l)=>n+l.units,0),ad=lines.filter(l=>l.account==='ad_funds'&&l.currency===currency).reduce((n,l)=>n+l.units,0);if(cash+ad<0)throw new Error('Cash reserved for client advertising cannot fund company payments.');}
 return true;
}
export function summary(events,month='',department='All departments',allocations=[]){
 const all=normalizedLines(events),period=all.filter(l=>(!month||l.date.startsWith(month))&&(department==='All departments'||l.department===department));
 const sum=(ls,a)=>ls.filter(l=>l.account===a).reduce((n,l)=>n+l.amount,0);let revenue=0-sum(period,'revenue'),expenses=sum(period,'expense');
 for(const a of allocations){if(a.status!=='Approved'||(month&&a.month!==month))continue;if(department==='All departments')continue;if(department==='Corporate')expenses-=a.amount;else expenses+=(a.parts||[]).filter(p=>p.department===department).reduce((n,p)=>n+p.amount,0);}
 return {revenue,expenses,profit:revenue-expenses,fx:0-sum(period,'fx'),cash:sum(all,'cash'),receivable:sum(all,'receivable'),unbilled:sum(all,'unbilled'),ownerDue:0-sum(all,'owner_due'),ownerLoan:0-sum(all,'owner_loan'),clientAdvance:0-sum(all,'advance'),clientFunds:0-sum(all,'ad_funds'),clientCredit:0-sum(all,'client_credit'),payables:0-sum(all,'payable'),payrollDue:0-sum(all,'payroll_payable'),available:sum(all,'cash')+sum(all,'ad_funds')};
}
export function attendanceDuration(clockIn,clockOut,breakMinutes=0){const a=Date.parse(clockIn),b=Date.parse(clockOut);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>24*3600000)throw new Error('A shift must end after clock in and within 24 hours.');const elapsed=Math.round((b-a)/60000);if(!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>elapsed)throw new Error('Break time exceeds shift duration.');return {elapsedMinutes:elapsed,breakMinutes,workedMinutes:elapsed-breakMinutes}}
export function localTimestamp(date,time){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw new Error('Choose a valid shift date and time.');const result=new Date(`${date}T${time}:00+05:00`);if(!Number.isFinite(result.getTime()))throw new Error('Invalid shift time.');return result.toISOString()}
export function leaveUnits(start,end,workingDays=[1,2,3,4,5],holidays=[],half=false){if(start>end||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end>new Date(Date.parse(start)+366*86400000).toISOString().slice(0,10))throw new Error('Choose a valid leave range of up to one year.');if(half&&start!==end)throw new Error('Half day leave must use one date.');let count=0;for(let d=new Date(start+'T12:00:00Z');d.toISOString().slice(0,10)<=end;d=new Date(d.getTime()+86400000)){if(workingDays.includes(d.getUTCDay())&&!holidays.includes(d.toISOString().slice(0,10)))count++}return half?count*.5:count}
export function parseCSV(text){if(text.length>1500000)throw new Error('CSV file is too large.');const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(quoted)quoted=false;else if(cell==='')quoted=true;else throw new Error('Invalid CSV quoting.');}else if(ch===','&&!quoted){row.push(cell);cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}else cell+=ch}if(quoted)throw new Error('Unclosed quote in CSV.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);if(rows.length>501)throw new Error('Import at most 500 rows per file.');if(!rows.length)return [];const heads=rows.shift().map(h=>h.replace(/^\uFEFF/,'').trim());if(new Set(heads).size!==heads.length)throw new Error('CSV headers must be unique.');return rows.map((values,i)=>{if(values.length!==heads.length)throw new Error('CSV column count does not match at row '+(i+2));return Object.fromEntries(heads.map((h,j)=>[h,values[j].trim()]))})}
