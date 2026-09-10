import { NextResponse } from 'next/server';
import { projektLoeschen, projektSpeichern } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { antwortFehler } from '../../arbeitsbereich/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Kontext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Kontext) {
  try {
    const [{ id }, zugriff, body] = await Promise.all([params, cloudZugriff(), request.json()]);
    const projekt = await projektSpeichern(zugriff.userId, zugriff.istAdmin, {
      id, inhalt: body?.inhalt, revision: body?.revision
    });
    return NextResponse.json({ projekt });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}

export async function DELETE(request: Request, { params }: Kontext) {
  try {
    const [{ id }, zugriff] = await Promise.all([params, cloudZugriff()]);
    const revision = new URL(request.url).searchParams.get('revision');
    await projektLoeschen(zugriff.userId, zugriff.istAdmin, id, revision);
    return new NextResponse(null, { status: 204 });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}
