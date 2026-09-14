'use client';

import { useActionState } from 'react';
import { STANDARD_ROLLE, type Rolle } from '@/lib/rollen';
import { codeAnlegen, type AnlegeErgebnis } from './aktionen';

/**
 * „Einladungscode erstellen". Der erzeugte Code steht danach im grünen
 * Kasten – zum Abschreiben oder Kopieren. Ein Neuladen der Seite lässt ihn
 * verschwinden; das ist beabsichtigt.
 */
export function AnlegeFormular({ rollen }: { rollen: Rolle[] }) {
  const [ergebnis, aktion, laeuft] = useActionState<AnlegeErgebnis | null, FormData>(
    codeAnlegen,
    null
  );

  return (
    <>
      <form action={aktion} className="admin-karte admin-form-zeile">
        <label className="auth-feld">
          <span>Gültig für (Tage)</span>
          <input name="tage" type="number" min={1} max={90} defaultValue={7}
                 className="auth-eingabe" />
        </label>
        <label className="auth-feld">
          <span>Rolle</span>
          <select name="rolle" defaultValue={STANDARD_ROLLE} className="auth-eingabe">
            {rollen.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="auth-feld">
          <span>Notiz <em>(optional)</em></span>
          <input name="notiz" maxLength={200} placeholder="z. B. Kolonne Nord"
                 className="auth-eingabe" />
        </label>
        <button type="submit" className="auth-knopf" disabled={laeuft}>
          {laeuft ? 'Wird erstellt …' : 'Einladungscode erstellen'}
        </button>
      </form>

      {ergebnis?.fehler ? (
        <p className="auth-meldung" role="alert">{ergebnis.fehler}</p>
      ) : null}

      {ergebnis?.code ? (
        <div className="admin-neuer-code">
          <span className="admin-code">{ergebnis.code}</span>
          <button
            type="button"
            className="admin-knopf-klein"
            onClick={() => navigator.clipboard?.writeText(ergebnis.code!)}
          >
            Kopieren
          </button>
          <span className="admin-hinweis">
            Jetzt weitergeben – danach ist der Code nicht mehr einsehbar.
          </span>
        </div>
      ) : null}
    </>
  );
}
