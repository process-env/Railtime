import { vi } from 'vitest';

// Mock Popup class
export class MockPopup {
  private html = '';
  private lngLat: [number, number] = [0, 0];
  private isOpen = false;

  setHTML(html: string) {
    this.html = html;
    return this;
  }

  getHTML() {
    return this.html;
  }

  setLngLat(lngLat: [number, number]) {
    this.lngLat = lngLat;
    return this;
  }

  getLngLat() {
    return { lng: this.lngLat[0], lat: this.lngLat[1] };
  }

  addTo = vi.fn(() => {
    this.isOpen = true;
    return this;
  });

  remove = vi.fn(() => {
    this.isOpen = false;
    return this;
  });

  isShown() {
    return this.isOpen;
  }
}

// Mock Marker class
export class MockMarker {
  private lngLat: [number, number] = [0, 0];
  private popup: MockPopup | null = null;
  private element: HTMLElement | null = null;

  constructor(options?: { element?: HTMLElement }) {
    this.element = options?.element || null;
  }

  setLngLat(lngLat: [number, number]) {
    this.lngLat = lngLat;
    return this;
  }

  getLngLat() {
    return { lng: this.lngLat[0], lat: this.lngLat[1] };
  }

  addTo = vi.fn(() => this);

  remove = vi.fn(() => this);

  setPopup(popup: MockPopup) {
    this.popup = popup;
    return this;
  }

  getPopup() {
    return this.popup;
  }

  togglePopup = vi.fn(() => {
    if (this.popup) {
      if (this.popup.isShown()) {
        this.popup.remove();
      } else {
        this.popup.addTo();
      }
    }
    return this;
  });

  getElement() {
    return this.element;
  }
}

// Mock NavigationControl
export class MockNavigationControl {
  onAdd = vi.fn(() => document.createElement('div'));
  onRemove = vi.fn();
}

// Mock AttributionControl
export class MockAttributionControl {
  onAdd = vi.fn(() => document.createElement('div'));
  onRemove = vi.fn();
}

// Mock Map class
export class MockMap {
  private center: [number, number] = [0, 0];
  private zoom = 10;
  private loaded = false;
  private eventHandlers: Record<string, Function[]> = {};
  private sources: Record<string, unknown> = {};
  private layers: Array<{ id: string; type: string; source: string }> = [];

  constructor(options?: {
    container?: HTMLElement | string;
    style?: string;
    center?: [number, number];
    zoom?: number;
  }) {
    if (options?.center) this.center = options.center;
    if (options?.zoom) this.zoom = options.zoom;

    // Simulate async load
    setTimeout(() => {
      this.loaded = true;
      this.fire('load');
    }, 0);
  }

  on(event: string, handler: Function) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
    return this;
  }

  off(event: string, handler: Function) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
    }
    return this;
  }

  fire(event: string, data?: unknown) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => handler(data));
    }
  }

  getCenter() {
    return { lng: this.center[0], lat: this.center[1] };
  }

  setCenter(center: [number, number]) {
    this.center = center;
    return this;
  }

  getZoom() {
    return this.zoom;
  }

  setZoom(zoom: number) {
    this.zoom = zoom;
    return this;
  }

  flyTo = vi.fn(({ center, zoom }: { center?: [number, number]; zoom?: number }) => {
    if (center) this.center = center;
    if (zoom) this.zoom = zoom;
    this.fire('moveend');
    return this;
  });

  addControl = vi.fn(() => this);
  removeControl = vi.fn(() => this);

  addSource(id: string, source: unknown) {
    this.sources[id] = source;
    return this;
  }

  getSource(id: string) {
    return this.sources[id];
  }

  addLayer(layer: { id: string; type: string; source: string }) {
    this.layers.push(layer);
    return this;
  }

  getLayer(id: string) {
    return this.layers.find(l => l.id === id);
  }

  removeLayer = vi.fn((id: string) => {
    this.layers = this.layers.filter(l => l.id !== id);
    return this;
  });

  getStyle() {
    return {
      layers: this.layers,
    };
  }

  setPaintProperty = vi.fn(() => this);
  setLayoutProperty = vi.fn(() => this);

  remove = vi.fn();

  isLoaded() {
    return this.loaded;
  }
}

// Create the mock module
export const createMaplibreMock = () => ({
  Map: MockMap,
  Marker: MockMarker,
  Popup: MockPopup,
  NavigationControl: MockNavigationControl,
  AttributionControl: MockAttributionControl,
});

// Default export for vi.mock
export default createMaplibreMock();
