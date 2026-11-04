import {redirect} from 'next/navigation';
import {requireChatGPTUser} from './chatgpt-auth';
import {isEmployeePortalRole} from '@/lib/session';
import Workspace from './workspace';
export const dynamic='force-dynamic';
export default async function Page(){
  const user=await requireChatGPTUser('/');
  if(isEmployeePortalRole(user.role))redirect('/portal');
  return <Workspace ownerName={user.fullName||user.displayName||'Company account'}/>;
}
