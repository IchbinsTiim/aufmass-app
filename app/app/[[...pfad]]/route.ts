import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { zugangPruefen } from '@/lib/zugang';

/**
 * Die beiden Anwendungen und ihre Startseite – geschützt ausgeliefert.
 *
 * Jede Anwendung liegt in ihrem EIGENEN Ordner, mit eigenem Code, eigenen
 * Styles und eigenen Daten. Gemeinsam ist nur `shared/` (Design-Tokens und
 * die einmalige Speicher-Migration):
 *
 *   /app                        → start/index.html        (Startseite)
 *   /app/start/…                → start/…
 *   /app/aufmass                → aufmass/index.html      (Aufmaß)
 *   /app/aufmass/script.js      → aufmass/script.js
 *   /app/aufmass-2d             → aufmass-2d/index.html   (2D-Aufmaß)
 *   /app/aufmass-2d/viewer2d.js → aufmass-2d/viewer2d.js
 *   /app/shared/tokens.css      → shared/tokens.css
 *
 * Die Ordner liegen bewusst NICHT in `public/`: was dort liegt, liefert
 * Vercel als statische Datei aus, bevor irgendein Servercode läuft – die
 * Anmeldung wäre eine Empfehlung, keine Sperre. Hier kommt jede einzelne
 * Datei durch diese Funktion, und die fragt zuerst nach der Anmeldung.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Erstes Pfadsegment → Ordner im Projekt. Was nicht in dieser Liste steht,
// gibt es aus Sicht der Route nicht.
const ORDNER: Record<string, string> = {
  start:        'start',
  aufmass:      'aufmass',
  'aufmass-2d': 'aufmass-2d',
  shared:       'shared'
};
// Ordner mit eigener Einstiegsseite (index.html) – `shared/` hat keine.
const MIT_STARTSEITE = new Set(['start', 'aufmass', 'aufmass-2d']);

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
 * Aus den Pfadsegmenten der Route wird eine Datei in einem der Ordner oben.
 * Gibt `null` zurück, sobald irgendetwas nicht stimmt – der Aufrufer macht
 * daraus ein 404, ohne zu verraten, woran es lag.
 */
function dateiPfad(segmente: string[], basis = process.cwd()): string | null {
  // /app selbst ist die Startseite.
  const [kopf = 'start', ...rest] = segmente;
  if (!Object.prototype.hasOwnProperty.call(ORDNER, kopf)) return null;
  const wurzel = path.join(basis, ORDNER[kopf]);

  let relativ = rest.join('/');
  if (!relativ) {
    if (!MIT_STARTSEITE.has(kopf)) return null;
    relativ = 'index.html';
  }

  // „..", Null-Bytes, absolute Pfade: gar nicht erst weiterreichen.
  if (relativ.includes('\0') || relativ.split('/').some(t => t === '..' || t === '' || t === '.')) return null;

  const ziel = path.resolve(wurzel, relativ);
  // Der Nachweis, dass die Auflösung den Ordner nicht verlassen hat.
  if (ziel !== wurzel && !ziel.startsWith(wurzel + path.sep)) return null;
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
    // Angemeldet, aber nicht eingeladen: eine Seite führt zur Erklärung,
    // einzelne Dateien werden schlicht verweigert. Ob eine Seite gemeint
    // ist, sagt allein die Adresse – nachgeschaut wird auf dem Datenträger
    // erst NACH der Anmeldung.
    const { pfad = [] } = await ctx.params;
    const istSeite = pfad.length <= 1 || pfadJetzt.endsWith('.html');
    return istSeite
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
  // (`script.js?v=20260928`). Eine neue Fassung ist damit eine neue Adresse –
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
