/* Minimaler jsPDF-Stub für Tests: zeichnet nichts, protokolliert aber alle
   Aufrufe, damit Seitenaufbau/Reihenfolge des Exports geprüft werden kann. */
(function () {
  class Doc {
    constructor(opts) {
      // Aufrufliste PRO Dokument – sonst schleppt ein zweiter Export die
      // Aufrufe des ersten mit.
      const calls = this.calls = [];
      this._rec = (...a) => calls.push(a);
      this.opts = opts || {};
      this._page = 1;
      this._pages = 1;
      this._fontSize = 10;
      this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
      this._rec('new', JSON.stringify(opts));
    }
    addPage() { this._pages++; this._page = this._pages; this._rec('addPage', this._pages); return this; }
    setPage(n) { this._page = n; this._rec('setPage', n); return this; }
    getNumberOfPages() { return this._pages; }
    setFont() { return this; }
    setFontSize(v) { this._fontSize = v; return this; }
    getFontSize() { return this._fontSize; }
    getTextWidth(s) { return String(s).length * this._fontSize * 0.28; }
    setTextColor() { return this; }
    setFillColor() { return this; }
    setDrawColor() { return this; }
    setLineWidth() { return this; }
    setLineDashPattern() { return this; }
    setGState() { return this; }
    GState() { return {}; }
    text(str, x, y, o) { this._rec('text', this._page, String(str), x, y, JSON.stringify(o || {})); return this; }
    line() { this._rec('line', this._page); return this; }
    rect() { this._rec('rect', this._page); return this; }
    roundedRect() { this._rec('roundedRect', this._page); return this; }
    circle() { this._rec('circle', this._page); return this; }
    triangle() { this._rec('triangle', this._page); return this; }
    lines() { this._rec('lines', this._page); return this; }
    addImage() { this._rec('addImage', this._page); return this; }
    splitTextToSize(t, w) {
      const words = String(t).split(/\s+/);
      const per = Math.max(1, Math.floor(w / 2));
      const out = []; let cur = '';
      words.forEach(x => { if ((cur + ' ' + x).length > per) { out.push(cur.trim()); cur = x; } else cur += ' ' + x; });
      if (cur.trim()) out.push(cur.trim());
      return out.length ? out : [''];
    }
    save(name) { this._rec('save', name, this._pages); window.__pdfSaved = { name, pages: this._pages, calls: this.calls.slice() }; }
    output() { return ''; }
  }
  window.jspdf = { jsPDF: Doc };
})();
