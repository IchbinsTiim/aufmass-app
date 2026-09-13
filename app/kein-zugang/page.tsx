import { SignOutButton } from '@clerk/nextjs';
import { currentUser } from '@clerk/nextjs/server';
import { Marke } from '../marke';
import { zugangPruefen } from '@/lib/zugang';

export const metadata = { title: 'Zugang nicht freigeschaltet · AufmaßX' };

/**
 * Angemeldet, aber nicht freigeschaltet.
 *
 * Diese Seite ist kein Hinweis auf eine versteckte Oberfläche – die
 * Anwendung wird für dieses Konto serverseitig gar nicht ausgeliefert
 * (siehe lib/zugang.ts und app/app/[[...pfad]]/route.ts).
 */
export default async function KeinZugangSeite() {
  const [user, zugang] = await Promise.all([currentUser(), zugangPruefen()]);
  const adresse = user?.primaryEmailAddress?.emailAddress;
  // Ein deaktivierter Zugang ist etwas anderes als ein nie freigeschalteter:
  // Wer gestern noch gearbeitet hat, soll nicht raten müssen, was passiert
  // ist. Was NICHT dasteht: dass die Daten dieses Kontos erhalten bleiben –
  // das ist eine Auskunft für den Betrieb, nicht für den Gesperrten.
  const deaktiviert = zugang.grund === 'deaktiviert';

  return (
    <main className="auth-seite">
      <div className="auth-inhalt">
        <Marke untertitel={deaktiviert
          ? 'Dieser Zugang wurde deaktiviert.'
          : 'Dieses Konto ist noch nicht für AufmaßX freigeschaltet.'} />
        <p className="auth-fuss">
          {adresse ? <>Angemeldet als {adresse}. </> : null}
          {deaktiviert
            ? 'Ihr Betrieb hat den Zugang gesperrt. Wenden Sie sich an Ihren Administrator, wenn das ein Versehen ist.'
            : 'Ein Administrator muss Ihren Zugang freigeben. Melden Sie sich bei Ihrem Betrieb, wenn das länger dauert als erwartet.'}
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
