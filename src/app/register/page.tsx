// Owner: Saharsh — self-registration (always role 'reviewer').
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { mysqlPool, dbErrorMessage } from '@/lib/db';
import { Notice } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  async function register(formData: FormData) {
    'use server';
    const fullName = String(formData.get('full_name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');

    // App-level password rule (the database cannot see the plain password)
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      redirect('/register?error=' + encodeURIComponent('Password needs 8+ characters, an uppercase letter and a digit'));
    }

    let message: string | null = null;
    try {
      // Name length, email format and uniqueness are checked by the database
      // (chk_app_user_name, chk_app_user_email, uq_app_user_email).
      await mysqlPool.query(
        `INSERT INTO app_user (user_id, full_name, email, password_hash, role)
         VALUES (?, ?, ?, ?, 'reviewer')`,
        [randomUUID(), fullName, email, await bcrypt.hash(password, 10)],
      );
    } catch (err) {
      message = dbErrorMessage(err);
    }
    if (message) redirect('/register?error=' + encodeURIComponent(message));
    redirect('/login?msg=' + encodeURIComponent('Account created. Please log in.'));
  }

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Create an account</h1>
        <p className="text-sm text-slate-500">New accounts start with the reviewer role.</p>
      </div>
      <Notice error={error} />
      <form action={register} className="card space-y-4">
        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input id="name" name="full_name" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" className="input" type="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" className="input" type="password" required />
          <p className="mt-1 text-xs text-slate-400">At least 8 characters, one uppercase letter and one digit.</p>
        </div>
        <SubmitButton className="btn w-full" pending="Creating…">Register</SubmitButton>
        <p className="text-center text-sm text-slate-500">
          Have an account? <Link href="/login" className="text-indigo-600 hover:underline">Log in</Link>
        </p>
      </form>
    </div>
  );
}
