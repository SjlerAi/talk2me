(function windowGeometryModule(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Talk2MeWindowGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis, function windowGeometryFactory() {
  'use strict';

  const DEFAULT_INSET = 14;
  const DEFAULT_FLOATING_RATIO = 0.95;
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
    const maximumWidth = Math.max(0, area.width - (inset * 2));
    const maximumHeight = Math.max(0, area.height - (inset * 2));
    const width = Math.min(maximumWidth, area.width * DEFAULT_FLOATING_RATIO);
    const height = Math.min(maximumHeight, area.height * DEFAULT_FLOATING_RATIO);
    return {
      left: (area.width - width) / 2,
      top: (area.height - height) / 2,
      width,
      height
    };
  }

  function clampFloatingRect(rect = {}, layerRect, requestedInset = DEFAULT_INSET) {
    const area = layerSize(layerRect);
    const fallback = defaultFloatingRect(area, requestedInset);
    const inset = safeInset(area, requestedInset);
    const maximumWidth = Math.max(0, area.width - (inset * 2));
    const maximumHeight = Math.max(0, area.height - (inset * 2));
    const minimumWidth = Math.min(MIN_WIDTH, maximumWidth);
    const minimumHeight = Math.min(MIN_HEIGHT, maximumHeight);
    const width = clamp(finite(rect.width, fallback.width), minimumWidth, maximumWidth);
    const height = clamp(finite(rect.height, fallback.height), minimumHeight, maximumHeight);
    const maximumLeft = area.width - inset - width;
    const maximumTop = area.height - inset - height;
    return {
      left: clamp(finite(rect.left, fallback.left), inset, maximumLeft),
      top: clamp(finite(rect.top, fallback.top), inset, maximumTop),
      width,
      height
    };
  }

  function maximizedRect(layerRect) {
    const area = layerSize(layerRect);
    return { left: 0, top: 0, width: area.width, height: area.height };
  }

  return { DEFAULT_INSET, DEFAULT_FLOATING_RATIO, MIN_WIDTH, MIN_HEIGHT, layerSize, defaultFloatingRect, clampFloatingRect, maximizedRect };
});
