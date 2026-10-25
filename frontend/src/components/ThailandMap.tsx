import { THAILAND_MAP as M } from './thailand-map-data';

type NodeKey = keyof typeof M.nodes;

type NodeLabel = {
  key: NodeKey;
  title: string;
  line: string;
  detail?: string;
  master?: boolean;
  /** label offset from the node, in map units */
  dx: number;
  dy: number;
};

/* Capabilities of the system, not live data or real locations. */
const LABELS: NodeLabel[] = [
  { key: 'att', title: 'ลงเวลาตามกะ', line: 'GPS · จุดปฏิบัติงาน', detail: 'PWA · บันทึกได้แม้ออฟไลน์', master: true, dx: 34, dy: 44 },
  { key: 'sch', title: 'ตารางกะรายเดือน', line: 'ตรวจกฎก่อนส่งอนุมัติ', dx: 30, dy: -6 },
  { key: 'apr', title: 'ศูนย์อนุมัติ', line: 'ตามสิทธิ์ 4 ระดับ', dx: 26, dy: -30 },
  { key: 'lic', title: 'ใบอนุญาต รปภ.', line: 'เตือนก่อนหมดอายุ', dx: 36, dy: -4 }
];

const pct = (value: number, total: number) => `${(value / total) * 100}%`;
const ring = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/**
 * Thailand drawn in the visual language of the former CyberGlobe: lens (old sphere) with neighbouring land,
 * 1° graticule clipped to the country, gradient border with glow, dot matrix, routes, orbits, scan sweep and nodes.
 * Purely illustrative — it never shows live data or real site locations.
 */
