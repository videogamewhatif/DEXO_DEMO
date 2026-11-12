import { notFound } from "next/navigation";
import { TeamView } from "@/components/views/ManagementViews";
import { Forbidden } from "@/components/views/StatusViews";
import { getDemoOrg, demoNow } from "@/lib/demo/data";
import { getDemoRole } from "@/lib/demo/role";
import { can, type OrgRole } from "@/lib/authz/permissions";

export default async function Page({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = getDemoOrg(slug);
  if (!org) notFound();
  const role = await getDemoRole();
  if (!can(role, "members.view")) return <Forbidden permission="members.view" />;
  const now = demoNow();
  return (
    <TeamView orgSlug={slug} timezone={org.timezone} demo canManage={can(role, "members.manage")} currentUserId={null} emailConfigured
      members={org.members.map((m, i) => ({ userId: `demo-user-${i}`, email: m.email, name: m.name, role: m.role as OrgRole, createdAt: new Date(now - (60 - i) * 86400000).toISOString() }))}
      invitations={[{ id: "demo-inv", email: "nuevo@ejemplo.example", role: "viewer", expiresAt: new Date(now + 5 * 86400000).toISOString(), createdAt: new Date(now).toISOString(), status: "pending", delivery: "sent" }]} />
  );
}
