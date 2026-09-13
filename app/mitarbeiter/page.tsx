import Link from 'next/link';
import { einladungenBereit } from '@/lib/einladungen/db';
import { mitarbeiterListe } from '@/lib/mitarbeiter/verzeichnis';
import { hatRecht } from '@/lib/rollen';
import { rollenHolen } from '@/lib/zugang';
import { seiteSchuetzen } from '../schutz';
import { RollenWahl, ZugangsKnopf } from './steuerung';
import { datum, datumZeit } from './format';

export const metadata = { title: 'Mitarbeiter · AufmaßX' };
export const dynamic = 'force-dynamic';

/**
 * Mitarbeiterübersicht.
 *
 * Eine Liste, keine Kartei: Wer sie öffnet, will auf einen Blick sehen, wer
 * im Betrieb arbeitet, mit welcher Rolle und ob der Zugang noch gilt. Die
 * Details zu einer Person – was sie angelegt hat – stehen eine Ebene tiefer.
 *
 * Auf dem iPad ist die Tabelle waagerecht scrollbar und jede Zeile hat volle
 * Trefferhöhe; unter 720 px wird aus jeder Zeile eine Karte (siehe
 * globals.css), damit auf dem Telefon nichts abgeschnitten wird.
 */
export default async function MitarbeiterSeite() {
  const zugang = await seiteSchuetzen('mitarbeiter.ansehen');
  const [liste, rollen] = await Promise.all([mitarbeiterListe(), rollenHolen()]);

  const darfVerwalten = hatRecht(zugang.rechte, 'mitarbeiter.verwalten');
  const darfLoeschen = hatRecht(zugang.rechte, 'mitarbeiter.loeschen');
  const darfRollen = hatRecht(zugang.rechte, 'rollen.verwalten');

  const aktive = liste.filter(m => m.aktiv).length;

  return (
    <main className="admin-seite">
      <div className="admin-wrap admin-wrap--breit">
        <header className="admin-kopf">
          <div>
            <h1>Mitarbeiter</h1>
            <p className="admin-hinweis">
              {liste.length} Zugang{liste.length === 1 ? '' : 'änge'} · {aktive} aktiv
            </p>
          </div>
          <nav className="admin-navi">
            {darfRollen ? (
              <Link className="admin-knopf-klein" href="/rollen">Rollen &amp; Rechte</Link>
            ) : null}
            {darfVerwalten && einladungenBereit() ? (
              <Link className="admin-knopf-klein" href="/admin/einladungen">Einladen</Link>
            ) : null}
            <Link className="admin-knopf-klein" href="/app">Zur Anwendung</Link>
          </nav>
        </header>

        <div className="admin-karte admin-rollen">
          <table className="admin-tabelle mv-tabelle">
            <thead>
              <tr>
                <th>Name</th>
                <th>E-Mail</th>
                <th>Rolle</th>
                <th>Status</th>
                <th>Registriert</th>
                <th>Letzter Login</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.length === 0 ? (
                <tr><td colSpan={7}>Noch keine Mitarbeiter angelegt.</td></tr>
              ) : liste.map(person => (
                <tr key={person.id} className={person.aktiv ? '' : 'mv-zeile--inaktiv'}>
                  <td data-spalte="Name">
                    <Link className="mv-name" href={`/mitarbeiter/${person.id}`}>
                      {person.name}
                    </Link>
                    {person.id === zugang.userId
                      ? <span className="mv-hinweis-klein">das sind Sie</span>
                      : null}
                  </td>
                  <td data-spalte="E-Mail">{person.email || '—'}</td>
                  <td data-spalte="Rolle">
                    <RollenWahl
                      person={person}
                      rollen={rollen}
                      darfVerwalten={darfVerwalten}
                      selbst={person.id === zugang.userId}
                    />
                  </td>
                  <td data-spalte="Status">
                    <span className={`admin-status admin-status--${person.aktiv ? 'aktiv' : 'widerrufen'}`}>
                      {person.aktiv ? 'Aktiv' : 'Deaktiviert'}
                    </span>
                  </td>
                  <td data-spalte="Registriert">{datum(person.registriertAm)}</td>
                  <td data-spalte="Letzter Login">
                    {person.letzterLogin ? datumZeit(person.letzterLogin) : 'noch nie'}
                  </td>
                  <td data-spalte="">
                    <ZugangsKnopf
                      person={person}
                      rollen={rollen}
                      darfLoeschen={darfLoeschen}
                      selbst={person.id === zugang.userId}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="admin-hinweis">
          Ein deaktivierter Zugang kann sich nicht mehr anmelden. Seine
          Projekte, Aufmaße und Zeichnungen bleiben dem Betrieb vollständig
          erhalten – einschließlich des Vermerks, wer sie angelegt hat.
        </p>
      </div>
    </main>
  );
}
