import { NextResponse } from 'next/server';
import { abfrageHolen } from '@/lib/einladungen/db';
import { aktivitaetNotieren } from '@/lib/mitarbeiter/aktivitaet';
import { cloudZugriff } from '@/lib/projekte/zugriff';
import { ZeichnungsFehler, zeichnungenLesen, zeichnungAnlegen } from '@/lib/projekte/zeichnungen';
import { antwortFehler } from '../../../arbeitsbereich/route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Kontext = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };
async function ausfuehren(request: Request, ctx: Kontext, schreiben: boolean) {
  try {
    // Lesen darf jeder Freigeschaltete; speichern nur, wer zeichnen darf.
    const zugang = await cloudZugriff(schreiben ? 'zeichnungen.erstellen' : undefined);
    const { id } = await ctx.params;
    const db = abfrageHolen();
    if (!db) throw new ZeichnungsFehler(503, 'Cloud-Speicher noch nicht eingerichtet.');
    if (!schreiben) return NextResponse.json({ zeichnungen: await zeichnungenLesen(db, id, zugang.userId, zugang.istAdmin, new URL(request.url).searchParams.get('zeichnung') || undefined) }, { headers });
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new ZeichnungsFehler(403, 'Ungültige Herkunft.');
    const reader = request.body?.getReader();
    if (!reader) throw new ZeichnungsFehler(400, 'Zeichnung fehlt.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_600_000) { await reader.cancel(); throw new ZeichnungsFehler(413, 'Datei zu groß (maximal 1,5 MB).'); }
      chunks.push(value);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ZeichnungsFehler(400, 'Ungültige JSON-Datei.'); }
    const zeichnung = await zeichnungAnlegen(db,id,zugang.userId,zugang.istAdmin,body);
    await aktivitaetNotieren(db, { userId: zugang.userId, art: 'zeichnung.gespeichert',
      objektId: String(zeichnung.id), objektTitel: String(zeichnung.name || '') });
    return NextResponse.json({ zeichnung }, { status:201, headers });
  } catch (error) {
    if (error instanceof ZeichnungsFehler) return NextResponse.json({error:error.message}, {status:error.status, headers});
    return antwortFehler(error);
  }
}
export const GET = (request: Request, ctx: Kontext) => ausfuehren(request,ctx,false);
export const POST = (request: Request, ctx: Kontext) => ausfuehren(request,ctx,true);
