'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { abfrageHolen, pepperHolen } from '@/lib/einladungen/db';
import { codeErzeugen, codeFormatieren, codeNormalisieren } from '@/lib/einladungen/code';
import { einladungAnlegen, einladungWiderrufen } from '@/lib/einladungen/kern';
import { STANDARD_ROLLE, hatRecht } from '@/lib/rollen';
import { rollenHolen, zugangMitRechten } from '@/lib/zugang';

/**
 * Aktionen der Einladungsverwaltung.
 *
 * Jede prüft die Adminrolle selbst. Server Actions sind eigene Endpunkte –
 * sie hinter einer Seite zu verstecken, die nur Admins sehen, wäre keine
 * Absicherung.
 */

async function adminOderRaus() {
  const zugang = await zugangMitRechten();
  if (!zugang.erlaubt || !hatRecht(zugang.rechte, 'mitarbeiter.verwalten')) {
    throw new Error('Dafür fehlt Ihrer Rolle die Berechtigung.');
  }
  const { userId } = await auth();
  const abfrage = abfrageHolen();
  const pepper = pepperHolen();
  if (!abfrage || !pepper) {
    throw new Error('Einladungen sind auf diesem Server noch nicht eingerichtet.');
  }
  return { abfrage, pepper, userId: userId ?? 'unbekannt' };
}

export type AnlegeErgebnis = {
  /** Der Klartext-Code – existiert genau einmal, hier, und wird nie gespeichert. */
  code?: string;
  fehler?: string;
};

export async function codeAnlegen(
  _vorher: AnlegeErgebnis | null,
  formular: FormData
): Promise<AnlegeErgebnis> {
  let abfrage, pepper, userId;
  try {
    ({ abfrage, pepper, userId } = await adminOderRaus());
  } catch (fehler) {
    return { fehler: (fehler as Error).message };
  }

  const tage = Math.min(Math.max(Number(formular.get('tage') || 7), 1), 90);
  const notiz = String(formular.get('notiz') || '').trim().slice(0, 200) || null;

  // Eingeladen wird in eine Rolle, die es auch gibt. Eine erfundene Kennung
  // aus einer manipulierten Auswahlliste landet sonst als Freischaltung in
  // den Metadaten eines Clerk-Kontos – mit einer Rolle, deren Rechte
  // niemand festgelegt hat.
  const gewuenscht = String(formular.get('rolle') || '');
  const rollen = await rollenHolen();
  const rolle = rollen.some(r => r.id === gewuenscht) ? gewuenscht : STANDARD_ROLLE;

  const code = codeErzeugen();
  const normalisiert = codeNormalisieren(code);

  await einladungAnlegen(abfrage, {
    codeNormalisiert: normalisiert,
    pepper,
    gueltigTage: tage,
    erstelltVonUserId: userId,
    rolle,
    notiz
  });

  revalidatePath('/admin/einladungen');
  // Ab hier gibt es den Code nur noch auf dem Bildschirm des Admins.
  return { code: codeFormatieren(normalisiert) };
}

export async function codeWiderrufen(formular: FormData): Promise<void> {
  const { abfrage } = await adminOderRaus();
  const id = String(formular.get('id') || '');
  if (id) await einladungWiderrufen(abfrage, id);
  revalidatePath('/admin/einladungen');
}
