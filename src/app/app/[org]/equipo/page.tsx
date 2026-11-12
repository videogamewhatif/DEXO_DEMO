import { TeamView } from "@/components/views/ManagementViews";
import { Forbidden } from "@/components/views/StatusViews";
import { can } from "@/lib/authz/permissions";
import { getOrgDetails, requireOrgContext } from "@/lib/orgs/context";
import { loadTeam } from "@/lib/orgs/queries";
import { isEmailConfigured } from "@/config/env";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "../actions";

export default async function Page({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrgContext(slug);
  if (ctx.org.status !== "active") return null;
  if (!can(ctx.org.role, "members.view")) return <Forbidden permission="members.view" />;
  const canManage = can(ctx.org.role, "members.manage");
  const [details, team] = await Promise.all([getOrgDetails(ctx.identity, ctx.org.id), loadTeam(ctx.identity, ctx.org.id, canManage)]);
  return (
    <TeamView
      orgSlug={slug}
      timezone={details?.timezone ?? "UTC"}
      demo={false}
      canManage={canManage}
      currentUserId={ctx.identity.userId}
      emailConfigured={isEmailConfigured()}
      members={team.members}
      invitations={team.invitations}
      actions={{ invite: inviteMemberAction, revoke: revokeInvitationAction, changeRole: changeRoleAction, remove: removeMemberAction }}
    />
  );
}
