(function windowGeometryModule(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Talk2MeWindowGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis, function windowGeometryFactory() {
  'use strict';

  const DEFAULT_INSET = 14;
  const MIN_WIDTH = 360;
  const MIN_HEIGHT = 240;

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

  function layerSize(rect = {}) {
    return {
      width: Math.max(0, finite(rect.width)),
      height: Math.max(0, finite(rect.height))
    };
  }

  function safeInset(area, requested = DEFAULT_INSET) {
    return Math.max(0, Math.min(finite(requested, DEFAULT_INSET), area.width / 2, area.height / 2));
  }

  function defaultFloatingRect(layerRect, requestedInset = DEFAULT_INSET) {
    const area = layerSize(layerRect);
    const inset = safeInset(area, requestedInset);
    return {
      left: inset,
      top: inset,
      width: Math.max(0, area.width - (inset * 2)),
      height: Math.max(0, area.height - (inset * 2))
    };
  }

  function clampFloatingRect(rect = {}, layerRect, requestedInset = DEFAULT_INSET) {
    const area = layerSize(layerRect);
    const bounds = defaultFloatingRect(area, requestedInset);
    const minimumWidth = Math.min(MIN_WIDTH, bounds.width);
    const minimumHeight = Math.min(MIN_HEIGHT, bounds.height);
    const width = clamp(finite(rect.width, bounds.width), minimumWidth, bounds.width);
    const height = clamp(finite(rect.height, bounds.height), minimumHeight, bounds.height);
    const maximumLeft = area.width - safeInset(area, requestedInset) - width;
    const maximumTop = area.height - safeInset(area, requestedInset) - height;
    return {
      left: clamp(finite(rect.left, bounds.left), bounds.left, maximumLeft),
      top: clamp(finite(rect.top, bounds.top), bounds.top, maximumTop),
      width,
      height
    };
  }

  function maximizedRect(layerRect) {
    const area = layerSize(layerRect);
    return { left: 0, top: 0, width: area.width, height: area.height };
  }

  return { DEFAULT_INSET, MIN_WIDTH, MIN_HEIGHT, layerSize, defaultFloatingRect, clampFloatingRect, maximizedRect };
});
