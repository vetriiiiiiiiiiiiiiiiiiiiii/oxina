"use client";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = /permission|forbidden/i.test(error.message);
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <h1 className="text-2xl font-semibold">{forbidden ? "Access denied" : "Something went wrong"}</h1>
        <p className="mt-2 text-sm text-muted">{forbidden ? "You do not have permission to view this page." : "Please try again. If it keeps happening, contact support."}{error.digest ? ` (ref ${error.digest})` : ""}</p>
        <button onClick={reset} className="mt-6 rounded-[3px] border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-canvas">Try again</button>
      </div>
    </div>
  );
}