export function ThailandMap({ showLabels = true }: { showLabels?: boolean }) {
  const { width: W, height: H, lens } = M;
  const bkk = M.bangkok;
  const sweepR = lens.r * 0.95;
  const a0 = (-62 * Math.PI) / 180;
  const a1 = (-24 * Math.PI) / 180;
  const sweep = `M${bkk[0]} ${bkk[1]}L${bkk[0] + sweepR * Math.cos(a0)} ${bkk[1] + sweepR * Math.sin(a0)}A${sweepR} ${sweepR} 0 0 1 ${bkk[0] + sweepR * Math.cos(a1)} ${bkk[1] + sweepR * Math.sin(a1)}Z`;
  return (
    <figure className="th-map" aria-label="ภาพประกอบแผนที่ประเทศไทย" style={{ aspectRatio: `${W} / ${H}` }}>
      <div className="th-map__aura" aria-hidden="true" />
      <div className="cyber-globe__frame th-map__frame" aria-hidden="true">
        <span className="cyber-corner cyber-corner--tl" />
        <span className="cyber-corner cyber-corner--tr" />
        <span className="cyber-corner cyber-corner--bl" />
        <span className="cyber-corner cyber-corner--br" />
      </div>
      <div className="th-map__coordinate th-map__coordinate--top" aria-hidden="true">13.7563°N / 100.5018°E</div>
      <div className="th-map__coordinate th-map__coordinate--side" aria-hidden="true">THAILAND · 5°37′N – 20°27′N</div>

      <svg className="th-map__svg" viewBox={`0 0 ${W} ${H}`} role="presentation" focusable="false" aria-hidden="true">
        <defs>
          <radialGradient id="thMapFill" cx="38%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#8ce8f6" stopOpacity=".20" />
            <stop offset="45%" stopColor="#25b8d3" stopOpacity=".10" />
            <stop offset="100%" stopColor="#020813" stopOpacity=".18" />
          </radialGradient>
          <linearGradient id="thMapStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a5f3fc" stopOpacity=".92" />
            <stop offset="50%" stopColor="#25b8d3" stopOpacity=".62" />
            <stop offset="100%" stopColor="#13788c" stopOpacity=".34" />
          </linearGradient>
          <radialGradient id="thMapLens" cx="42%" cy="34%" r="68%">
            <stop offset="0%" stopColor="#8ce8f6" stopOpacity=".07" />
            <stop offset="45%" stopColor="#25b8d3" stopOpacity=".035" />
            <stop offset="100%" stopColor="#020813" stopOpacity=".10" />
          </radialGradient>
          <linearGradient id="thMapRoute" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#25b8d3" stopOpacity=".10" />
            <stop offset="55%" stopColor="#a5f3fc" stopOpacity=".85" />
            <stop offset="100%" stopColor="#25b8d3" stopOpacity=".10" />
          </linearGradient>
          <linearGradient id="thMapScan" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#25b8d3" stopOpacity="0" />
            <stop offset="100%" stopColor="#25b8d3" stopOpacity=".10" />
          </linearGradient>
          <filter id="thMapGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="thMapLensClip"><circle cx={lens.cx} cy={lens.cy} r={lens.r} /></clipPath>
          <clipPath id="thMapCountryClip"><path d={M.thailand} /></clipPath>
        </defs>

        <g className="th-map__lens">
          <path className="th-map__halo-ring" d={ring(lens.cx, lens.cy, lens.r * 1.135)} />
          <circle className="th-map__lens-edge" cx={lens.cx} cy={lens.cy} r={lens.r} fill="url(#thMapLens)" />
          <path className="th-map__lens-inner" d={ring(lens.cx, lens.cy, lens.r * 0.923)} />
          <path className="th-map__sea-grid" d={M.seaGraticule} />
          <path className="th-map__neighbours" d={M.neighbours} clipPath="url(#thMapLensClip)" />
        </g>

        <g className="th-map__orbits" style={{ transformOrigin: `${lens.cx}px ${lens.cy}px` }}>
          <circle className="th-map__orbit th-map__orbit--outer" cx={lens.cx} cy={lens.cy} r={lens.r * 1.24} />
          <ellipse className="th-map__orbit th-map__orbit--tilt" cx={lens.cx} cy={lens.cy} rx={lens.r * 1.2} ry={lens.r * 0.52} transform={`rotate(-18 ${lens.cx} ${lens.cy})`} />
          <ellipse className="th-map__orbit th-map__orbit--reverse" cx={lens.cx} cy={lens.cy} rx={lens.r * 1.26} ry={lens.r * 0.38} transform={`rotate(35 ${lens.cx} ${lens.cy})`} />
        </g>

        <g clipPath="url(#thMapLensClip)">
          <path className="th-map__scan" d={sweep} fill="url(#thMapScan)" style={{ transformOrigin: `${bkk[0]}px ${bkk[1]}px` }} />
        </g>

        <g className="th-map__country">
          <path className="th-map__halo" d={M.halo} />
          <path d={M.thailand} fill="url(#thMapFill)" />
          <g clipPath="url(#thMapCountryClip)">
            <path className="th-map__grid" d={M.graticuleFine} />
            <path className="th-map__grid th-map__grid--strong" d={M.graticuleStrong} />
          </g>
          <path className="th-map__dots th-map__dots--near" d={M.dotsNear} />
          <path className="th-map__dots th-map__dots--mid" d={M.dotsMid} />
          <path className="th-map__dots th-map__dots--far" d={M.dotsFar} />
          <path className="th-map__inner" d={M.inner} />
          <path className="th-map__border" d={M.thailand} stroke="url(#thMapStroke)" filter="url(#thMapGlow)" />
        </g>

        <g className="th-map__routes">
          {M.routes.map((d) => <path key={d} className="th-map__route" d={d} stroke="url(#thMapRoute)" />)}
        </g>
        <g className="th-map__pulses" filter="url(#thMapGlow)">
          {M.routes.slice(0, 3).map((d, index) => (
            <circle key={d} r="3">
              <animateMotion dur={`${4.8 + index * 0.8}s`} repeatCount="indefinite" path={d} />
            </circle>
          ))}
        </g>
      </svg>

      {LABELS.map((label) => {
        const [x, y] = M.nodes[label.key];
        return (
          <div key={label.key} className={`th-map__node${label.master ? ' is-master' : ''}`} style={{ left: pct(x, W), top: pct(y, H) }} aria-hidden="true">
            <span className="cyber-node__beacon"><i /><b /></span>
            {showLabels && (
              <span className="th-map__label" style={{ left: pct(label.dx, W), top: pct(label.dy, H) }}>
                <strong>{label.title}</strong>
                <em>{label.line}</em>
                {label.detail && <small>{label.detail}</small>}
              </span>
            )}
          </div>
        );
      })}

      <figcaption className="th-map__caption"><span><i />ภาพประกอบระบบ</span><b>ไม่แสดงตำแหน่งหรือข้อมูลปฏิบัติการจริง</b></figcaption>
    </figure>
  );
}
