import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/current";
import { AuthForm } from "../auth-form";
import { Notice } from "@/components/ui";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return (
    <>
      <h1 className="text-[18px] font-semibold">Change your password</h1>
      {actor.mustChangePassword && <div className="mt-4"><Notice tone="warn">You must set a new password before continuing.</Notice></div>}
      <div className="mt-6">
        <AuthForm
          url="/api/auth/change-password"
          submit="Update password"
          fields={[
            { name: "currentPassword", label: "Current password", type: "password", autoComplete: "current-password" },
            { name: "newPassword", label: "New password", type: "password", autoComplete: "new-password", hint: "12+ characters with upper/lower case, number and symbol." },
          ]}
        />
      </div>
    </>
  );
}
