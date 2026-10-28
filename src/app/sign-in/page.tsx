import { Suspense } from "react";
import { AccountForm } from "@/components/AccountForm";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading account…</p>}>
      <AccountForm />
    </Suspense>
  );
}
