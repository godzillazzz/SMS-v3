import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER: L.LatLngExpression = [13.7563, 100.5018];
const DEFAULT_ZOOM = 11;
const SITE_ZOOM = 17;

export type SecuritySiteMapPosition = {
  latitude: number;
  longitude: number;
};

type Props = {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  siteLabel?: string;
  onPositionChange(position: SecuritySiteMapPosition): void;
};

function validCoordinate(latitude: number | null, longitude: number | null) {
  return latitude !== null
    && longitude !== null
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

const markerIcon = L.divIcon({
  className: 'security-site-map-picker__marker-shell',
  html: '<span class="security-site-map-picker__marker" aria-hidden="true"><i></i></span>',
  iconSize: [32, 42],
  iconAnchor: [16, 40]
});

export function SecuritySiteMapPicker({ latitude, longitude, radiusMeters, siteLabel, onPositionChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const callbackRef = useRef(onPositionChange);
  const lastPositionRef = useRef<string>('');

  useEffect(() => { callbackRef.current = onPositionChange; }, [onPositionChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const hasPosition = validCoordinate(latitude, longitude);
    const initialPosition: L.LatLngExpression = hasPosition ? [latitude as number, longitude as number] : DEFAULT_CENTER;
    const map = L.map(container, { zoomControl: true, attributionControl: true }).setView(initialPosition, hasPosition ? SITE_ZOOM : DEFAULT_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    map.on('click', (event: L.LeafletMouseEvent) => {
      callbackRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });

    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      lastPositionRef.current = '';
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!validCoordinate(latitude, longitude)) {
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      if (circleRef.current) { circleRef.current.remove(); circleRef.current = null; }
      lastPositionRef.current = '';
      return;
    }

    const position = L.latLng(latitude as number, longitude as number);
    const positionKey = `${position.lat.toFixed(7)},${position.lng.toFixed(7)}`;

    if (!markerRef.current) {
      markerRef.current = L.marker(position, {
        draggable: true,
        icon: markerIcon,
        keyboard: true,
        title: siteLabel || 'Security Site'
      }).addTo(map);
      markerRef.current.on('dragend', () => {
        const dragged = markerRef.current?.getLatLng();
        if (dragged) callbackRef.current({ latitude: dragged.lat, longitude: dragged.lng });
      });
    } else {
      markerRef.current.setLatLng(position);
      markerRef.current.options.title = siteLabel || 'Security Site';
    }

    const radius = Number.isFinite(radiusMeters) && (radiusMeters as number) > 0 ? radiusMeters as number : 100;
    if (!circleRef.current) {
      circleRef.current = L.circle(position, {
        radius,
        weight: 2,
        fillOpacity: 0.12,
        interactive: false
      }).addTo(map);
    } else {
      circleRef.current.setLatLng(position);
      circleRef.current.setRadius(radius);
    }

    if (lastPositionRef.current !== positionKey) {
      const previous = lastPositionRef.current;
      lastPositionRef.current = positionKey;
      if (!previous) map.setView(position, SITE_ZOOM);
      else if (!map.getBounds().pad(-0.2).contains(position)) map.panTo(position);
    }
  }, [latitude, longitude, radiusMeters, siteLabel]);

  return <div className="security-site-map-picker">
    <div ref={containerRef} className="security-site-map-picker__canvas" aria-label="OpenStreetMap สำหรับเลือกตำแหน่ง Security Site" />
    <div className="security-site-map-picker__help">
      <strong>OpenStreetMap</strong>
      <span>คลิกบนแผนที่เพื่อวางตำแหน่ง หรือจับหมุดแล้วลากไปยังจุด Site ที่ต้องการ</span>
      <small>วงรอบหมุดแสดง Geofence ตามรัศมีที่กำหนด · พิกัด Latitude / Longitude จะอัปเดตอัตโนมัติ</small>
    </div>
  </div>;
}
