import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-[18px] font-semibold">Reset your password</h1>
      <p className="mb-5 text-[13px] text-muted">We&apos;ll email a reset link valid for 30 minutes (requires email delivery to be configured).</p>
      <AuthForm url="/api/auth/forgot-password" submit="Send reset link" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]} />
      <p className="mt-5 text-[13px]"><Link href="/login" className="text-brand-600 hover:underline">Back to sign in</Link></p>
    </>
  );
}
