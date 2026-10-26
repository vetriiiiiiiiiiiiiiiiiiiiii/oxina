import { AuthForm } from "../auth-form";
import { Notice } from "@/components/ui";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-[18px] font-semibold">Choose a new password</h1>
      <p className="mb-5 text-[13px] text-muted">At least 12 characters with upper- and lower-case letters, a number and a symbol.</p>
      {token ? (
        <AuthForm url="/api/auth/reset-password" submit="Set password" hidden={{ token }} fields={[{ name: "password", label: "New password", type: "password", autoComplete: "new-password" }]} />
      ) : (
        <Notice tone="bad">This link is incomplete. Request a new reset link.</Notice>
      )}
    </>
  );
}
