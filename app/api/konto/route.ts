import { NextResponse } from 'next/server';
import { kontoAuskunft } from '@/lib/projekte/konto';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { rollenHolen } from '@/lib/zugang';
import { antwortFehler } from '../cloud/arbeitsbereich/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Wer ist angemeldet, was darf er? Für die Startseite unter /app: Sie lädt
 * keine Daten der beiden Anwendungen, muss aber wissen, ob sie den Zugang
 * zur Mitarbeiterverwaltung anbieten soll. Reine Anzeige-Information – die
 * Mitarbeiterseiten prüfen das Recht selbst noch einmal.
 */
export async function GET() {
  try {
    const [zugriff, rollen] = await Promise.all([cloudZugriff(), rollenHolen()]);
    return NextResponse.json({ konto: kontoAuskunft(zugriff, rollen) }, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (fehler) {
    return antwortFehler(fehler);
  }
}
