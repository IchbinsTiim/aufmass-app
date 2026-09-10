import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { Marke } from '../../marke';
import { clerkErscheinung } from '../../erscheinung';

export const metadata = { title: 'Anmelden · AufmaßX' };

export default async function AnmeldeSeite({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const geradeAngelegt = params.neu === '1';

  return (
    <main className="auth-seite">
      <div className="auth-inhalt">
        <Marke untertitel="Melden Sie sich an, um Ihre Aufmaße und Zeichnungen zu öffnen." />

        {geradeAngelegt ? (
          <p className="auth-bestaetigt">
            Konto angelegt ✓ Melden Sie sich jetzt mit Ihrem Benutzernamen an.
          </p>
        ) : null}

        <SignIn appearance={clerkErscheinung} signUpUrl="/einladung" />

        <p className="auth-fuss">
          Noch keinen Zugang? Sie brauchen eine Einladung von einem
          AufmaßX-Administrator.
          <br />
          <Link href="/einladung">Einladungscode verwenden</Link>
        </p>
      </div>
    </main>
  );
}
