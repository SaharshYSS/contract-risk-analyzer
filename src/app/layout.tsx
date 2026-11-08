// Owner: Saharsh — page frame + role-aware navigation + logout.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import './globals.css';
import { endSession, getUser } from '@/lib/session';

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();

  async function logout() {
    'use server';
    await endSession();
    redirect('/login');
  }

  return (
    <html lang="en">
      <head>
        <title>Contract Risk Analyzer</title>
      </head>
      <body className="min-h-screen antialiased">
        {user && (
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-6">
                <Link href="/dashboard" className="font-semibold text-slate-900">
                  Contract<span className="text-indigo-600">Risk</span>
                </Link>
                <nav className="flex gap-1 text-sm">
                  <Link className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100" href="/dashboard">Dashboard</Link>
                  <Link className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100" href="/contracts">Contracts</Link>
                  <Link className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100" href="/contracts/new">Upload</Link>
                  <Link className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100" href="/search">Clause search</Link>
                </nav>
              </div>
              <form action={logout} className="flex items-center gap-3 text-sm">
                <span className="text-slate-600">{user.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-600">{user.role}</span>
                <button className="btn-ghost">Log out</button>
              </form>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
