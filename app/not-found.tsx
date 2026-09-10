import Link from 'next/link';
import { Marke } from './marke';

export default function NichtGefunden() {
  return (
    <main className="auth-seite">
      <div className="auth-inhalt">
        <Marke untertitel="Diese Seite gibt es nicht." />
        <Link className="auth-knopf" href="/app">
          Zur Anwendung
        </Link>
      </div>
    </main>
  );
}
