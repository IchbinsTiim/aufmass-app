import { Marke } from '../marke';
import { EinladungsAblauf } from './ablauf';

export const metadata = { title: 'Einladungscode · AufmaßX' };

/**
 * Zugang mit Einladungscode.
 *
 * Die Seite selbst ist öffentlich – sie muss es sein, sonst käme ein neuer
 * Mitarbeiter nie hierher. Sie gibt aber nichts preis: geprüft wird auf dem
 * Server, und das Konto entsteht ausschließlich über eine Route, die den
 * Code noch einmal verbindlich einlöst.
 */
export default function EinladungsSeite() {
  return (
    <main className="auth-seite">
      <div className="auth-inhalt">
        <Marke untertitel="Sie haben einen Einladungscode von Ihrem Administrator erhalten? Dann geht es hier weiter." />
        <EinladungsAblauf />
      </div>
    </main>
  );
}
