import { SignOutButton } from '@clerk/nextjs';
import { currentUser } from '@clerk/nextjs/server';
import { Marke } from '../marke';

export const metadata = { title: 'Zugang nicht freigeschaltet · AufmaßX' };

/**
 * Angemeldet, aber nicht freigeschaltet.
 *
 * Diese Seite ist kein Hinweis auf eine versteckte Oberfläche – die
 * Anwendung wird für dieses Konto serverseitig gar nicht ausgeliefert
 * (siehe lib/zugang.ts und app/app/[[...pfad]]/route.ts).
 */
export default async function KeinZugangSeite() {
  const user = await currentUser();
  const adresse = user?.primaryEmailAddress?.emailAddress;

  return (
    <main className="auth-seite">
      <div className="auth-inhalt">
        <Marke untertitel="Dieses Konto ist noch nicht für AufmaßX freigeschaltet." />
        <p className="auth-fuss">
          {adresse ? <>Angemeldet als {adresse}. </> : null}
          Ein Administrator muss Ihren Zugang freigeben. Melden Sie sich bei
          Ihrem Betrieb, wenn das länger dauert als erwartet.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <button type="button" className="auth-knopf auth-knopf--leise">
            Abmelden
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
