import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/current";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(actor.kind === "CUSTOMER" ? "/portal" : "/dashboard");
  return (
    <>
      <h1 className="text-[18px] font-semibold">Sign in</h1>
      <p className="mb-5 text-[13px] text-muted">Use your work email, or the email you gave the service centre.</p>
      <AuthForm
        url="/api/auth/login"
        submit="Sign in"
        fields={[
          { name: "identifier", label: "Email or username", type: "text", autoComplete: "username" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
        extra={<p className="text-[13px]"><Link href="/forgot-password" className="text-brand-600 hover:underline">Forgot your password?</Link></p>}
      />
    </>
  );
}
