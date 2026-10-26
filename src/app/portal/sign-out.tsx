"use client";
export function SignOut() {
  return (
    <button className="text-white/80 hover:text-white hover:underline" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }}>
      Sign out
    </button>
  );
}
