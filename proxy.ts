import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Next.js 16 nennt diese Datei `proxy.ts` (früher `middleware.ts`).
 *
 * Serverseitiger Schutz – die einzige Stelle, an der entschieden wird, wer
 * die Anwendung sehen darf.
 *
 * Grundregel: alles ist geschützt, öffentlich sind nur die Anmeldeseiten
 * selbst. Das ist herum genau richtig: eine neue Route ist damit von sich
 * aus geschützt und nicht erst, wenn jemand daran denkt.
 */
const oeffentlich = createRouteMatcher([
  '/sign-in(.*)',
  // Zugang mit Einladungscode: die Seite muss erreichbar sein, sonst käme ein
  // neuer Mitarbeiter nie hierher. Sie gibt nichts preis – geprüft und
  // eingelöst wird serverseitig in /api/einladung/*.
  '/einladung(.*)',
  '/api/einladung/(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
  if (oeffentlich(req)) return;
  await auth.protect();
});

export const config = {
  matcher: [
    // Alles außer Next.js-Interna und den wenigen statischen Dateien im
    // Projekt. Wichtig: `/app` und alles darunter fällt NICHT unter diese
    // Ausnahme – die Aufmaß-App liegt nicht in `public/`, ihre Dateien
    // kommen aus dem geschützten Route Handler und müssen die Middleware
    // passieren, auch wenn sie auf `.js` oder `.css` enden.
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)',
    '/(api|trpc)(.*)',
    // Clerks eigener Proxy-Pfad – muss die Middleware erreichen.
    '/__clerk/:path*'
  ]
};
