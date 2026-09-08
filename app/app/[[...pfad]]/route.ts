import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { zugangPruefen } from '@/lib/zugang';

/**
 * Die Aufmaß-App – geschützt ausgeliefert.
 *
 * Die App selbst ist unverändert: dasselbe Dokument, dieselben Skripte,
 * dieselbe Ladereihenfolge, dasselbe Hash-Routing (#/, #/aufmass, #/2d).
 * Neu ist nur, WER sie bekommt. Sie liegt deshalb in `legacy-app/` und nicht
 * in `public/`: was unter `public/` liegt, liefert Vercel als statische
 * Datei aus, bevor irgendein Servercode läuft – die Anmeldung wäre eine
 * Empfehlung, keine Sperre. Hier kommt jede einzelne Datei durch diese
 * Funktion, und die fragt zuerst nach der Anmeldung.
 *
 * Routen:
 *   /app                → legacy-app/index.html   (Startbildschirm/Hub)
 *   /app#/aufmass       → dasselbe Dokument, Modul 1
 *   /app#/2d            → dasselbe Dokument, Modul 2
 *   /app/viewer2d.js    → legacy-app/viewer2d.js
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WURZEL = path.join(process.cwd(), 'legacy-app');

// Nur diese Dateitypen verlassen den Server. Was nicht in der Liste steht,
// gibt es aus Sicht der Route nicht – auch dann nicht, wenn es im Ordner liegt.
const TYPEN: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

/**
 * Aus den Pfadsegmenten der Route wird eine Datei in `legacy-app/`.
 * Gibt `null` zurück, sobald irgendetwas nicht stimmt – der Aufrufer macht
 * daraus ein 404, ohne zu verraten, woran es lag.
 */
function dateiPfad(segmente: string[]): string | null {
  const relativ = segmente.length === 0 ? 'index.html' : segmente.join('/');

  // „..", Null-Bytes, absolute Pfade: gar nicht erst weiterreichen.
  if (relativ.includes('\0') || relativ.split('/').some(t => t === '..' || t === '')) return null;

  const ziel = path.resolve(WURZEL, relativ);
  // Der Nachweis, dass die Auflösung den Ordner nicht verlassen hat.
  if (ziel !== WURZEL && !ziel.startsWith(WURZEL + path.sep)) return null;
  if (!(path.extname(ziel).toLowerCase() in TYPEN)) return null;

  return ziel;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ pfad?: string[] }> }
) {
  // Erste und wichtigste Prüfung: angemeldet UND freigeschaltet. Die
  // Middleware fängt fehlende Anmeldungen im Normalfall schon ab; das hier
  // ist die zweite Schicht, damit ein Fehler in der Matcher-Konfiguration
  // nicht gleich die ganze Anwendung öffnet. Die Freischaltung wird
  // ausschließlich hier geprüft – ein Konto allein genügt nicht.
  const zugang = await zugangPruefen();
  if (!zugang.erlaubt) {
    const pfadJetzt = new URL(req.url).pathname;
    if (zugang.grund === 'nicht-angemeldet') {
      const ziel = new URL('/sign-in', req.url);
      ziel.searchParams.set('redirect_url', pfadJetzt);
      return NextResponse.redirect(ziel);
    }
    // Angemeldet, aber nicht eingeladen: das Dokument führt zur Erklärung,
    // einzelne Dateien werden schlicht verweigert.
    return pfadJetzt === '/app' || pfadJetzt.endsWith('.html')
      ? NextResponse.redirect(new URL('/kein-zugang', req.url))
      : new NextResponse('Zugang nicht freigeschaltet', { status: 403 });
  }

  const { pfad = [] } = await ctx.params;
  const datei = dateiPfad(pfad);
  if (!datei) return new NextResponse('Nicht gefunden', { status: 404 });

  let inhalt: Buffer;
  try {
    const info = await stat(datei);
    if (!info.isFile()) return new NextResponse('Nicht gefunden', { status: 404 });
    inhalt = await readFile(datei);
  } catch {
    return new NextResponse('Nicht gefunden', { status: 404 });
  }

  const endung = path.extname(datei).toLowerCase();
  const istDokument = endung === '.html';

  // Die Skripte und Stylesheets tragen ihre Fassung in der Adresse
  // (`core.js?v=20260908`). Eine neue Fassung ist damit eine neue Adresse –
  // der Browser darf die alte beliebig lange behalten. Ohne Fassung in der
  // Adresse wird jedes Mal nachgefragt.
  const mitFassung = new URL(req.url).searchParams.has('v');
  const cache = istDokument
    ? 'private, no-store'
    : mitFassung
      ? 'private, max-age=604800, immutable'
      : 'private, no-cache';

  return new NextResponse(new Uint8Array(inhalt), {
    status: 200,
    headers: {
      'Content-Type': TYPEN[endung],
      'Cache-Control': cache,
      // Die Antworten hängen am angemeldeten Benutzer – kein geteilter Cache.
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
