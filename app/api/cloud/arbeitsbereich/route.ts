import { NextResponse } from 'next/server';
import { CloudFehler, arbeitsbereichAuflisten } from '@/lib/projekte/cloud';
import { cloudZugriff } from '@/lib/projekte/zugriff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const { userId, istAdmin } = await cloudZugriff();
    return NextResponse.json(await arbeitsbereichAuflisten(userId, istAdmin), {
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
