/**
 * Herkunft einer Anfrage – Grundlage der Sperre nach zu vielen Fehlversuchen.
 *
 * Auf Vercel steht die echte Adresse in `x-forwarded-for`; der erste Eintrag
 * ist der Aufrufer. Die Adresse wird nie gespeichert, sondern nur gehasht
 * (siehe kennungAusHerkunft).
 */
export function herkunftLesen(req: Request): string {
  const weitergeleitet = req.headers.get('x-forwarded-for');
  if (weitergeleitet) {
    const erster = weitergeleitet.split(',')[0]?.trim();
    if (erster) return erster;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unbekannt';
}
