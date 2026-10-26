import Link from "next/link";
export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div><p className="text-sm font-semibold text-brand-600">404</p><h1 className="mt-1 text-2xl font-semibold">Not found</h1><p className="mt-2 text-sm text-muted">This record does not exist or is outside your access.</p><Link href="/" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">Go home</Link></div>
    </div>
  );
}
