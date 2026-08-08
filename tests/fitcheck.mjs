// Prüft geometrisch, dass der gezeichnete Plan auf JEDEM Blatt vollständig
// innerhalb des Zeichenbereichs liegt (nicht in Kopf-/Fußzeile ragt).
import { open, assert } from './harness.mjs';
const ctx = await open({ width: 1400, height: 1000 });
const { page } = ctx;

for (const scen of ['strasse', 'ushape', 'block', 'winzig']) {
  const r = await page.evaluate(kind => {
    state.sections = []; _sId=0;_bId=0;_aId=0; state.abschnitte=[];
    const mk=(ang,x,y,len)=>{const s=mkSection(nearestCardinal(ang),x,y);setSectionAngle(s,ang);
      const b=mkBay(len);b.hL=8.5;b.hR=8.5;s.bays.push(b);state.sections.push(s);};
    if (kind==='strasse') { for(let i=0;i<120;i++) mk(0,i*257,0,2.57); }
    if (kind==='ushape')  { let x=0;for(let i=0;i<40;i++){mk(0,x,0,2.57);x+=257;}
                            let y=0;for(let i=0;i<15;i++){mk(90,x,y,3.07);y+=307;}
                            for(let i=0;i<40;i++) mk(180,x-i*257,y,2.57); }
    if (kind==='block')   { for(let r2=0;r2<8;r2++) for(let c=0;c<12;c++) mk(0,c*257,r2*900,2.57); }
    if (kind==='winzig')  { mk(0,0,0,2.57); }
    renderAll(); flushRender();

    const layout = computeLayout();
    const out = [];
    for (const o of ['landscape','portrait']) {
      const pdfW = o==='landscape'?297:210, pdfH = o==='landscape'?210:297;
      const margin = PDF_MARGIN;
      const chromeH = PDF_HEADER_H + PDF_LEGEND_H + 2.5 + 2 + PDF_FOOTER_H;
      const availW = pdfW - 2*margin, availH = pdfH - 2*margin - chromeH;
      const plan = pdfPlanPages(layout, availW, availH);
      // Reale Zeichenfläche
      const top = margin + PDF_HEADER_H + PDF_LEGEND_H + 2.5;
      const contentBottom = pdfH - margin - PDF_FOOTER_H;
      const area = { x: margin, y: top, w: availW, h: contentBottom - top - 2 };
      let worst = 0;
      plan.pages.forEach(pg => {
        const s = plan.scale;
        const originX = area.x + (area.w - pg.win.w*s)/2 - pg.win.minX*s;
        const originY = area.y + (area.h - pg.win.h*s)/2 - pg.win.minY*s;
        pg.els.forEach(el => {
          const b = elBBox(el);
          const x1 = originX + b.minX*s, x2 = originX + b.maxX*s;
          const y1 = originY + b.minY*s, y2 = originY + b.maxY*s;
          worst = Math.max(worst, area.x - x1, x2 - (area.x+area.w),
                                  area.y - y1, y2 - (area.y+area.h));
        });
      });
      out.push({ o, pages: plan.pages.length, scale: Math.round(10/plan.scale), overflow: +worst.toFixed(2) });
    }
    return out;
  }, scen);
  r.forEach(x => console.log(`  ${scen.padEnd(8)} ${x.o.padEnd(10)} ${String(x.pages).padStart(3)} Blätter  1:${String(x.scale).padStart(3)}  Überstand ${x.overflow} mm`));
  r.forEach(x => assert(x.overflow <= 0.5, `${scen}/${x.o}: Plan bleibt im Zeichenbereich (Überstand ${x.overflow} mm)`));
}
console.log('\nAlle Blätter halten den Zeichenbereich ein.');
await ctx.close();
