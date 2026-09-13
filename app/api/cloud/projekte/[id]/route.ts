import { NextResponse } from 'next/server';
import { projektLoeschen, projektSpeichern } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { antwortFehler } from '../../arbeitsbereich/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Kontext = { params: Promise<{ id: string }> };

/* Welches Recht der Vorgang braucht, entscheidet sich erst in
   projektSpeichern: Anlegen verlangt „projekte.erstellen", Ändern
   „projekte.bearbeiten", und ob es das Projekt schon gibt, weiß erst die
   Datenbank. Die Route reicht deshalb die Rechte durch, statt hier zu raten. */
export async function PUT(request: Request, { params }: Kontext) {
  try {
    const [{ id }, zugriff, body] = await Promise.all([params, cloudZugriff(), request.json()]);
    const projekt = await projektSpeichern(zugriff.userId, zugriff.istAdmin, {
      id, inhalt: body?.inhalt, revision: body?.revision
    }, zugriff.rechte);
    return NextResponse.json({ projekt });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}

export async function DELETE(request: Request, { params }: Kontext) {
  try {
    const [{ id }, zugriff] = await Promise.all([params, cloudZugriff()]);
    const revision = new URL(request.url).searchParams.get('revision');
    await projektLoeschen(zugriff.userId, zugriff.istAdmin, id, revision, zugriff.rechte);
    return new NextResponse(null, { status: 204 });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}
