import Link from 'next/link';
import { redirect } from 'next/navigation';
import { abfrageHolen, einladungenBereit } from '@/lib/einladungen/db';
import { einladungenAuflisten, type Einladung } from '@/lib/einladungen/kern';
import { hatRecht, rolleBeschriftung } from '@/lib/rollen';
import { rollenHolen, zugangMitRechten } from '@/lib/zugang';
import { AnlegeFormular } from './formular';
import { codeWiderrufen } from './aktionen';

export const metadata = { title: 'Einladungen · AufmaßX' };
export const dynamic = 'force-dynamic';

/**
 * Mitarbeiter einladen.
 *
 * Ein Code wird hier erzeugt, EINMAL angezeigt und danach nie wieder: in der
 * Datenbank liegt nur sein Hash. Wer ihn verliert, widerruft ihn und legt
 * einen neuen an.
 */
export default async function EinladungsVerwaltung() {
  const zugang = await zugangMitRechten();
  if (zugang.grund === 'nicht-angemeldet') redirect('/sign-in');
  if (!zugang.erlaubt) redirect('/kein-zugang');
  // Nicht mehr „ist Admin", sondern „darf Mitarbeiter verwalten": Eine eigene
  // Rolle mit diesem Recht kommt genauso herein (siehe lib/rollen.ts).
  if (!hatRecht(zugang.rechte, 'mitarbeiter.verwalten')) redirect('/app');

  const bereit = einladungenBereit();
  const abfrage = abfrageHolen();
  const [liste, rollen] = await Promise.all([
    bereit && abfrage ? einladungenAuflisten(abfrage) : Promise.resolve([] as Einladung[]),
    rollenHolen()
  ]);

  return (
    <main className="admin-seite">
      <div className="admin-wrap">
        <header className="admin-kopf">
          <h1>Mitarbeiter einladen</h1>
          <nav className="admin-navi">
            <Link className="admin-knopf-klein" href="/mitarbeiter">Mitarbeiter</Link>
            <Link className="admin-knopf-klein" href="/rollen">Rollen</Link>
            <Link className="admin-knopf-klein" href="/app">Zur Anwendung</Link>
          </nav>
        </header>

        {!bereit ? (
          <div className="admin-karte">
            <p className="admin-hinweis">
              Einladungen sind noch nicht eingerichtet. Es fehlen{' '}
              <code>DATABASE_URL</code> und/oder <code>EINLADUNG_PEPPER</code> in
              den Umgebungsvariablen, oder die Tabellen aus{' '}
              <code>db/schema.sql</code> wurden noch nicht angelegt. Die
              Einrichtung steht in <code>MIGRATION.md</code>.
            </p>
          </div>
        ) : (
          <>
            <AnlegeFormular rollen={rollen} />

            <div className="admin-karte admin-rollen">
              <table className="admin-tabelle">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Rolle</th>
                    <th>Gültig bis</th>
                    <th>Notiz</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {liste.length === 0 ? (
                    <tr><td colSpan={6}>Noch keine Einladung erstellt.</td></tr>
                  ) : liste.map(e => (
                    <tr key={e.id}>
                      <td><code>{e.codePraefix}-…</code></td>
                      <td><StatusPille einladung={e} /></td>
                      <td>{rolleBeschriftung(e.rolle, rollen)}</td>
                      <td>{datum(e.laeuftAbAm)}</td>
                      <td>{e.notiz || '—'}</td>
                      <td>
                        {(e.status === 'aktiv' || e.status === 'wird_eingeloest') ? (
                          <form action={codeWiderrufen}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" className="admin-knopf-klein">Widerrufen</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="admin-hinweis">
              Der vollständige Code erscheint nur einmal – direkt nach dem
              Anlegen. Gespeichert wird ausschließlich seine Prüfsumme. Ein
              verwendeter Code lässt sich nicht wiederbeleben; ein in Einlösung
              hängengebliebener wird nicht von selbst wieder gültig.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function StatusPille({ einladung }: { einladung: Einladung }) {
  const status = einladung.abgelaufen ? 'abgelaufen' : einladung.status;
  const text: Record<string, string> = {
    aktiv: 'Aktiv',
    wird_eingeloest: 'In Einlösung',
    verwendet: 'Verwendet',
    widerrufen: 'Widerrufen',
    abgelaufen: 'Abgelaufen'
  };
  return <span className={`admin-status admin-status--${status}`}>{text[status] ?? status}</span>;
}

function datum(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
