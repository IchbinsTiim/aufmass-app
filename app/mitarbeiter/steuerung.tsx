'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Mitarbeiter } from '@/lib/mitarbeiter/verzeichnis';
import type { Rolle } from '@/lib/rollen';
import {
  mitarbeiterAktivieren, mitarbeiterDeaktivieren, mitarbeiterRolleSetzen,
  type AktionsErgebnis
} from './aktionen';

/**
 * Die Bedienelemente einer Mitarbeiterzeile.
 *
 * Bewusst klein gehalten: ein Auswahlfeld für die Rolle, ein Knopf zum
 * Deaktivieren bzw. Freischalten. Alles Weitere steht auf der Detailseite.
 *
 * Auf dem iPad wird mit dem Finger bedient – jedes Element ist mindestens
 * 44 px hoch, und das Deaktivieren fragt in einem eigenen Dialog nach,
 * statt auf einen unbeabsichtigten Tipp hin zu wirken.
 */

export function RollenWahl({
  person, rollen, darfVerwalten, selbst
}: { person: Mitarbeiter; rollen: Rolle[]; darfVerwalten: boolean; selbst: boolean }) {
  const [ergebnis, aktion, laeuft] = useActionState<AktionsErgebnis | null, FormData>(
    mitarbeiterRolleSetzen, null
  );

  // Ein deaktivierter Zugang trägt keine Rolle mehr – sie liegt gemerkt in
  // `rolleVorher` und kommt beim Freischalten zurück. Angezeigt wird sie
  // trotzdem: „Ohne Rolle" wäre die falsche Auskunft über jemanden, der bis
  // gestern Bauleiter war.
  if (!person.aktiv) {
    return (
      <span className="mv-rolle-fest">
        {rollenName(rollen, person.rolleVorher ?? person.rolle)}
        <span className="mv-hinweis-klein">ausgesetzt</span>
      </span>
    );
  }
  if (!darfVerwalten || selbst) {
    return <span className="mv-rolle-fest">{rollenName(rollen, person.rolle)}</span>;
  }

  return (
    <form action={aktion} className="mv-rollenform">
      <input type="hidden" name="userId" value={person.id} />
      <select
        name="rolle"
        className="auth-eingabe mv-select"
        defaultValue={person.rolle ?? ''}
        disabled={laeuft}
        onChange={e => e.currentTarget.form?.requestSubmit()}
        aria-label={`Rolle von ${person.name}`}
      >
        {person.rolle === null ? <option value="">Ohne Rolle</option> : null}
        {rollen.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {/* Ohne JavaScript bleibt der Knopf der Weg zum Ziel. */}
      <button type="submit" className="admin-knopf-klein mv-rollenknopf" disabled={laeuft}>
        {laeuft ? '…' : 'Setzen'}
      </button>
      <Meldung ergebnis={ergebnis} />
    </form>
  );
}

export function ZugangsKnopf({
  person, rollen, darfLoeschen, selbst
}: { person: Mitarbeiter; rollen: Rolle[]; darfLoeschen: boolean; selbst: boolean }) {
  const [frage, setFrage] = useState(false);
  const [deaktiviert, deaktivieren, laeuftAus] = useActionState<AktionsErgebnis | null, FormData>(
    mitarbeiterDeaktivieren, null
  );
  const [aktiviert, aktivieren, laeuftAn] = useActionState<AktionsErgebnis | null, FormData>(
    mitarbeiterAktivieren, null
  );

  // Die Frage schließt sich, wenn die Antwort da ist – nicht schon beim
  // Antippen. Würde sie der Knopf selbst schließen, risse er sich im selben
  // Moment das Formular unter den Füßen weg.
  useEffect(() => { if (deaktiviert) setFrage(false); }, [deaktiviert]);

  if (!darfLoeschen) return null;
  if (selbst) return <span className="mv-hinweis-klein">eigener Zugang</span>;

  if (!person.aktiv) {
    return (
      <form action={aktivieren} className="mv-zugangsform">
        <input type="hidden" name="userId" value={person.id} />
        <input type="hidden" name="rolle" value={person.rolleVorher ?? ''} />
        <button type="submit" className="admin-knopf-klein" disabled={laeuftAn}>
          {laeuftAn ? 'Wird freigeschaltet …' : 'Wieder freischalten'}
        </button>
        {person.rolleVorher
          ? <span className="mv-hinweis-klein">als {rollenName(rollen, person.rolleVorher)}</span>
          : null}
        <Meldung ergebnis={aktiviert} />
      </form>
    );
  }

  return (
    <div className="mv-zugangsform">
      <button
        type="button"
        className="admin-knopf-klein gefahr"
        onClick={() => setFrage(true)}
      >
        Löschen / deaktivieren
      </button>
      <Meldung ergebnis={deaktiviert} />

      {frage ? (
        <div className="mv-dialog-huelle" role="dialog" aria-modal="true"
             aria-label={`${person.name} deaktivieren`}>
          <div className="mv-dialog">
            <h2>Mitarbeiter wirklich löschen?</h2>
            <p>
              Möchtest du <strong>{person.name}</strong> wirklich löschen? Seine
              erstellten Projekte und Aufmaße bleiben erhalten.
            </p>
            <p className="mv-dialog-detail">
              Der Zugang wird deaktiviert: Anmelden ist danach nicht mehr
              möglich. Projekte, Aufmaße und 2D-Zeichnungen bleiben dem Betrieb
              erhalten – mitsamt dem Vermerk, wer sie angelegt hat. Ein
              deaktivierter Zugang lässt sich jederzeit wieder freischalten.
            </p>
            <div className="mv-dialog-knoepfe">
              <button type="button" className="auth-knopf auth-knopf--leise"
                      onClick={() => setFrage(false)}>
                Abbrechen
              </button>
              <form action={deaktivieren}>
                <input type="hidden" name="userId" value={person.id} />
                <button type="submit" className="auth-knopf mv-knopf-gefahr" disabled={laeuftAus}>
                  {laeuftAus ? 'Wird deaktiviert …' : 'Ja, Zugang deaktivieren'}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Meldung({ ergebnis }: { ergebnis: AktionsErgebnis | null }) {
  if (!ergebnis) return null;
  if (ergebnis.fehler) {
    return <span className="mv-meldung mv-meldung--fehler" role="alert">{ergebnis.fehler}</span>;
  }
  return <span className="mv-meldung mv-meldung--ok" role="status">{ergebnis.ok}</span>;
}

function rollenName(rollen: Rolle[], id: string | null): string {
  if (!id) return 'Ohne Rolle';
  return rollen.find(r => r.id === id)?.name ?? id;
}
