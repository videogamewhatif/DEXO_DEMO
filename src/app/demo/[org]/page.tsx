import { redirect } from "next/navigation";
export default async function DemoOrgIndex({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/demo/${org}/resumen`);
}
