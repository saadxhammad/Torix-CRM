import {getChatGPTUser} from '@/app/chatgpt-auth';
import {context,assertOrigin} from '@/lib/server';
import {requireCap} from '@/lib/access.mjs';
import {runMaintenance} from '@/lib/maintenance';
export const dynamic='force-dynamic';
// Anonymous service calls are protected by this owner-private Site's platform gateway.
export async function POST(request:Request){try{assertOrigin(request);const user=await getChatGPTUser();if(user)requireCap((await context('live')).access,'settings');const result=await runMaintenance('live');return Response.json(result,{headers:{'Cache-Control':'no-store'}})}catch(e){return Response.json({error:e instanceof Error?e.message:'Maintenance failed'},{status:400})}}
