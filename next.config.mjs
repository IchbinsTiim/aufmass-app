/**
 * Next.js-Konfiguration für AufmaßX.
 *
 * Die beiden Anwendungen liegen in eigenen Ordnern – `aufmass/` (Aufmaß)
 * und `aufmass-2d/` (2D-Aufmaß) –, dazu die Startseite `start/` und die
 * gemeinsamen technischen Grundlagen `shared/`. Bewusst NICHT in `public/`:
 * alles unter `public/` liefert Vercel als statische Datei am Server vorbei
 * aus; die Anwendungen wären damit ohne Anmeldung abrufbar. Stattdessen
 * liest der geschützte Route Handler `app/app/[[...pfad]]` die Dateien zur
 * Laufzeit vom Dateisystem. Damit sie im Serverless-Bündel landen, müssen
 * sie hier ausdrücklich mitgegeben werden.
 */
const nextConfig = {
  outputFileTracingIncludes: {
    '/app/[[...pfad]]': [
      './start/**/*',
      './aufmass/**/*',
      './aufmass-2d/**/*',
      './shared/**/*'
    ]
  },

  async redirects() {
    return [
      // Alte Lesezeichen und geteilte Links aus der Zeit vor der Anmeldung.
      // Sie zeigen jetzt auf die geschützte Route – wer nicht angemeldet ist,
      // landet über die Middleware auf /sign-in.
      { source: '/aufmass_final_app', destination: '/app', permanent: true },
      { source: '/aufmass_final_app/index.html', destination: '/app', permanent: true },
      { source: '/aufmass_final_app/start.html', destination: '/app', permanent: true },
      { source: '/aufmass_final_app/viewer2d.html', destination: '/app/aufmass-2d', permanent: true },
      { source: '/aufmass_final_app/:pfad*', destination: '/app', permanent: true },
      // Adressen aus der Zeit, als beide Programme in einem Dokument lagen.
      // (Die Hash-Routen /app#/aufmass und /app#/2d sieht der Server nicht –
      // die leitet die Startseite selbst weiter, siehe start/start.js.)
      { source: '/app/index.html', destination: '/app', permanent: true },
      { source: '/app/start.html', destination: '/app', permanent: true },
      { source: '/app/viewer2d.html', destination: '/app/aufmass-2d', permanent: true }
    ];
  },

  async headers() {
    return [
      {
        source: '/:pfad*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Die App ist kein Einbettungsziel: kein fremdes iframe, kein
          // Clickjacking auf die Projektdaten.
          { key: 'X-Frame-Options', value: 'DENY' }
        ]
      }
    ];
  }
};

export default nextConfig;
