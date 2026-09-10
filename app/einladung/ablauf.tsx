'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Zwei Schritte: Code prüfen, dann Konto anlegen.
 *
 * Der zweite Schritt schickt den Code MIT – die Freigabe aus Schritt 1 ist
 * nur eine Anzeige. Wer sie im Browser überspringt oder fälscht, kommt in
 * Schritt 2 trotzdem nicht durch: dort wird der Code verbindlich eingelöst.
 */
export function EinladungsAblauf() {
  const router = useRouter();
  const [schritt, setSchritt] = useState<'code' | 'konto'>('code');
  const [code, setCode] = useState('');
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function codePruefen(e: React.FormEvent) {
    e.preventDefault();
    setMeldung(null);
    setLaeuft(true);
    try {
      const antwort = await fetch('/api/einladung/pruefen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const daten = await antwort.json().catch(() => ({}));
      if (antwort.ok && daten.ok) setSchritt('konto');
      else setMeldung(daten.meldung || 'Dieser Einladungscode ist nicht gültig.');
    } catch {
      setMeldung('Keine Verbindung. Bitte noch einmal versuchen.');
    } finally {
      setLaeuft(false);
    }
  }

  async function kontoAnlegen(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMeldung(null);

    const formular = new FormData(e.currentTarget);
    const passwort = String(formular.get('passwort') || '');
    if (passwort !== String(formular.get('passwort2') || '')) {
      setMeldung('Die beiden Passwörter stimmen nicht überein.');
      return;
    }

    setLaeuft(true);
    try {
      const antwort = await fetch('/api/einladung/registrieren', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          benutzername: formular.get('benutzername'),
          passwort,
          email: formular.get('email'),
          vorname: formular.get('vorname'),
          nachname: formular.get('nachname')
        })
      });
      const daten = await antwort.json().catch(() => ({}));
      if (antwort.ok && daten.ok) {
        router.push('/sign-in?neu=1');
        return;
      }
      setMeldung(daten.meldung || 'Das hat nicht geklappt.');
      // Ein abgelehnter Code bringt zurück an den Anfang – das Konto-Formular
      // ohne gültigen Code stehen zu lassen, wäre nur irreführend.
      if (antwort.status === 400 && daten.meldung?.includes('Einladungscode')) {
        setSchritt('code');
      }
    } catch {
      setMeldung('Keine Verbindung. Bitte noch einmal versuchen.');
    } finally {
      setLaeuft(false);
    }
  }

  if (schritt === 'code') {
    return (
      <form className="auth-formular" onSubmit={codePruefen}>
        <label className="auth-feld">
          <span>Einladungscode</span>
          <input
            name="code"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="X7K4-P9QM-2L8F"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className="auth-eingabe auth-eingabe--code"
          />
        </label>

        {meldung ? <p className="auth-meldung" role="alert">{meldung}</p> : null}

        <button type="submit" className="auth-knopf" disabled={laeuft}>
          {laeuft ? 'Wird geprüft …' : 'Code prüfen'}
        </button>

        <p className="auth-fuss">
          Kein Code? Ein AufmaßX-Administrator gibt ihn Ihnen.{' '}
          <Link href="/sign-in">Zur Anmeldung</Link>
        </p>
      </form>
    );
  }

  return (
    <form className="auth-formular" onSubmit={kontoAnlegen}>
      <p className="auth-bestaetigt">Einladung bestätigt ✓</p>

      <label className="auth-feld">
        <span>Benutzername</span>
        <input name="benutzername" required minLength={3} maxLength={64}
               autoComplete="username" className="auth-eingabe" />
      </label>

      <label className="auth-feld">
        <span>Passwort</span>
        <input name="passwort" type="password" required minLength={8}
               autoComplete="new-password" className="auth-eingabe" />
      </label>

      <label className="auth-feld">
        <span>Passwort wiederholen</span>
        <input name="passwort2" type="password" required minLength={8}
               autoComplete="new-password" className="auth-eingabe" />
      </label>

      <label className="auth-feld">
        <span>E-Mail <em>(optional)</em></span>
        <input name="email" type="email" autoComplete="email" className="auth-eingabe" />
      </label>

      <div className="auth-feld-paar">
        <label className="auth-feld">
          <span>Vorname <em>(optional)</em></span>
          <input name="vorname" autoComplete="given-name" className="auth-eingabe" />
        </label>
        <label className="auth-feld">
          <span>Nachname <em>(optional)</em></span>
          <input name="nachname" autoComplete="family-name" className="auth-eingabe" />
        </label>
      </div>

      {meldung ? <p className="auth-meldung" role="alert">{meldung}</p> : null}

      <button type="submit" className="auth-knopf" disabled={laeuft}>
        {laeuft ? 'Konto wird angelegt …' : 'Account erstellen'}
      </button>
    </form>
  );
}
