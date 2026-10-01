import { NextResponse } from 'next/server';
import { CloudFehler, arbeitsbereichAuflisten, cloudApp } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { kontoAuskunft } from '@/lib/projekte/konto';
import { rollenHolen } from '@/lib/zugang';
import { mitarbeiterListe } from '@/lib/mitarbeiter/verzeichnis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Arbeitsbereich EINER Anwendung: `?app=aufmass` (Vorgabe) liefert die
 * Aufmaß-Projekte und -Ordner, `?app=2d` die Zeichnungen und Ordner der
 * 2D-Aufmaß-App. Die beiden Anwendungen sehen nie die Daten der anderen.
 */
export async function GET(request: Request) {
  try {
    const app = cloudApp(new URL(request.url).searchParams.get('app'));
    const zugriff = await cloudZugriff();
    const [arbeitsbereich, rollen] = await Promise.all([
      arbeitsbereichAuflisten(zugriff.userId, zugriff.istAdmin, app),
      rollenHolen()
    ]);
    /* Das Konto kommt mit derselben Antwort.
       Die Anwendungen unter /app kennen weder Clerk noch die Rollentabelle;
       sie brauchen aber zwei Auskünfte: wie der angemeldete Benutzer heißt
       und was er darf. Ein eigener Endpunkt dafür wäre eine zweite Anfrage
       bei jedem Start; hier kostet die Auskunft nichts, weil die Anfrage
       ohnehin läuft. (Die Startseite, die keine Daten lädt, fragt dafür
       /api/konto.) Sie ist reine ANZEIGE-Information: Jede Seite und jede
       Route prüft ihr Recht selbst noch einmal. */
    const projects = await erstellerErgaenzen(arbeitsbereich.projects, zugriff.userId, zugriff.istAdmin);
    return NextResponse.json({
      ...arbeitsbereich,
      projects,
      konto: kontoAuskunft(zugriff, rollen)
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
  if (fehler && typeof fehler === 'object' && 'constraint' in fehler &&
      fehler.constraint === 'cloud_projekt_geloescht') {
    return NextResponse.json({ error: 'Dieses Projekt wurde bereits gelöscht.' }, { status: 410 });
  }
  if (fehler instanceof CloudFehler) {
    return NextResponse.json({ error: fehler.message, aktuell: fehler.aktuell ?? null }, { status: fehler.status });
  }
  console.error('[cloud]', fehler);
  return NextResponse.json({ error: 'Cloud-Speicher ist gerade nicht erreichbar.' }, { status: 500 });
}
