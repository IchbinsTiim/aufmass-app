import { NextResponse } from 'next/server';
import { CloudFehler, arbeitsbereichAuflisten } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { ALLE_RECHTE, rolleBeschriftung } from '@/lib/rollen';
import { rollenHolen } from '@/lib/zugang';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const zugriff = await cloudZugriff();
    const [arbeitsbereich, rollen] = await Promise.all([
      arbeitsbereichAuflisten(zugriff.userId, zugriff.istAdmin),
      rollenHolen()
    ]);
    /* Das Konto kommt mit derselben Antwort.
       Die Aufmaß-App liegt unter /app und kennt weder Clerk noch die
       Rollentabelle; sie braucht aber zwei Auskünfte: wie der angemeldete
       Benutzer heißt und was er darf – sonst könnte sie den Zugang zur
       Mitarbeiterverwaltung nicht anbieten (oder böte ihn jedem an). Ein
       eigener Endpunkt dafür wäre eine zweite Anfrage bei jedem Start; hier
       kostet die Auskunft nichts, weil die Anfrage ohnehin läuft.
       Sie ist reine ANZEIGE-Information: Jede Seite und jede Route prüft ihr
       Recht selbst noch einmal. */
    return NextResponse.json({
      ...arbeitsbereich,
      konto: {
        userId: zugriff.userId,
        rolle: zugriff.rolle,
        rolleName: rolleBeschriftung(zugriff.rolle, rollen),
        rechte: [...zugriff.rechte].filter(r => r !== ALLE_RECHTE)
      }
    }, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}

export function antwortFehler(fehler: unknown) {
  if (fehler instanceof CloudFehler) {
    return NextResponse.json({ error: fehler.message, aktuell: fehler.aktuell ?? null }, { status: fehler.status });
  }
  console.error('[cloud]', fehler);
  return NextResponse.json({ error: 'Cloud-Speicher ist gerade nicht erreichbar.' }, { status: 500 });
}
