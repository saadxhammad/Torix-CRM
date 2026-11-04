import { redirect } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { isEmployeePortalRole } from "@/lib/session";
import EmployeePortal from "./employee-portal";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const user = await requireChatGPTUser("/portal");
  if (!isEmployeePortalRole(user.role)) {
    redirect("/");
  }
  return (
    <EmployeePortal
      displayName={user.fullName || user.displayName || user.email}
      email={user.email}
    />
  );
}
