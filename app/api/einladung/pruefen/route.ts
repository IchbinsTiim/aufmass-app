import { NextResponse } from 'next/server';
import { abfrageHolen, pepperHolen } from '@/lib/einladungen/db';
import { codePruefen, istGesperrt, kennungAusHerkunft, versuchNotieren } from '@/lib/einladungen/kern';
import { herkunftLesen } from '@/lib/herkunft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vorprüfung eines Einladungscodes für die Oberfläche.
 *
 * Wichtig: ein „ok" hier ist KEINE Berechtigung. Es sagt nur, dass sich das
 * Formular zum Anlegen des Kontos zu zeigen lohnt. Der Anspruch entsteht
 * ausschließlich in /api/einladung/registrieren, das den Code erneut und
 * diesmal verbindlich prüft. Wer diese Route überspringt, gewinnt nichts.
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

  let code = '';
  try {
    const daten = await req.json();
    code = typeof daten?.code === 'string' ? daten.code : '';
  } catch {
    return NextResponse.json({ ok: false, meldung: ABLEHNUNG }, { status: 400 });
  }

  const kennung = kennungAusHerkunft(herkunftLesen(req), pepper);
  if (await istGesperrt(abfrage, kennung)) {
    return NextResponse.json({ ok: false, meldung: GESPERRT }, { status: 429 });
  }

  const ergebnis = await codePruefen(abfrage, code, pepper);
  await versuchNotieren(abfrage, kennung, ergebnis.ok);

  // Immer dieselbe Meldung: ob ein Code unbekannt, abgelaufen, widerrufen
  // oder schon verwendet ist, geht den Aufrufer nichts an.
  if (!ergebnis.ok) {
    return NextResponse.json({ ok: false, meldung: ABLEHNUNG }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

const ABLEHNUNG = 'Dieser Einladungscode ist nicht gültig.';
const GESPERRT = 'Zu viele Versuche. Bitte in einigen Minuten erneut probieren.';
