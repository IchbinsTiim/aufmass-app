import Link from 'next/link';
import { abfrageHolen } from '@/lib/einladungen/db';
import { rolleImEinsatz } from '@/lib/mitarbeiter/daten';
import { mitarbeiterListe } from '@/lib/mitarbeiter/verzeichnis';
import { ROLLEN_VORLAGEN } from '@/lib/rollen';
import { rollenHolen } from '@/lib/zugang';
import { seiteSchuetzen } from '../schutz';
import { RollenListe, VorlagenLeiste } from './formular';

export const metadata = { title: 'Rollen & Rechte · AufmaßX' };
export const dynamic = 'force-dynamic';

/**
 * Rollen und Rechte.
 *
 * Hier wird festgelegt, WAS eine Rolle darf; WER sie hat, steht unter
 * /mitarbeiter. Die Trennung ist Absicht: Rechte ändert man selten und mit
 * Bedacht, Zuweisungen dauernd.
 */
export default async function RollenSeite() {
  await seiteSchuetzen('rollen.verwalten');

  const abfrage = abfrageHolen();
  const [rollen, mitarbeiter] = await Promise.all([rollenHolen(), mitarbeiterListe()]);

  const belegung: Record<string, number> = {};
  rollen.forEach(r => { belegung[r.id] = rolleImEinsatz(mitarbeiter, r.id); });

  const offeneVorlagen = ROLLEN_VORLAGEN.filter(v => !rollen.some(r => r.id === v.id));

  return (
    <main className="admin-seite">
      <div className="admin-wrap admin-wrap--breit">
        <header className="admin-kopf">
          <div>
            <h1>Rollen &amp; Rechte</h1>
            <p className="admin-hinweis">
              Jede Rolle bekommt genau die Funktionen, die sie braucht. Geprüft
              werden die Rechte auf dem Server – ein ausgeblendeter Knopf ist
              keine Absicherung.
            </p>
          </div>
          <nav className="admin-navi">
            <Link className="admin-knopf-klein" href="/mitarbeiter">Mitarbeiter</Link>
            <Link className="admin-knopf-klein" href="/app">Zur Anwendung</Link>
          </nav>
        </header>

        {!abfrage ? (
          <div className="admin-karte">
            <p className="admin-hinweis">
              Eigene Rollen brauchen die Datenbank. Es fehlt <code>DATABASE_URL</code>;
              bis dahin gelten die beiden mitgelieferten Rollen. Die Einrichtung
              steht in <code>MIGRATION.md</code>.
            </p>
          </div>
        ) : (
          <VorlagenLeiste vorlagen={offeneVorlagen} />
        )}

        <RollenListe rollen={rollen} belegung={belegung} />
      </div>
    </main>
  );
}
