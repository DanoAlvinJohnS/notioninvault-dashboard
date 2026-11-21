import * as d3 from 'd3';
import { S, hooks } from './state.js';

const placed = new Map();   // note path -> where it settled last time, so a redraw does not re-run the whole layout


/* Force-directed graph of the vault's links, drawn into the <svg> `el` and kept centred when its size changes.
   Returns a cleanup function. */
export function drawGraph(el) {
  const size = () => [el.clientWidth || 600, el.clientHeight || 400];
  let [W, H] = size();
  const nodes = S.data.notes.map(n => ({ id: n.path, title: n.title, deg: n.deg, task: n.type === 'task', ...placed.get(n.path) }));
  const warm = nodes.length > 0 && nodes.every(d => d.x != null);
  const links = S.data.edges.map(e => ({ source: e[0], target: e[1] }));
  const C = { g: 'var(--g)', o: 'var(--o)', y: 'var(--y)' };   // variable references, so the colour effect reaches the nodes
  const col = d => d.task ? C.g : d.deg >= 6 ? C.o : d.deg > 0 ? C.y : '#9aa1ad';
  const svg = d3.select(el), root = svg.append('g');
  let touched = false;   // once the user pans or zooms, we stop re-fitting
  const zoom = d3.zoom().scaleExtent([.2, 4]).on('zoom', e => { if (e.sourceEvent) touched = true; root.attr('transform', e.transform); });
  svg.call(zoom);
  const l = root.append('g').attr('stroke', '#3a414d').selectAll('line').data(links).join('line');
  const n = root.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer').on('click', (e, d) => hooks.openNote(d.id));
  n.append('circle').attr('r', d => 4 + Math.sqrt(d.deg) * 2.2).attr('fill', col);
  n.append('text').text(d => d.title).attr('x', 9).attr('y', 4).attr('fill', '#8a92a0').attr('font-size', 11).style('display', d => d.deg >= 3 || d.task ? null : 'none');
  n.append('title').text(d => d.title);
  const centre = s => s.force('center', d3.forceCenter(W / 2, H / 2)).force('x', d3.forceX(W / 2).strength(.04)).force('y', d3.forceY(H / 2).strength(.04));
  let sim = centre(d3.forceSimulation(nodes).force('link', d3.forceLink(links).id(d => d.id).distance(50)).force('charge', d3.forceManyBody().strength(-90)))
    .on('tick', draw);
  function draw() { l.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y); n.attr('transform', d => `translate(${d.x},${d.y})`); }
  const fit = (now = false) => {   // scale and move the whole graph to sit inside the widget, clear of the button (top) and legend (bottom)
    if (touched || nodes.some(d => d.x == null)) return;
    const xs = nodes.map(d => d.x), ys = nodes.map(d => d.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const top = 44, bottom = 34, side = 24, k = Math.min(2, (W - 2 * side) / Math.max(1, x1 - x0), (H - top - bottom) / Math.max(1, y1 - y0));
    (now ? svg : svg.transition().duration(450)).call(zoom.transform, d3.zoomIdentity.translate((W - k * (x0 + x1)) / 2, top + (H - top - bottom - k * (y0 + y1)) / 2).scale(k));
  };
  sim.on('end.fit', () => fit());
  if (warm) { sim.stop(); draw(); fit(true); }   // same notes as last time: put them back where they settled (drag and resize still restart it)
  const fitTimer = warm ? 0 : setTimeout(fit, 1100);
  n.call(d3.drag().on('start', (e, d) => { if (!e.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; }).on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = d.fy = null; }));
  const ro = new ResizeObserver(() => {
    const [w, h] = size();
    if (Math.abs(w - W) < 2 && Math.abs(h - H) < 2) return;
    W = w; H = h; centre(sim).alpha(.3).restart();
  });
  ro.observe(el);
  return () => { clearTimeout(fitTimer); sim.stop(); ro.disconnect(); for (const d of nodes) if (d.x != null) placed.set(d.id, { x: d.x, y: d.y }); };
}
