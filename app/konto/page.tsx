import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignOutButton, UserButton } from '@clerk/nextjs';
import { currentUser } from '@clerk/nextjs/server';
import { Marke } from '../marke';
import { rolleBeschriftung } from '@/lib/rollen';
import { zugangPruefen } from '@/lib/zugang';

export const metadata = { title: 'Konto · AufmaßX' };

/**
 * Konto – erreichbar aus der Fußzeile des Startbildschirms der App.
 *
 * Hier steht, wer angemeldet ist und mit welcher Rolle; Clerks Benutzer-Menü
 * übernimmt Profil und Passwort. Bewusst eine eigene Seite und kein Knopf in
 * der App: die Modul-Leiste wird während der Arbeit dauernd angetippt, dort
 * hat ein Abmelden-Knopf nichts verloren.
 */
export default async function KontoSeite() {
  const zugang = await zugangPruefen();
  if (zugang.grund === 'nicht-angemeldet') redirect('/sign-in');
  if (!zugang.erlaubt) redirect('/kein-zugang');

  const user = await currentUser();
  const name =
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    user?.username ||
    'Angemeldet';

  return (
    <main className="auth-seite">
      <div className="auth-inhalt">
        <Marke />

        <div className="konto-karte">
          <UserButton />
          <div className="konto-text">
            <strong>{name}</strong>
            <span>{rolleBeschriftung(zugang.rolle)}</span>
          </div>
        </div>

        <Link className="auth-knopf" href="/app">
          Zurück zur Anwendung
        </Link>

        {zugang.rolle === 'admin' ? (
          <Link className="auth-knopf auth-knopf--leise" href="/admin/einladungen">
            Mitarbeiter einladen
          </Link>
        ) : null}

        <SignOutButton redirectUrl="/sign-in">
          <button type="button" className="auth-knopf auth-knopf--leise">
            Abmelden
          </button>
        </SignOutButton>

        <p className="auth-fuss">
          Ihre Projekte liegen auf diesem Gerät und bleiben beim Abmelden
          erhalten.
        </p>
      </div>
    </main>
  );
}
