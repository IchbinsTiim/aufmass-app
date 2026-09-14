import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { freigabeSetzen } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { antwortFehler } from '../../../arbeitsbereich/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, zugriff, body] = await Promise.all([
      params, cloudZugriff('projekte.bearbeiten'), request.json()
    ]);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 320) return NextResponse.json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }, { status: 400 });
    const client = await clerkClient();
    const ergebnis = await client.users.getUserList({ emailAddress: [email], limit: 1 });
    const user = ergebnis.data[0];
    if (!user) return NextResponse.json({ error: 'Für diese E-Mail gibt es noch kein AufmaßX-Konto.' }, { status: 404 });
    await freigabeSetzen(zugriff.userId, zugriff.istAdmin, id, user.id, body?.rolle);
    return NextResponse.json({ ok: true });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}
