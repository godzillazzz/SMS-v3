import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker as MapLibreMarker, NavigationControl, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const DEFAULT_CENTER: [number, number] = [100.5018, 13.7563];
const DEFAULT_ZOOM = 11;
const SITE_ZOOM = 17;
const GEOFENCE_SOURCE_ID = 'security-site-geofence';
const GEOFENCE_FILL_LAYER_ID = 'security-site-geofence-fill';
const GEOFENCE_LINE_LAYER_ID = 'security-site-geofence-line';

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

function createMarkerElement() {
  const element = document.createElement('div');
  element.className = 'security-site-map-picker__marker-shell';
  element.innerHTML = '<span class="security-site-map-picker__marker" aria-hidden="true"><i></i></span>';
  return element;
}

function geofenceFeature(longitude: number, latitude: number, radiusMeters: number) {
  const earthRadius = 6378137;
  const angularDistance = radiusMeters / earthRadius;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;
  const coordinates: [number, number][] = [];
  for (let index = 0; index <= 72; index += 1) {
    const bearing = (index / 72) * Math.PI * 2;
    const targetLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance)
      + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const targetLongitude = longitudeRadians + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(targetLatitude)
    );
    coordinates.push([targetLongitude * 180 / Math.PI, targetLatitude * 180 / Math.PI]);
  }
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [coordinates] }
  };
}

function emptyGeofenceCollection() {
  return { type: 'FeatureCollection' as const, features: [] as ReturnType<typeof geofenceFeature>[] };
}

export function SecuritySiteMapPicker({ latitude, longitude, radiusMeters, siteLabel, onPositionChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const callbackRef = useRef(onPositionChange);
  const lastPositionRef = useRef<string>('');
  const latestRef = useRef({ latitude, longitude, radiusMeters, siteLabel });

  const syncSiteOnMap = (map: MapLibreMap) => {
    const current = latestRef.current;
    const source = map.getSource(GEOFENCE_SOURCE_ID) as GeoJSONSource | undefined;
    if (!validCoordinate(current.latitude, current.longitude)) {
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      source?.setData(emptyGeofenceCollection());
      lastPositionRef.current = '';
      return;
    }

    const longitudeValue = current.longitude as number;
    const latitudeValue = current.latitude as number;
    const radius = Number.isFinite(current.radiusMeters) && (current.radiusMeters as number) > 0 ? current.radiusMeters as number : 100;
    const center: [number, number] = [longitudeValue, latitudeValue];
    const positionKey = `${latitudeValue.toFixed(7)},${longitudeValue.toFixed(7)}`;

    if (!markerRef.current) {
      const marker = new MapLibreMarker({ element: createMarkerElement(), draggable: true, anchor: 'bottom' })
        .setLngLat(center)
        .addTo(map);
      marker.getElement().title = current.siteLabel || 'Security Site';
      marker.on('dragend', () => {
        const dragged = marker.getLngLat();
        callbackRef.current({ latitude: dragged.lat, longitude: dragged.lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(center);
      markerRef.current.getElement().title = current.siteLabel || 'Security Site';
    }

    source?.setData({ type: 'FeatureCollection', features: [geofenceFeature(longitudeValue, latitudeValue, radius)] });

    if (lastPositionRef.current !== positionKey) {
      const previous = lastPositionRef.current;
      lastPositionRef.current = positionKey;
      if (!previous) map.easeTo({ center, zoom: SITE_ZOOM, duration: 0 });
      else if (!map.getBounds().contains(center)) map.panTo(center);
    }
  };

  useEffect(() => { callbackRef.current = onPositionChange; }, [onPositionChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const hasPosition = validCoordinate(latitude, longitude);
    const initialCenter: [number, number] = hasPosition ? [longitude as number, latitude as number] : DEFAULT_CENTER;
    const map = new MapLibreMap({
      container,
      center: initialCenter,
      zoom: hasPosition ? SITE_ZOOM : DEFAULT_ZOOM,
      minZoom: 3,
      maxZoom: 19,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19
          }
        },
        layers: [{ id: 'osm-basemap', type: 'raster', source: 'osm' }]
      }
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
    map.on('click', (event: MapMouseEvent) => {
      callbackRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    });
    map.on('load', () => {
      if (!map.getSource(GEOFENCE_SOURCE_ID)) {
        map.addSource(GEOFENCE_SOURCE_ID, { type: 'geojson', data: emptyGeofenceCollection() });
        map.addLayer({
          id: GEOFENCE_FILL_LAYER_ID,
          type: 'fill',
          source: GEOFENCE_SOURCE_ID,
          paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.08 }
        });
        map.addLayer({
          id: GEOFENCE_LINE_LAYER_ID,
          type: 'line',
          source: GEOFENCE_SOURCE_ID,
          paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-opacity': 0.95 }
        });
      }
      syncSiteOnMap(map);
    });

    mapRef.current = map;
    window.setTimeout(() => map.resize(), 0);

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      lastPositionRef.current = '';
    };
  }, []);

  useEffect(() => {
    latestRef.current = { latitude, longitude, radiusMeters, siteLabel };
    const map = mapRef.current;
    if (map?.getSource(GEOFENCE_SOURCE_ID)) syncSiteOnMap(map);
  }, [latitude, longitude, radiusMeters, siteLabel]);

  return <div className="security-site-map-picker">
    <div className="security-site-map-picker__map-frame">
    <div ref={containerRef} className="security-site-map-picker__canvas" aria-label="OpenStreetMap สำหรับเลือกตำแหน่ง Security Site" />
      <a className="security-site-map-picker__osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
    </div>
    <div className="security-site-map-picker__help">
      <strong>OpenStreetMap</strong>
      <span>คลิกบนแผนที่เพื่อวางตำแหน่ง หรือจับหมุดแล้วลากไปยังจุด Site ที่ต้องการ</span>
      <small>วงรอบหมุดแสดง Geofence ตามรัศมีที่กำหนด · พิกัด Latitude / Longitude จะอัปเดตอัตโนมัติ</small>
    </div>
  </div>;
}
