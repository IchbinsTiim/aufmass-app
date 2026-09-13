import Link from 'next/link';
import { notFound } from 'next/navigation';
import { abfrageHolen } from '@/lib/einladungen/db';
import { AKTIVITAET_TEXT, aktivitaetenLesen } from '@/lib/mitarbeiter/aktivitaet';
import {
  kennzahlenVonMitarbeiter, projekteVonMitarbeiter, zeichnungenVonMitarbeiter
} from '@/lib/mitarbeiter/daten';
import { mitarbeiterHolen } from '@/lib/mitarbeiter/verzeichnis';
import { hatRecht, rolleBeschriftung } from '@/lib/rollen';
import { rollenHolen } from '@/lib/zugang';
import { seiteSchuetzen } from '../../schutz';
import { RollenWahl, ZugangsKnopf } from '../steuerung';
import { datum, datumZeit } from '../format';

export const metadata = { title: 'Mitarbeiter · AufmaßX' };
export const dynamic = 'force-dynamic';

/**
 * Mitarbeiter-Detailseite: „Was hat diese Person angelegt?"
 *
 * Drei Listen, in der Reihenfolge, in der im Betrieb gefragt wird:
 * Projekte, die Aufmaße darin, die 2D-Zeichnungen. Darunter das
 * Aktivitätsprotokoll – es beantwortet, was die Listen nicht können:
 * gelöschte Projekte und Änderungen an fremden Datensätzen.
 *
 * „Aufmaß" ist in AufmaßX kein eigener Datensatz, sondern der Teil `seiten`
 * einer Projektakte. Deshalb steht es hier je Projekt und nicht als eigene
 * Kartei – alles andere wäre eine erfundene Struktur, die es in den Daten
 * nicht gibt. Siehe lib/mitarbeiter/daten.ts.
 */
