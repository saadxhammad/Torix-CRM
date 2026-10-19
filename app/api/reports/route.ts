import {context} from '@/lib/server';
import {reports} from '@/lib/reports.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const q=new URL(request.url).searchParams,c=await context(q.get('mode')||'live');return Response.json(reports(c,{month:q.get('month')||'',asOf:q.get('asOf')||'',department:q.get('department')||'All departments'}),{headers:{'Cache-Control':'no-store'}})}catch(e){return Response.json({error:e instanceof Error?e.message:'Report unavailable'},{status:400})}}
