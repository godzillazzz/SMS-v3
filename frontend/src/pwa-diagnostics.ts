export type SmsPwaDiagnostics = {
  standalone: boolean;
  secureContext: boolean;
  serviceWorkerSupported: boolean;
  serviceWorkerControlled: boolean;
  cameraSupported: boolean;
  locationSupported: boolean;
};

export function readSmsPwaDiagnostics(): SmsPwaDiagnostics {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      standalone: false,
      secureContext: false,
      serviceWorkerSupported: false,
      serviceWorkerControlled: false,
      cameraSupported: false,
      locationSupported: false
    };
  }

  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  const serviceWorkerSupported = 'serviceWorker' in navigator;

  return {
    standalone: iosStandalone || displayStandalone,
    secureContext: window.isSecureContext === true,
    serviceWorkerSupported,
    serviceWorkerControlled: serviceWorkerSupported && Boolean(navigator.serviceWorker.controller),
    cameraSupported: Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'),
    locationSupported: 'geolocation' in navigator
  };
}