export default async function MitarbeiterDetail(
  { params }: { params: Promise<{ id: string }> }
) {
  const zugang = await seiteSchuetzen('mitarbeiter.ansehen');
  const { id } = await params;

  const person = await mitarbeiterHolen(id);
  if (!person) notFound();

  const abfrage = abfrageHolen();
  const [rollen, projekte, zeichnungen, kennzahlen, aktivitaeten] = await Promise.all([
    rollenHolen(),
    projekteVonMitarbeiter(abfrage, id),
    zeichnungenVonMitarbeiter(abfrage, id),
    kennzahlenVonMitarbeiter(abfrage, id),
    aktivitaetenLesen(abfrage, id)
  ]);

  const mitAufmass = projekte.filter(p => p.seiten > 0);
  const mitZeichnung = projekte.filter(p => p.felder2d > 0);
  const selbst = person.id === zugang.userId;

  return (
    <main className="admin-seite">
      <div className="admin-wrap admin-wrap--breit">
        <header className="admin-kopf">
          <div>
            <Link className="mv-zurueck" href="/mitarbeiter">← Alle Mitarbeiter</Link>
            <h1>{person.name}</h1>
            <p className="admin-hinweis">
              {person.email || 'ohne E-Mail'} · {rolleBeschriftung(person.rolle, rollen)}
              {' · '}
              <span className={`admin-status admin-status--${person.aktiv ? 'aktiv' : 'widerrufen'}`}>
                {person.aktiv ? 'Aktiv' : 'Deaktiviert'}
              </span>
            </p>
          </div>
          <nav className="admin-navi">
            <Link className="admin-knopf-klein" href="/mitarbeiter">Übersicht</Link>
            <Link className="admin-knopf-klein" href="/app">Zur Anwendung</Link>
          </nav>
        </header>

        <div className="admin-karte mv-kopfkarte">
          <dl className="mv-stammdaten">
            <div><dt>Registriert</dt><dd>{datum(person.registriertAm)}</dd></div>
            <div><dt>Letzter Login</dt>
                 <dd>{person.letzterLogin ? datumZeit(person.letzterLogin) : 'noch nie angemeldet'}</dd></div>
            <div><dt>Angelegte Projekte</dt><dd>{kennzahlen.projekte}</dd></div>
            <div><dt>Gespeicherte Zeichnungen</dt><dd>{kennzahlen.zeichnungen}</dd></div>
            <div><dt>Zuletzt gearbeitet</dt>
                 <dd>{kennzahlen.zuletzt ? datumZeit(kennzahlen.zuletzt) : '—'}</dd></div>
          </dl>
          <div className="mv-kopfaktionen">
            <RollenWahl
              person={person}
              rollen={rollen}
              darfVerwalten={hatRecht(zugang.rechte, 'mitarbeiter.verwalten')}
              selbst={selbst}
            />
            <ZugangsKnopf
              person={person}
              rollen={rollen}
              darfLoeschen={hatRecht(zugang.rechte, 'mitarbeiter.loeschen')}
              selbst={selbst}
            />
          </div>
        </div>

        {!abfrage ? (
          <div className="admin-karte">
            <p className="admin-hinweis">
              Ohne <code>DATABASE_URL</code> gibt es keine Cloud-Projekte – die
              Listen bleiben deshalb leer.
            </p>
          </div>
        ) : null}

        <Abschnitt titel="Erstellte Projekte" leer="Dieser Mitarbeiter hat noch kein Projekt angelegt.">
          {projekte.length ? (
            <table className="admin-tabelle mv-tabelle">
              <thead>
                <tr>
                  <th>Projektname</th><th>Erstellt</th><th>Letzte Änderung</th><th>Inhalt</th>
                </tr>
              </thead>
              <tbody>
                {projekte.map(p => (
                  <tr key={p.id}>
                    <td data-spalte="Projektname">{p.titel}</td>
                    <td data-spalte="Erstellt">{datum(p.erstelltAm)}</td>
                    <td data-spalte="Letzte Änderung">{datumZeit(p.geaendertAm)}</td>
                    <td data-spalte="Inhalt">
                      {p.seiten} Seite{p.seiten === 1 ? '' : 'n'} · {p.positionen} Position
                      {p.positionen === 1 ? '' : 'en'} · {p.felder2d} Feld{p.felder2d === 1 ? '' : 'er'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Abschnitt>

        <Abschnitt titel="Erstellte Aufmaße"
                   leer="In den Projekten dieses Mitarbeiters ist noch kein Aufmaß erfasst.">
          {mitAufmass.length ? (
            <table className="admin-tabelle mv-tabelle">
              <thead>
                <tr><th>Projekt</th><th>Bezeichnung</th><th>Datum</th><th>Letzte Änderung</th></tr>
              </thead>
              <tbody>
                {mitAufmass.map(p => (
                  <tr key={p.id}>
                    <td data-spalte="Projekt">{p.titel}</td>
                    <td data-spalte="Bezeichnung">
                      Aufmaß · {p.seiten} Seite{p.seiten === 1 ? '' : 'n'},{' '}
                      {p.positionen} Position{p.positionen === 1 ? '' : 'en'}
                    </td>
                    <td data-spalte="Datum">{datum(p.erstelltAm)}</td>
                    <td data-spalte="Letzte Änderung">{datumZeit(p.geaendertAm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Abschnitt>

        <Abschnitt titel="2D-Zeichnungen"
                   leer="Dieser Mitarbeiter hat noch keine Zeichnung gespeichert.">
          {zeichnungen.length || mitZeichnung.length ? (
            <table className="admin-tabelle mv-tabelle">
              <thead>
                <tr><th>Name</th><th>Projekt</th><th>Erstellt</th><th>Art</th></tr>
              </thead>
              <tbody>
                {zeichnungen.map(z => (
                  <tr key={z.id}>
                    <td data-spalte="Name">{z.name}</td>
                    <td data-spalte="Projekt">{z.projektTitel}</td>
                    <td data-spalte="Erstellt">{datumZeit(z.erstelltAm)}</td>
                    <td data-spalte="Art">
                      {z.quelle === 'upload' ? 'Hochgeladen' : 'Gespeicherter Stand'}
                    </td>
                  </tr>
                ))}
                {/* Die laufende Zeichnung liegt im Projekt selbst und ist kein
                    eigener Speicherstand – sie wird trotzdem ausgewiesen,
                    sonst fehlte die Arbeit dessen, der nie „Speichern unter"
                    benutzt hat. */}
                {mitZeichnung.map(p => (
                  <tr key={'p-' + p.id}>
                    <td data-spalte="Name">Zeichnung im Projekt ({p.felder2d} Felder)</td>
                    <td data-spalte="Projekt">{p.titel}</td>
                    <td data-spalte="Erstellt">{datum(p.erstelltAm)}</td>
                    <td data-spalte="Art">Laufende Zeichnung</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Abschnitt>

        <Abschnitt titel="Aktivität" leer="Noch keine Ereignisse protokolliert.">
          {aktivitaeten.length ? (
            <ul className="mv-aktivitaet">
              {aktivitaeten.map(a => (
                <li key={a.id}>
                  <span className="mv-aktivitaet-zeit">{datumZeit(a.zeitpunkt)}</span>
                  <span className="mv-aktivitaet-art">{AKTIVITAET_TEXT[a.art] ?? a.art}</span>
                  {a.objektTitel ? <span className="mv-aktivitaet-objekt">{a.objektTitel}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Abschnitt>
      </div>
    </main>
  );
}

function Abschnitt(
  { titel, leer, children }: { titel: string; leer: string; children: React.ReactNode }
) {
  return (
    <section className="admin-karte admin-rollen">
      <h2 className="mv-abschnitt-titel">{titel}</h2>
      {children ?? null}
      {children ? null : <p className="admin-hinweis">{leer}</p>}
    </section>
  );
}
