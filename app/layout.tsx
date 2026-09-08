import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { deDE } from '@clerk/localizations';
import './globals.css';

export const metadata: Metadata = {
  title: 'AufmaßX – Aufmaß & 2D-Aufmaß für den Gerüstbau',
  description: 'Positionen erfassen, Gerüste zeichnen, Angebots-PDF erzeugen.',
  // Die Anwendung gehört nicht in Suchergebnisse.
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0E1626'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {/* ClerkProvider liegt innerhalb von <body> – so schreibt es die
            aktuelle Clerk-Integration für den App Router vor. */}
        <ClerkProvider localization={deDE} afterSignOutUrl="/sign-in">
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
