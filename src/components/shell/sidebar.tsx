"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: string };
type Branch = { id: string; name: string; code: string; businessUnit: { name: string } };

export function AppShell({ nav, user, branches, selected, unread, allBranches, children }: {
  nav: { group: string; items: Item[] }[];
  user: { name: string; email: string; roles: string[] };
  branches: Branch[];
  selected: string | null;
  unread: number;
  allBranches: boolean;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [path]);

  const hrefs = nav.flatMap((g) => g.items.map((i) => i.href));
  // The longest menu link that prefixes the current path is the active one (so /service/board doesn't also light up /service).
  const best = hrefs.filter((h) => path === h || path.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === best;
  const chooseBranch = (id: string) => {
    document.cookie = `oxina_branch=${id}; path=/; samesite=lax; max-age=${60 * 60 * 24 * 90}`;
    router.refresh();
  };
  const current = branches.find((b) => b.id === selected);

  const navList = (
    <nav className="px-3 py-4 text-[14px]" aria-label="Main">
      {nav.map((g) => (
        <div key={g.group} className="mb-4">
          {g.group && <p className="mb-1 px-2 text-[12px] text-faint">{g.group}</p>}
          <ul>
            {g.items.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={active(it.href) ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between border-l-2 px-2 py-[5px]",
                    active(it.href) ? "border-navy-900 bg-white font-medium text-navy-900" : "border-transparent text-ink/80 hover:text-ink hover:underline",
                  )}
                >
                  {it.label}
                  {it.href === "/notifications" && unread > 0 && <span className="font-mono text-[12px] text-bad-700">{unread > 99 ? "99+" : unread}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-4 bg-navy-900 px-4 text-white">
        <button className="text-[13px] text-white/80 hover:text-white lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">Menu</button>
        <Link href="/dashboard"><Logo light /></Link>
        {(branches.length > 1 || allBranches) ? (
          <label className="hidden items-center gap-2 text-[13px] text-white/60 md:flex">
            Branch
            <select value={selected ?? ""} onChange={(e) => chooseBranch(e.target.value)} className="h-7 max-w-[240px] rounded-[3px] border border-white/20 bg-navy-800 px-1.5 text-[13px] text-white">
              <option value="">All my branches ({branches.length})</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        ) : branches[0] ? <span className="hidden text-[13px] text-white/70 md:inline">{branches[0].name}</span> : null}
        <form action="/search" className="ml-auto hidden sm:block" role="search">
          <input name="q" placeholder="Job no., registration, customer…" aria-label="Search" className="h-7 w-64 rounded-[3px] border border-white/15 bg-white/10 px-2 text-[13px] text-white placeholder:text-white/45 focus:bg-white focus:text-ink focus:outline-none" />
        </form>
        <div className="ml-auto flex items-center gap-4 text-[13px] sm:ml-0">
          <Link href="/notifications" className="text-white/80 hover:text-white">Inbox{unread > 0 && <span className="ml-1 font-mono text-[12px] text-amber-300">{unread}</span>}</Link>
          <UserMenu name={user.name} />
        </div>
      </header>
      {current && <div className="border-b border-line bg-shade px-4 py-1 text-[12px] text-muted lg:pl-[236px]">Showing <b className="font-medium text-ink">{current.name}</b> only · <button className="text-brand-600 hover:underline" onClick={() => chooseBranch("")}>show all my branches</button></div>}

      <div className="lg:flex">
        <aside className="hidden w-[220px] shrink-0 border-r border-line lg:block">
          <div className="sticky top-12 max-h-[calc(100dvh-3rem)] overflow-y-auto">{navList}</div>
        </aside>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal>
            <div className="absolute inset-0 bg-navy-950/40" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-line bg-canvas">
              <div className="flex h-12 items-center justify-between bg-navy-900 px-4"><Logo light /><button className="text-[13px] text-white/80" onClick={() => setOpen(false)}>Close</button></div>
              {(branches.length > 1 || allBranches) && (
                <div className="border-b border-line px-5 py-3">
                  <select value={selected ?? ""} onChange={(e) => chooseBranch(e.target.value)} className="h-8 w-full rounded-[3px] border border-line-strong bg-white px-1.5 text-[13px]" aria-label="Branch">
                    <option value="">All my branches</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              {navList}
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-[1360px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function UserMenu({ name }: { name: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="text-white/80 hover:text-white" aria-haspopup="menu" aria-expanded={open}>
        {name.split(" ")[0]} ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 border border-line-strong bg-white py-1 text-[13px] text-ink" role="menu">
          <Link href="/change-password" className="block px-3 py-1.5 hover:bg-shade" role="menuitem">Change password</Link>
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-shade" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
