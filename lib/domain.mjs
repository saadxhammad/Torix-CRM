export const DEPARTMENTS=['Marketing','Medical Billing','Development','Corporate'];
/** @type {Record<string,string>} */
export const FINANCE_KINDS={earned:'Earned service',collection:'Client payment',client_advance:'Client advance',apply_advance:'Apply client advance',expense:'Company paid expense',owner_expense:'Owner paid expense',owner_repayment:'Reimburse owner',owner_loan:'Owner loan received',loan_repayment:'Repay owner loan',capital:'Capital contribution',drawing:'Owner drawing',ad_deposit:'Client ad funds received',ad_spend:'Spend client ad funds'};
export const CLIENT_KINDS=['earned','collection','client_advance','apply_advance','ad_deposit','ad_spend'];
export const OWNER_KINDS=['owner_expense','owner_repayment','owner_loan','loan_repayment','capital','drawing'];
export function parseMoney(value){
 const s=String(value??'').trim();if(!/^\d{1,10}(\.\d{1,2})?$/.test(s))throw new Error('Enter a positive amount with up to two decimal places.');
 const [whole,fraction='']=s.split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(result)||result<=0)throw new Error('Amount must be greater than zero.');return result;
}
export function formatMoney(minor,currency='PKR',compact=false){const n=minor/100;if(compact&&Math.abs(n)>=1000000)return `${currency} ${(n/1000000).toFixed(2)}m`;return `${currency} ${new Intl.NumberFormat('en-PK',{maximumFractionDigits:2}).format(n)}`;}
export function ledgerFor(event){
 if(!FINANCE_KINDS[event.kind])throw new Error('Choose a supported transaction type.');const amount=event.amount;
 if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Invalid amount.');
 const patterns={earned:['receivable','revenue'],collection:['cash','receivable'],client_advance:['cash','advance'],apply_advance:['advance','receivable'],expense:['expense','cash'],owner_expense:['expense','owner_due'],owner_repayment:['owner_due','cash'],owner_loan:['cash','owner_loan'],loan_repayment:['owner_loan','cash'],capital:['cash','equity'],drawing:['equity','cash'],ad_deposit:['cash','ad_funds'],ad_spend:['ad_funds','cash']};
 return patterns[event.kind].map((account,i)=>({account,amount:i===0?amount:-amount,party:['receivable','advance','ad_funds'].includes(account)?event.clientId:(['owner_due','owner_loan','equity'].includes(account)?event.person:''),department:event.department}));
}
export function balances(events){
 const totals={cash:0,revenue:0,expense:0,receivable:0,advance:0,owner_due:0,owner_loan:0,equity:0,ad_funds:0};/** @type {Record<string,number>} */ const parties={};
 for(const event of events)for(const line of event.ledger){totals[line.account]=(totals[line.account]||0)+line.amount;if(line.party){const key=line.account+'|'+line.party;parties[key]=(parties[key]||0)+line.amount;}}
 return {totals,parties};
}
export function validateLedger(events){
 for(const event of events)if(event.ledger.reduce((n,l)=>n+l.amount,0)!==0)throw new Error('The transaction is not balanced.');
 const {totals,parties}=balances(events);if(totals.cash<0)throw new Error('Company cash is insufficient. Record funding first, or use Owner paid expense.');
 if(totals.cash+totals.ad_funds<0)throw new Error('Cash reserved for client advertising cannot pay company expenses.');
 for(const [key,value]of Object.entries(parties)){const account=key.split('|')[0];if(account==='receivable'&&value<0)throw new Error('This exceeds the client earned service balance. Use Client advance for an advance payment.');if(['advance','owner_due','owner_loan','ad_funds'].includes(account)&&value>0)throw new Error('This exceeds the available client funds, advance, or owner balance.');}
 return {totals,parties};
}
export function summarize(events,month='',department='All departments'){
 const filtered=events.filter(e=>(!month||e.date.startsWith(month))&&(department==='All departments'||e.department===department));const period=balances(filtered).totals;const all=balances(events).totals;
 return {revenue:0-period.revenue,expenses:period.expense,profit:0-period.revenue-period.expense,cash:all.cash,receivable:all.receivable,ownerDue:0-all.owner_due,ownerLoan:0-all.owner_loan,clientAdvance:0-all.advance,clientFunds:0-all.ad_funds,available:all.cash+all.ad_funds};
}
export function safeCsv(rows){return rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
