'use client';

import { useActionState, useState } from 'react';
import {
  ALLE_RECHTE, BEREICHE, RECHTE, type Rolle
} from '@/lib/rollen';
import {
  rolleEntfernen, rolleSichern, vorlageAnlegen, type RollenErgebnis
} from './aktionen';

/**
 * Rollenverwaltung – Oberfläche.
 *
 * Eine Rolle ist ein Name und eine Menge Haken. Die Haken kommen aus
 * lib/rollen.ts: Wer dort ein Recht ergänzt, sieht es hier automatisch, ohne
 * dass diese Datei angefasst werden muss. Genau deshalb wird die Liste
 * gerendert und nicht abgetippt.
 *
 * Die Rolle „Administrator" wird bewusst nur angezeigt und nicht bearbeitet:
 * Sie darf immer alles – auch alles, was später dazukommt. Wäre sie
 * beschneidbar, könnte sich ein Betrieb mit einem Klick aus seiner eigenen
 * Verwaltung aussperren.
 */

export function RollenListe({ rollen, belegung }: { rollen: Rolle[]; belegung: Record<string, number> }) {
  const [offen, setOffen] = useState<string | null>(null);
  const [neu, setNeu] = useState(false);

  return (
    <>
      <div className="rl-kopfzeile">
        <button type="button" className="auth-knopf" onClick={() => { setNeu(true); setOffen(null); }}>
          + Neue Rolle
        </button>
      </div>

      {neu ? (
        <RollenFormular
          rolle={null}
          onFertig={() => setNeu(false)}
        />
      ) : null}

      <div className="rl-liste">
        {rollen.map(rolle => (
          <div key={rolle.id} className="admin-karte rl-karte">
            <div className="rl-karte-kopf">
              <div>
                <h2>
                  {rolle.name}
                  {rolle.system ? <span className="rl-marke">mitgeliefert</span> : null}
                </h2>
                <p className="admin-hinweis">{rolle.beschreibung || 'Ohne Beschreibung'}</p>
                <p className="admin-hinweis rl-belegung">
                  {(belegung[rolle.id] || 0)} Mitarbeiter · Kennung <code>{rolle.id}</code>
                </p>
              </div>
              {rolle.rechte.includes(ALLE_RECHTE) ? null : (
                <button
                  type="button"
                  className="admin-knopf-klein"
                  onClick={() => { setOffen(offen === rolle.id ? null : rolle.id); setNeu(false); }}
                >
                  {offen === rolle.id ? 'Schließen' : 'Rechte bearbeiten'}
                </button>
              )}
            </div>

            <ul className="rl-rechte-anzeige">
              {rolle.rechte.includes(ALLE_RECHTE)
                ? <li className="rl-recht-pille rl-recht-pille--alle">Alle Rechte</li>
                : rolle.rechte.length
                  ? rolle.rechte.map(k => (
                      <li key={k} className="rl-recht-pille">
                        {RECHTE.find(r => r.key === k)?.label ?? k}
                      </li>
                    ))
                  : <li className="rl-recht-pille rl-recht-pille--leer">Keine Rechte</li>}
            </ul>

            {offen === rolle.id ? (
              <RollenFormular rolle={rolle} onFertig={() => setOffen(null)} />
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

function RollenFormular({ rolle, onFertig }: { rolle: Rolle | null; onFertig: () => void }) {
  const [ergebnis, aktion, laeuft] = useActionState<RollenErgebnis | null, FormData>(
    rolleSichern, null
  );
  const [loeschErgebnis, loeschen, loeschLaeuft] = useActionState<RollenErgebnis | null, FormData>(
    rolleEntfernen, null
  );
  const [frage, setFrage] = useState(false);
  const gesetzt = new Set(rolle?.rechte ?? []);

  return (
    <form action={aktion} className="rl-form">
      {rolle ? <input type="hidden" name="id" value={rolle.id} /> : null}

      <div className="rl-form-zeile">
        <label className="auth-feld">
          <span>Name der Rolle</span>
          <input name="name" className="auth-eingabe" maxLength={60} required
                 defaultValue={rolle?.name ?? ''} placeholder="z. B. Bauleiter" />
        </label>
        <label className="auth-feld rl-feld-breit">
          <span>Beschreibung <em>(optional)</em></span>
          <input name="beschreibung" className="auth-eingabe" maxLength={240}
                 defaultValue={rolle?.beschreibung ?? ''}
                 placeholder="Wofür ist diese Rolle gedacht?" />
        </label>
        <label className="auth-feld rl-feld-schmal">
          <span>Reihenfolge</span>
          <input name="sortierung" type="number" min={1} max={999} className="auth-eingabe"
                 defaultValue={rolle?.sortierung ?? 100} />
        </label>
      </div>

      {BEREICHE.map(bereich => {
        const rechte = RECHTE.filter(r => r.bereich === bereich.key);
        if (!rechte.length) return null;
        return (
          <fieldset key={bereich.key} className="rl-bereich">
            <legend>{bereich.label}</legend>
            <div className="rl-rechte">
              {rechte.map(recht => (
                <label key={recht.key} className="rl-recht">
                  <input type="checkbox" name="rechte" value={recht.key}
                         defaultChecked={gesetzt.has(recht.key)} />
                  <span>
                    <strong>{recht.label}</strong>
                    <em>{recht.hinweis}</em>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      <div className="rl-form-aktionen">
        <button type="submit" className="auth-knopf" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Rolle speichern'}
        </button>
        <button type="button" className="auth-knopf auth-knopf--leise" onClick={onFertig}>
          Fertig
        </button>
        {rolle && !rolle.system ? (
          <button type="button" className="admin-knopf-klein gefahr" onClick={() => setFrage(true)}>
            Rolle löschen
          </button>
        ) : null}
      </div>

      {frage && rolle ? (
        <div className="rl-loeschfrage">
          <p>
            Rolle <strong>{rolle.name}</strong> wirklich löschen? Mitarbeiter mit
            dieser Rolle müssen vorher eine andere bekommen.
          </p>
          <div className="rl-form-aktionen">
            <button type="button" className="auth-knopf auth-knopf--leise"
                    onClick={() => setFrage(false)}>Abbrechen</button>
            <button type="submit" formAction={loeschen} className="auth-knopf mv-knopf-gefahr"
                    name="id" value={rolle.id} disabled={loeschLaeuft}>
              {loeschLaeuft ? 'Wird gelöscht …' : 'Ja, löschen'}
            </button>
          </div>
        </div>
      ) : null}

      <Meldung ergebnis={ergebnis} />
      <Meldung ergebnis={loeschErgebnis} />
    </form>
  );
}

export function VorlagenLeiste({ vorlagen }: { vorlagen: Rolle[] }) {
  const [ergebnis, aktion, laeuft] = useActionState<RollenErgebnis | null, FormData>(
    vorlageAnlegen, null
  );
  if (!vorlagen.length) return null;
  return (
    <div className="admin-karte">
      <p className="admin-hinweis">
        Fertige Vorlagen – ein Klick legt sie an; ändern lässt sie sich danach
        wie jede andere Rolle.
      </p>
      <form action={aktion} className="rl-vorlagen">
        {vorlagen.map(v => (
          <button key={v.id} type="submit" name="id" value={v.id}
                  className="admin-knopf-klein" disabled={laeuft}>
            + {v.name}
          </button>
        ))}
      </form>
      <Meldung ergebnis={ergebnis} />
    </div>
  );
}

function Meldung({ ergebnis }: { ergebnis: RollenErgebnis | null }) {
  if (!ergebnis) return null;
  if (ergebnis.fehler) return <p className="auth-meldung" role="alert">{ergebnis.fehler}</p>;
  return <p className="auth-bestaetigt" role="status">{ergebnis.ok}</p>;
}
