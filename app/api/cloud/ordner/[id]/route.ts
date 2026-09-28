import { NextResponse } from 'next/server';
import { cloudApp, ordnerLoeschen, ordnerSpeichern } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { antwortFehler } from '../../arbeitsbereich/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Kontext = { params: Promise<{ id: string }> };

/* Ordner gehören wie Projekte genau einer Anwendung (`?app=aufmass` als
   Vorgabe bzw. `?app=2d`). */
export async function PUT(request: Request, { params }: Kontext) {
  try {
    const app = cloudApp(new URL(request.url).searchParams.get('app'));
    const [{ id }, zugriff, body] = await Promise.all([params, cloudZugriff(), request.json()]);
    return NextResponse.json({ ordner: await ordnerSpeichern(zugriff.userId, {
      id, inhalt: body?.inhalt, revision: body?.revision
    }, app) });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}

export async function DELETE(request: Request, { params }: Kontext) {
  try {
    const suche = new URL(request.url).searchParams;
    const app = cloudApp(suche.get('app'));
    const [{ id }, zugriff] = await Promise.all([params, cloudZugriff()]);
    await ordnerLoeschen(zugriff.userId, id, suche.get('revision'), app);
    return new NextResponse(null, { status: 204 });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}
