import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { TrashProjects } from "@/components/TrashProjects";
import { AccountBoundary } from "@/components/AccountBoundary";
export default async function Page() {
  const requestHeaders = await headers();
  let session;
  try {
    session = await (
      await getAuth()
    ).api.getSession({ headers: requestHeaders });
  } catch {
    redirect("/sign-in");
  }
  if (!session?.user.emailVerified) redirect("/sign-in");
  return (
    <AccountBoundary key={session.user.id} userId={session.user.id}>
      <TrashProjects key={session.user.id} userId={session.user.id} />
    </AccountBoundary>
  );
}
