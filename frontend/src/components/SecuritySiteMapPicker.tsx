import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER: L.LatLngExpression = [13.7563, 100.5018];
const DEFAULT_ZOOM = 11;
const SITE_ZOOM = 17;
export type SecuritySiteMapPosition = { latitude: number; longitude: number };
type Props = { latitude:number|null; longitude:number|null; radiusMeters:number|null; siteLabel?:string; onPositionChange(position:SecuritySiteMapPosition):void };
function validCoordinate(lat:number|null,lng:number|null){return lat!==null&&lng!==null&&Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180}
function markerIcon(){return L.divIcon({className:'security-site-map-picker__marker-shell',html:'<span class="security-site-map-picker__marker" aria-hidden="true"><i></i></span>',iconSize:[28,38],iconAnchor:[14,38]})}
export function SecuritySiteMapPicker({latitude,longitude,radiusMeters,siteLabel,onPositionChange}:Props){
 const containerRef=useRef<HTMLDivElement|null>(null); const mapRef=useRef<L.Map|null>(null); const markerRef=useRef<L.Marker|null>(null); const circleRef=useRef<L.Circle|null>(null); const callbackRef=useRef(onPositionChange); const latestRef=useRef({latitude,longitude,radiusMeters,siteLabel}); const lastPositionRef=useRef('');
 const syncSiteOnMap=(map:L.Map)=>{const current=latestRef.current;if(!validCoordinate(current.latitude,current.longitude)){markerRef.current?.remove();circleRef.current?.remove();markerRef.current=null;circleRef.current=null;lastPositionRef.current='';return} const lat=current.latitude as number,lng=current.longitude as number,radius=Number.isFinite(current.radiusMeters)&&(current.radiusMeters as number)>0?current.radiusMeters as number:100;const center:L.LatLngExpression=[lat,lng];const key=`${lat.toFixed(7)},${lng.toFixed(7)}`;
  if(!markerRef.current){const marker=L.marker(center,{draggable:true,icon:markerIcon(),title:current.siteLabel||'Security Site'}).addTo(map);marker.on('dragend',()=>{const p=marker.getLatLng();callbackRef.current({latitude:p.lat,longitude:p.lng})});markerRef.current=marker}else markerRef.current.setLatLng(center);
  if(!circleRef.current)circleRef.current=L.circle(center,{radius,color:'#ef4444',weight:3,opacity:.95,fillColor:'#ef4444',fillOpacity:.08}).addTo(map);else circleRef.current.setLatLng(center).setRadius(radius);
  if(lastPositionRef.current!==key){const previous=lastPositionRef.current;lastPositionRef.current=key;if(!previous)map.setView(center,SITE_ZOOM,{animate:false});else if(!map.getBounds().contains(center))map.panTo(center)}
 };
 useEffect(()=>{callbackRef.current=onPositionChange},[onPositionChange]);
 useEffect(()=>{const container=containerRef.current;if(!container||mapRef.current)return;const hasPosition=validCoordinate(latitude,longitude);const map=L.map(container,{zoomControl:true,attributionControl:false,minZoom:3,maxZoom:19}).setView(hasPosition?[latitude as number,longitude as number]:DEFAULT_CENTER,hasPosition?SITE_ZOOM:DEFAULT_ZOOM);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{minZoom:0,maxZoom:19}).addTo(map);map.on('click',(event:L.LeafletMouseEvent)=>callbackRef.current({latitude:event.latlng.lat,longitude:event.latlng.lng}));mapRef.current=map;syncSiteOnMap(map);window.setTimeout(()=>map.invalidateSize(),0);return()=>{map.remove();mapRef.current=null;markerRef.current=null;circleRef.current=null;lastPositionRef.current=''}},[]);
 useEffect(()=>{latestRef.current={latitude,longitude,radiusMeters,siteLabel};if(mapRef.current)syncSiteOnMap(mapRef.current)},[latitude,longitude,radiusMeters,siteLabel]);
 return <div className="security-site-map-picker"><div className="security-site-map-picker__map-frame"><div ref={containerRef} className="security-site-map-picker__canvas" aria-label="แผนที่ OpenStreetMap สำหรับเลือกตำแหน่ง Security Site"/><a className="security-site-map-picker__osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div><div className="security-site-map-picker__help"><strong>OpenStreetMap</strong><span>คลิกบนแผนที่หรือลากหมุดเพื่อกำหนดตำแหน่ง Security Site</span><small>วงกลมแสดงรัศมี Geofence ตามค่าที่กำหนด</small></div></div>;
}
