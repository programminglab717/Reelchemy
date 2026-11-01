import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { TrashProjects } from "@/components/TrashProjects";
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
  return <TrashProjects userId={session.user.id} />;
}
