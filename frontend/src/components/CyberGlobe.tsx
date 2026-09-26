type CyberGlobeProps = {
  bkkLatency: number;
  tyoLatency: number;
  sinLatency: number;
  lonLatency: number;
  satelliteCount: number;
};

type NodeProps = {
  className: string;
  name: string;
  value: string;
  detail: string;
  master?: boolean;
  muted?: boolean;
};

export function CyberGlobe({ bkkLatency, tyoLatency, sinLatency, lonLatency, satelliteCount }: CyberGlobeProps) {
  return (
    <figure className="cyber-globe" aria-label="ภาพโครงข่าย Cyber Globe จำลองสำหรับหน้า public">
      <div className="cyber-globe__aura" aria-hidden="true" />
      <div className="cyber-globe__frame" aria-hidden="true">
        <span className="cyber-corner cyber-corner--tl" />
        <span className="cyber-corner cyber-corner--tr" />
        <span className="cyber-corner cyber-corner--bl" />
        <span className="cyber-corner cyber-corner--br" />
      </div>
      <div className="cyber-globe__coordinate cyber-globe__coordinate--top" aria-hidden="true">13.7563°N / 100.5018°E</div>
      <div className="cyber-globe__coordinate cyber-globe__coordinate--side" aria-hidden="true">MESH / 04 · PUBLIC SIM</div>

      <div className="cyber-globe__stage">
        <div className="cyber-orbit cyber-orbit--outer" aria-hidden="true"><i /><b /></div>
        <div className="cyber-orbit cyber-orbit--tilt" aria-hidden="true"><i /></div>
        <div className="cyber-orbit cyber-orbit--reverse" aria-hidden="true" />
        <div className="cyber-globe__scan" aria-hidden="true" />

        <svg className="cyber-globe__svg" viewBox="0 0 660 660" role="img" aria-label="Simulated global security mesh centered on Bangkok">
          <defs>
            <radialGradient id="nexusSphere" cx="42%" cy="34%" r="68%">
              <stop offset="0%" stopColor="#8ce8f6" stopOpacity=".13" />
              <stop offset="45%" stopColor="#25b8d3" stopOpacity=".075" />
              <stop offset="100%" stopColor="#020813" stopOpacity=".12" />
            </radialGradient>
            <linearGradient id="nexusStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#a5f3fc" stopOpacity=".82" />
              <stop offset="50%" stopColor="#25b8d3" stopOpacity=".42" />
              <stop offset="100%" stopColor="#13788c" stopOpacity=".14" />
            </linearGradient>
            <linearGradient id="routeStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#25b8d3" stopOpacity=".08" />
              <stop offset="55%" stopColor="#a5f3fc" stopOpacity=".78" />
              <stop offset="100%" stopColor="#25b8d3" stopOpacity=".08" />
            </linearGradient>
            <filter id="cyanGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <clipPath id="sphereClip"><circle cx="330" cy="330" r="222" /></clipPath>
          </defs>

          <circle className="cyber-sphere__halo" cx="330" cy="330" r="252" />
          <circle className="cyber-sphere__edge" cx="330" cy="330" r="222" fill="url(#nexusSphere)" />
          <circle className="cyber-sphere__inner" cx="330" cy="330" r="205" />

          <g clipPath="url(#sphereClip)" className="cyber-grid-lines">
            <ellipse cx="330" cy="330" rx="222" ry="62" />
            <ellipse cx="330" cy="330" rx="222" ry="116" />
            <ellipse cx="330" cy="330" rx="222" ry="172" />
            <ellipse cx="330" cy="330" rx="72" ry="222" />
            <ellipse cx="330" cy="330" rx="132" ry="222" />
            <ellipse cx="330" cy="330" rx="186" ry="222" />
            <path d="M115 330H545" />
            <path d="M330 106V554" />
          </g>

          <g clipPath="url(#sphereClip)" className="cyber-contours" aria-hidden="true">
            <path d="M206 198l28-18 31 2 18 21 27 3 13 30-17 16-2 25-30 9-9 28-33 8-14 24-27-12-20 8-23-31 7-25-15-21 18-28 18-8 4-19z" />
            <path d="M346 218l28-20 44 8 21 24 42 14 11 31-19 19 14 24-22 24-38 5-14 26-31 8-18-21 3-33-25-17 11-26-15-23 8-43z" />
            <path d="M388 392l30-12 33 17 9 27-17 17-7 32-28 17-24-14-9-29 13-20z" />
            <path d="M247 385l20-9 22 15 6 25-15 24-17 35-22 3-18-26 9-30-11-17z" />
          </g>

          <g className="cyber-routes">
            <path className="route route--a" d="M218 276 C286 185 392 186 461 261" />
            <path className="route route--b" d="M230 395 C307 448 412 410 461 327" />
            <path className="route route--c" d="M270 207 C315 284 390 334 444 428" />
            <path className="route route--d" d="M183 339 C274 310 372 301 501 349" />
          </g>

          <g className="cyber-route-pulses" filter="url(#cyanGlow)" aria-hidden="true">
            <circle r="4"><animateMotion dur="4.8s" repeatCount="indefinite" path="M218 276 C286 185 392 186 461 261" /></circle>
            <circle r="3"><animateMotion dur="5.8s" repeatCount="indefinite" path="M230 395 C307 448 412 410 461 327" /></circle>
            <circle r="3"><animateMotion dur="6.4s" repeatCount="indefinite" path="M183 339 C274 310 372 301 501 349" /></circle>
          </g>

          <g className="cyber-vector-marks" aria-hidden="true">
            <path d="M330 76v20M330 564v20M76 330h20M564 330h20" />
            <path d="M172 132l14 14M474 514l14 14M488 132l-14 14M186 514l-14 14" />
          </g>
        </svg>

        <Node className="is-bkk" name="BKK-HQ" value={`${bkkLatency.toFixed(1)}ms`} detail="MASTER / SYNC 100%" master />
        <Node className="is-tyo" name="TYO-DC-02" value={`${tyoLatency.toFixed(1)}ms`} detail="REDUNDANT NODE" />
        <Node className="is-sin" name="SIN-HUB" value={`${sinLatency.toFixed(1)}ms`} detail="EDGE RELAY" />
        <Node className="is-lon" name="LON-GATE" value={`${lonLatency.toFixed(1)}ms`} detail="ENCLAVE" muted />

        <div className="cyber-orbital-badge">
          <span className="cyber-orbital-badge__icon" aria-hidden="true">⌁</span>
          <span><small>ORBITAL BEACON</small><b>{satelliteCount} SATELLITES LOCKED</b><em>SIMULATED</em></span>
        </div>
      </div>

      <figcaption className="cyber-globe__caption"><span><i />PUBLIC MESH SIMULATION</span><b>NO LIVE OPERATIONAL DATA</b></figcaption>
    </figure>
  );
}

function Node({ className, name, value, detail, master = false, muted = false }: NodeProps) {
  return (
    <div className={`cyber-node ${className} ${master ? 'is-master' : ''} ${muted ? 'is-muted' : ''}`}>
      <span className="cyber-node__beacon" aria-hidden="true"><i /><b /></span>
      <span className="cyber-node__label"><strong>{name}</strong><em>{value}</em><small>{detail}</small></span>
    </div>
  );
}
