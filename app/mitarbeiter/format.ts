/**
 * Datumsformate der Verwaltungsseiten.
 *
 * Deutsch, zweistellig, ohne Zeitzonen-Kürzel: Auf einer Baustelle liest man
 * „13.09.2026", nicht „2026-09-13T07:12:00.000Z". Ein leeres oder kaputtes
 * Datum wird zu „—" statt zu „Invalid Date".
 */

export function datum(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function datumZeit(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
