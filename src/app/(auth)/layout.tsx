import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center bg-navy-900 px-5"><Logo light /></header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[12vh]">
        <div className="w-full max-w-[380px] border border-line bg-white px-6 py-6">{children}</div>
      </main>
      <footer className="px-5 py-4 text-[12px] text-faint">
        Oxina Groups · For staff of Oxina branches and registered service customers. Sign-ins are recorded.
      </footer>
    </div>
  );
}
