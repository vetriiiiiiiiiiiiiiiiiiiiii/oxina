import Link from "next/link";
import { requireCustomerPage } from "@/lib/auth/current";
import { Logo } from "@/components/shell/logo";
import { SignOut } from "./sign-out";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireCustomerPage();
  return (
    <div className="min-h-dvh">
      <header className="bg-navy-900">
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4">
          <Link href="/portal"><Logo light compact /></Link>
          <div className="flex items-center gap-4 text-[13px] text-white/70"><span className="hidden sm:inline">{actor.name}</span><SignOut /></div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 pb-8 text-[12px] text-faint">
        Oxina Groups service portal. Your details are used only to service your vehicle and contact you about it. <Link href="/change-password" className="underline">Change password</Link>
      </footer>
    </div>
  );
}
