import { NextResponse } from 'next/server';
import { cloudApp, projektLoeschen, projektSpeichern } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { antwortFehler } from '../../arbeitsbereich/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Kontext = { params: Promise<{ id: string }> };

/* Welches Recht der Vorgang braucht, entscheidet sich erst in
   projektSpeichern: Anlegen verlangt „projekte.erstellen", Ändern
   „projekte.bearbeiten", und ob es das Projekt schon gibt, weiß erst die
   Datenbank. Die Route reicht deshalb die Rechte durch, statt hier zu raten.

   `?app=aufmass` (Vorgabe) bzw. `?app=2d` sagt, zu welcher Anwendung der
   Datensatz gehört – ein Datensatz wechselt nie die Anwendung. */
export async function PUT(request: Request, { params }: Kontext) {
  try {
    const app = cloudApp(new URL(request.url).searchParams.get('app'));
    const [{ id }, zugriff, body] = await Promise.all([params, cloudZugriff(), request.json()]);
    const projekt = await projektSpeichern(zugriff.userId, zugriff.istAdmin, {
      id, inhalt: body?.inhalt, revision: body?.revision
    }, zugriff.rechte, app);
    return NextResponse.json({ projekt });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}

export async function DELETE(request: Request, { params }: Kontext) {
  try {
    const suche = new URL(request.url).searchParams;
    const app = cloudApp(suche.get('app'));
    const [{ id }, zugriff] = await Promise.all([params, cloudZugriff()]);
    await projektLoeschen(zugriff.userId, zugriff.istAdmin, id, suche.get('revision'), zugriff.rechte, app);
    return new NextResponse(null, { status: 204 });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}
