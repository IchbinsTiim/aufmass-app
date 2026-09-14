import { NextResponse } from 'next/server';
import { CloudFehler, arbeitsbereichAuflisten } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { ALLE_RECHTE, RECHT_KEYS, rolleBeschriftung } from '@/lib/rollen';
import { rollenHolen } from '@/lib/zugang';
import { mitarbeiterListe } from '@/lib/mitarbeiter/verzeichnis';

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
    const projects = await erstellerErgaenzen(arbeitsbereich.projects, zugriff.userId, zugriff.istAdmin);
    return NextResponse.json({
      ...arbeitsbereich,
      projects,
      konto: {
        userId: zugriff.userId,
        rolle: zugriff.rolle,
        rolleName: rolleBeschriftung(zugriff.rolle, rollen),
        // Administratoren tragen intern nur den Platzhalter "*". Für die
        // Oberfläche werden daraus die konkreten Rechte, damit sie dieselben
        // vorgesehenen Funktionen wie eine eigene, gleichberechtigte Rolle
        // sieht. Die Route selbst prüft weiterhin serverseitig.
        rechte: zugriff.rechte.has(ALLE_RECHTE) ? RECHT_KEYS : [...zugriff.rechte]
      }
    }, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}

async function erstellerErgaenzen<T extends { ownerUserId: string }>(
  projects: T[], userId: string, darfFremdeDatenSehen: boolean
) {
  if (!darfFremdeDatenSehen) {
    return projects.map(projekt => ({ ...projekt, eigenes: projekt.ownerUserId === userId }));
  }

  const namen = new Map<string, string>();
  try {
    (await mitarbeiterListe(500)).forEach(person => namen.set(person.id, person.name));
  } catch (_) {
    // Die Zeichnungsübersicht bleibt auch dann nutzbar, wenn Clerk gerade
    // keine Namen liefert. Der Datenzugang selbst wird davon nicht berührt.
  }
  return projects.map(projekt => ({
    ...projekt,
    eigenes: projekt.ownerUserId === userId,
    erstelltVon: projekt.ownerUserId === userId ? 'Du' : (namen.get(projekt.ownerUserId) || 'Mitarbeiter')
  }));
}

export function antwortFehler(fehler: unknown) {
  if (fehler instanceof CloudFehler) {
    return NextResponse.json({ error: fehler.message, aktuell: fehler.aktuell ?? null }, { status: fehler.status });
  }
  console.error('[cloud]', fehler);
  return NextResponse.json({ error: 'Cloud-Speicher ist gerade nicht erreichbar.' }, { status: 500 });
}
