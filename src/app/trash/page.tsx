import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { TrashProjects } from "@/components/TrashProjects";
export default async function Page() {
  let session;
  try {
    session = await (
      await getAuth()
    ).api.getSession({ headers: await headers() });
  } catch {
    redirect("/sign-in");
  }
  if (!session?.user.emailVerified) redirect("/sign-in");
  return <TrashProjects />;
}
