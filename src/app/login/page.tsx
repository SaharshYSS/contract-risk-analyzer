// Owner: Saharsh — login. The SQL runs right here, inside the server action.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { mysqlPool, type Row } from '@/lib/db';
import { getUser, startSession, type Role } from '@/lib/session';
import { Notice } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  if (await getUser()) redirect('/dashboard');
  const { error, msg } = await searchParams;

  async function login(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');

    // Embedded SQL: parameterised (?) so user input can never change the query
    const [rows] = await mysqlPool.query<Row[]>(
      `SELECT user_id, full_name, email, password_hash, role, is_active
         FROM app_user
        WHERE email = ?`,
      [email],
    );
    const user = rows[0];
    // Same message for "no such user" and "wrong password"
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    if (!user.is_active) redirect('/login?error=' + encodeURIComponent('Account is deactivated'));

    await mysqlPool.query('UPDATE app_user SET last_login_at = NOW() WHERE user_id = ?', [user.user_id]);

    await startSession({ userId: user.user_id, name: user.full_name, email: user.email, role: user.role as Role });
    redirect('/dashboard');
  }

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Contract Risk Analyzer</h1>
        <p className="text-sm text-slate-500">Log in to review contracts and search clauses.</p>
      </div>
      <Notice error={error} msg={msg} />
      <form action={login} className="card space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" className="input" type="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" className="input" type="password" required />
        </div>
        <SubmitButton className="btn w-full" pending="Logging in…">Log in</SubmitButton>
        <p className="text-center text-sm text-slate-500">
          No account? <Link href="/register" className="text-indigo-600 hover:underline">Register</Link>
        </p>
      </form>
      <p className="text-center text-xs text-slate-400">Demo: admin@ / lawyer@ / reviewer@contracts.local · Password@123</p>
    </div>
  );
}
