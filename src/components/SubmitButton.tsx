'use client';
// A submit button that shows a "working…" label while its form's server action runs.
import { useFormStatus } from 'react-dom';

export default function SubmitButton({
  children, pending, className = 'btn',
}: { children: React.ReactNode; pending?: string; className?: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button className={className} disabled={isPending}>
      {isPending ? (pending ?? 'Working…') : children}
    </button>
  );
}
