'use client';
import {useEffect,useMemo,useState,type ComponentType} from 'react';
import Link from 'next/link';
import {Activity,ArrowLeftRight,Banknote,BarChart3,Building2,CalendarCheck,CalendarClock,CalendarDays,CheckCheck,ChevronDown,Clock3,DatabaseBackup,FilePen,FileSignature,FileSpreadsheet,FileText,FolderOpen,Flag,Gavel,KeyRound,Landmark,Laptop,Layers,LayoutDashboard,ListChecks,LogOut,PanelLeftClose,PanelLeftOpen,Plane,Plug,Receipt,ReceiptText,Repeat,Scale,Search,Settings,ShieldCheck,ShoppingCart,Split,Target,Timer,Truck,Upload,UserRound,Users,Wallet,X} from 'lucide-react';

type Icon=ComponentType<{size?:number,className?:string}>;
export type NavGroup=[string,string[]];
const ICONS:Record<string,Icon>={
 Dashboard:LayoutDashboard,Approvals:CheckCheck,
 Leads:Target,Clients:Users,Proposals:FileText,Tenders:Gavel,Orders:ShoppingCart,Contracts:FileSignature,Amendments:FilePen,
 Tasks:ListChecks,Milestones:Flag,'Work logs':Timer,
 Team:UserRound,Attendance:CalendarCheck,Leave:Plane,'Leave balances':Scale,Payroll:Banknote,Shifts:Clock3,Holidays:CalendarDays,
 Invoices:Receipt,'Credit notes':ReceiptText,Expenses:Wallet,Vendors:Truck,Bills:FileSpreadsheet,Transactions:ArrowLeftRight,Accounts:Landmark,Transfers:Repeat,Reconciliation:ShieldCheck,Allocations:Split,'Cost schedules':Layers,'Period close':CalendarClock,Reports:BarChart3,
 Documents:FolderOpen,Equipment:Laptop,Renewals:Repeat,Imports:Upload,'Users and roles':KeyRound,Backups:DatabaseBackup,Integrations:Plug,Activity:Activity,Settings:Settings,
};
const GROUP_ICONS:Record<string,Icon>={Overview:LayoutDashboard,Sales:Target,Delivery:ListChecks,People:Users,Finance:Landmark,Company:Building2};
const initials=(n:string)=>n.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
const OPEN_KEY='torix.nav.closed';

type Props={groups:NavGroup[],visible:(page:string)=>boolean,page:string,onNavigate:(page:string)=>void,badges:Record<string,number>,ownerName:string,role:string,workspaceLabel:string,open:boolean,onClose:()=>void,collapsed:boolean,onToggleCollapse:()=>void};

export default function Sidebar({groups,visible,page,onNavigate,badges,ownerName,role,workspaceLabel,open,onClose,collapsed,onToggleCollapse}:Props){
 const [closed,setClosed]=useState<string[]>([]),[filter,setFilter]=useState('');
 // Read the saved collapsed groups after mount so server and client render the same markup.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{try{setClosed(JSON.parse(localStorage.getItem(OPEN_KEY)||'[]'))}catch{}},[]);
 const toggle=(g:string)=>setClosed(c=>{const n=c.includes(g)?c.filter(x=>x!==g):[...c,g];try{localStorage.setItem(OPEN_KEY,JSON.stringify(n))}catch{}return n});
 const q=filter.trim().toLowerCase();
 const shown=useMemo(()=>groups.map(([g,pages])=>({group:g,pages:pages.filter(visible).filter(p=>!q||p.toLowerCase().includes(q))})).filter(g=>g.pages.length),[groups,visible,q]);
 return <aside id="app-sidebar" className={'sb'+(open?' is-open':'')+(collapsed?' is-collapsed':'')} aria-label="Main navigation">
  <div className="sb-head">
   <Link className="sb-brand" href="/" aria-label="Torix home"><span className="sb-mark">T</span><span className="sb-wordmark"><span className="sb-word">torix<i>.</i></span><small>Solutions CRM</small></span></Link>
   <button className="sb-icon sb-collapse" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} aria-pressed={collapsed} onClick={onToggleCollapse}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button>
   <button className="sb-icon sb-close" aria-label="Close menu" onClick={onClose}><X size={18}/></button>
  </div>
  <label className="sb-search"><Search size={15}/><input type="search" placeholder="Jump to page…" aria-label="Filter navigation" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
  <nav className="sb-nav" aria-label="Pages">
   {shown.map(({group,pages})=>{const GI=GROUP_ICONS[group]||Layers,isClosed=!q&&closed.includes(group),hasActive=pages.includes(page);
    return <section className="sb-group" key={group}>
     <button className="sb-group-btn" aria-expanded={!isClosed} onClick={()=>toggle(group)} title={group}><GI size={15} className="sb-group-icon"/><span>{group}</span>{hasActive&&isClosed&&<i className="sb-dot"/>}<ChevronDown size={14} className="sb-chev"/></button>
     {!isClosed&&<ul>{pages.map(p=>{const I=ICONS[p]||FileText,n=badges[p];
      return <li key={p}><button className={'sb-item'+(page===p?' is-active':'')} aria-current={page===p?'page':undefined} title={p} onClick={()=>onNavigate(p)}><I size={17}/><span className="sb-label">{p}</span>{n>0&&<b className="sb-badge">{n}</b>}</button></li>})}</ul>}
    </section>})}
   {!shown.length&&<p className="sb-none">No page matches “{filter}”.</p>}
  </nav>
  <div className="sb-foot">
   <span className="sb-avatar" aria-hidden>{initials(ownerName)}</span>
   <span className="sb-user"><strong>{ownerName}</strong><small>{role||workspaceLabel}</small></span>
   <a className="sb-icon" href="/api/auth/logout?return_to=%2Flogin" aria-label="Sign out" title="Sign out"><LogOut size={17}/></a>
  </div>
 </aside>;
}
