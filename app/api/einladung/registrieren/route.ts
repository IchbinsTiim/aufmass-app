import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { abfrageHolen, pepperHolen } from '@/lib/einladungen/db';
import { kennungAusHerkunft } from '@/lib/einladungen/kern';
import { registrieren, type Anlagefehler } from '@/lib/einladungen/registrierung';
import { herkunftLesen } from '@/lib/herkunft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Konto anlegen – nur mit gültigem Einladungscode.
 *
 * Diese Route ist bewusst dünn: JSON lesen, entscheiden lassen, antworten.
 * Die Entscheidung selbst steht in lib/einladungen/registrierung.ts und wird
 * dort gegen ein echtes Postgres geprüft (tests/r13-einladungscodes.mjs).
 *
 * Die Prüfung hängt an KEINER Oberfläche: ein direkter Aufruf ohne gültigen
 * Code scheitert beim Reservieren. Der CLERK_SECRET_KEY wird ausschließlich
 * hier verwendet – auf dem Server, nie im Browser.
 */
export async function POST(req: Request) {
  const abfrage = abfrageHolen();
  const pepper = pepperHolen();
  if (!abfrage || !pepper) {
    return NextResponse.json(
      { ok: false, meldung: 'Einladungen sind auf diesem Server noch nicht eingerichtet.' },
      { status: 503 }
    );
  }

  let roh: Record<string, unknown>;
  try {
    roh = await req.json();
  } catch {
    return NextResponse.json({ ok: false, meldung: 'Ungültige Anfrage.' }, { status: 400 });
  }

  const ergebnis = await registrieren({
    abfrage,
    pepper,
    kennung: kennungAusHerkunft(herkunftLesen(req), pepper),
    daten: {
      code: text(roh.code),
      benutzername: text(roh.benutzername),
      passwort: text(roh.passwort),
      email: text(roh.email),
      vorname: text(roh.vorname),
      nachname: text(roh.nachname)
    },
    kontoAnlegen: clerkKontoAnlegen
  });

  if (!ergebnis.ok) {
    return NextResponse.json({ ok: false, meldung: ergebnis.meldung }, { status: ergebnis.status });
  }
  return NextResponse.json({ ok: true, benutzername: ergebnis.benutzername });
}

/** Clerk legt das Konto an; der Secret Key bleibt in dieser Funktion. */
async function clerkKontoAnlegen(auftrag: {
  benutzername: string; passwort: string; email?: string;
  vorname?: string; nachname?: string;
  rolle: 'admin' | 'mitarbeiter'; einladungId: string;
}) {
  try {
    const clerk = await clerkClient();
    const benutzer = await clerk.users.createUser({
      username: auftrag.benutzername,
      password: auftrag.passwort,
      ...(auftrag.email ? { emailAddress: [auftrag.email] } : {}),
      ...(auftrag.vorname ? { firstName: auftrag.vorname } : {}),
      ...(auftrag.nachname ? { lastName: auftrag.nachname } : {}),
      // Die Rolle ist zugleich der Nachweis der Freischaltung – ohne sie
      // lässt lib/zugang.ts niemanden in die Anwendung.
      publicMetadata: { rolle: auftrag.rolle, einladungId: auftrag.einladungId }
    });
    return { userId: benutzer.id };
  } catch (fehler: unknown) {
    const status = (fehler as { status?: unknown })?.status;
    const errors = (fehler as { errors?: { longMessage?: string; message?: string }[] })?.errors;
    const erste = Array.isArray(errors) ? errors[0] : undefined;
    const anlagefehler: Anlagefehler = {
      // 4xx heißt: Clerk hat die Angaben abgelehnt, ein Konto ist NICHT
      // entstanden. Nur dann darf der Code wieder frei werden.
      eingabefehler: typeof status === 'number' && status >= 400 && status < 500,
      meldung: erste?.longMessage || erste?.message ||
        'Die Angaben wurden nicht angenommen. Bitte prüfen Sie Benutzername und Passwort.'
    };
    throw anlagefehler;
  }
}

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert.trim() : '';
}
