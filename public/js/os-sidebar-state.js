(function sidebarStateModule(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Talk2MeSidebarState = api;
})(typeof window !== 'undefined' ? window : globalThis, function sidebarStateFactory() {
  'use strict';

  class SidebarState {
    constructor(options = {}) {
      this.storage = options.storage || null;
      this.preferenceKey = String(options.preferenceKey || 'talk2me-os-sidebar-collapsed');
      this.onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
      this.internalWindows = 0;
      this.externalWindows = 0;
      this.maximizedWindows = 0;
      this.windowOverride = null;
      this.dashboardCollapsed = this.readPreference();
      this.emit();
    }

    readPreference() {
      try { return this.storage?.getItem(this.preferenceKey) === '1'; } catch (_) { return false; }
    }

    savePreference() {
      try { this.storage?.setItem(this.preferenceKey, this.dashboardCollapsed ? '1' : '0'); } catch (_) {}
    }

    hasOpenWindows() {
      return this.internalWindows + this.externalWindows > 0;
    }

    isCollapsed() {
      if (this.maximizedWindows > 0) return true;
      if (this.hasOpenWindows()) return this.windowOverride === null ? true : this.windowOverride;
      return this.dashboardCollapsed;
    }

    snapshot() {
      return {
        collapsed: this.isCollapsed(),
        dashboardCollapsed: this.dashboardCollapsed,
        hasOpenWindows: this.hasOpenWindows(),
        manuallyOverriddenForWindows: this.windowOverride !== null,
        maximized: this.maximizedWindows > 0
      };
    }

    emit() {
      const state = this.snapshot();
      this.onChange(state);
      return state;
    }

    updateWindowCounts({ internal = this.internalWindows, external = this.externalWindows, maximized = this.maximizedWindows } = {}) {
      const wasOpen = this.hasOpenWindows();
      this.internalWindows = Math.max(0, Number(internal) || 0);
      this.externalWindows = Math.max(0, Number(external) || 0);
      this.maximizedWindows = Math.max(0, Number(maximized) || 0);
      const isOpen = this.hasOpenWindows();
      if (wasOpen !== isOpen) this.windowOverride = null;
      return this.emit();
    }

    toggleManually() {
      const nextCollapsed = !this.isCollapsed();
      if (this.hasOpenWindows()) {
        this.windowOverride = nextCollapsed;
      } else {
        this.dashboardCollapsed = nextCollapsed;
        this.savePreference();
      }
      return this.emit();
    }
  }

  return { SidebarState };
});
