import { auth } from '@clerk/nextjs/server';
import { zugangPruefen } from '@/lib/zugang';
import { CloudFehler } from './cloud';

/** Einheitliche Zugangskontrolle für jede Cloud-Route. */
export async function cloudZugriff() {
  const [zugang, anmeldung] = await Promise.all([zugangPruefen(), auth()]);
  if (!anmeldung.userId || !zugang.erlaubt) throw new CloudFehler(401, 'Anmeldung erforderlich.');
  return { userId: anmeldung.userId, istAdmin: zugang.rolle === 'admin' };
}
