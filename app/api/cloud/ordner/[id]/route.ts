import { NextResponse } from 'next/server';
import { ordnerLoeschen, ordnerSpeichern } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { antwortFehler } from '../../arbeitsbereich/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Kontext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Kontext) {
  try {
    const [{ id }, zugriff, body] = await Promise.all([params, cloudZugriff(), request.json()]);
    return NextResponse.json({ ordner: await ordnerSpeichern(zugriff.userId, {
      id, inhalt: body?.inhalt, revision: body?.revision
    }) });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}

export async function DELETE(request: Request, { params }: Kontext) {
  try {
    const [{ id }, zugriff] = await Promise.all([params, cloudZugriff()]);
    await ordnerLoeschen(zugriff.userId, id, new URL(request.url).searchParams.get('revision'));
    return new NextResponse(null, { status: 204 });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}
