'use strict';

const db = require('../config/db');

let schemaPromise = null;

function clean(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

async function ensureUsageSchema() {
  if (!schemaPromise) {
    schemaPromise = db.execute(`CREATE TABLE IF NOT EXISTS crm_usage_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      staff_id BIGINT UNSIGNED NULL,
      event_type VARCHAR(40) NOT NULL,
      screen_key VARCHAR(120) NULL,
      route_path VARCHAR(255) NULL,
      module_name VARCHAR(120) NULL,
      entity_type VARCHAR(80) NULL,
      entity_id BIGINT UNSIGNED NULL,
      http_method VARCHAR(12) NULL,
      http_status SMALLINT UNSIGNED NULL,
      metadata_json JSON NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_crm_usage_occurred (occurred_at),
      KEY idx_crm_usage_staff_date (staff_id,occurred_at),
      KEY idx_crm_usage_screen_date (screen_key,occurred_at),
      KEY idx_crm_usage_event_date (event_type,occurred_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).finally(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

function normaliseRoute(value) {
  let route = clean(value || '/', 255) || '/';
  route = route.split('?')[0].replace(/^\/talk2me(?=\/|$)/, '') || '/';
  route = route.replace(/\/[0-9]+(?=\/|$)/g, '/:id');
  route = route.replace(/\/[0-9a-f]{24,64}(?=\/|$)/gi, '/:token');
  return route.slice(0, 255);
}

function screenKeyForRoute(value) {
  const route = normaliseRoute(value);
  if (route === '/' || route === '/workspace') return 'workspace';
  if (route.startsWith('/customers') || route.startsWith('/clients')) return route.includes('/:id') ? 'customer_detail' : 'customers';
  if (route.startsWith('/queries') || route.startsWith('/inquiries')) return 'queries';
  if (route.startsWith('/attendance')) return 'attendance';
  if (route.startsWith('/backoffice/attendance')) return 'attendance_register';
  if (route.startsWith('/backoffice')) return 'administration';
  if (route.startsWith('/command-centre')) return 'command_centre';
  if (route.startsWith('/approvals')) return 'approvals';
  if (route.startsWith('/upgrade-centre')) return 'upgrade_centre';
  if (route.startsWith('/office-intelligence')) return 'office_intelligence';
  if (route.startsWith('/agent')) return 'management_agent';
  if (route.startsWith('/uat/library')) return 'library';
  if (route.startsWith('/os/my-work')) return 'my_work';
  if (route.startsWith('/reports')) return 'reports';
  if (route.startsWith('/calendar')) return 'calendar';
  return route.split('/').filter(Boolean).slice(0, 2).join('_') || 'workspace';
}

function moduleForRoute(value) {
  const route = normaliseRoute(value);
  const first = route.split('/').filter(Boolean)[0];
  if (!first) return 'workspace';
  if (['customers','clients'].includes(first)) return 'customers';
  if (['queries','inquiries'].includes(first)) return 'queries';
  if (first === 'uat' && route.startsWith('/uat/library')) return 'library';
  return first.replace(/[^a-z0-9_-]/gi, '_').slice(0, 120);
}

async function trackEvent({
  staffId = null,
  eventType,
  screenKey = null,
  routePath = null,
  moduleName = null,
  entityType = null,
  entityId = null,
  httpMethod = null,
  httpStatus = null,
  metadata = null
}) {
  if (!eventType) return;
  try {
    await ensureUsageSchema();
    const safeRoute = routePath ? normaliseRoute(routePath) : null;
    const safeMetadata = metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : null;
    await db.execute(`INSERT INTO crm_usage_events
      (staff_id,event_type,screen_key,route_path,module_name,entity_type,entity_id,http_method,http_status,metadata_json)
      VALUES (:staffId,:eventType,:screenKey,:routePath,:moduleName,:entityType,:entityId,:httpMethod,:httpStatus,:metadata)`, {
      staffId: Number(staffId) || null,
      eventType: clean(eventType, 40),
      screenKey: clean(screenKey || (safeRoute ? screenKeyForRoute(safeRoute) : ''), 120) || null,
      routePath: safeRoute,
      moduleName: clean(moduleName || (safeRoute ? moduleForRoute(safeRoute) : ''), 120) || null,
      entityType: clean(entityType, 80) || null,
      entityId: Number(entityId) || null,
      httpMethod: clean(httpMethod, 12) || null,
      httpStatus: Number(httpStatus) || null,
      metadata: safeMetadata
    });
  } catch (error) {
    // Usage telemetry must never interrupt normal CRM work.
    if (process.env.NODE_ENV !== 'test') console.error('Usage telemetry write failed:', error.message);
  }
}

function usageMiddleware() {
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) return next();

    const method = String(req.method || 'GET').toUpperCase();
    const routePath = normaliseRoute(req.originalUrl || req.url || req.path || '/');
    const skip = routePath.startsWith('/public/')
      || routePath === '/service-worker.js'
      || routePath === '/manifest.webmanifest'
      || routePath === '/api/health'
      || routePath === '/api/release'
      || routePath.startsWith('/api/usage/');

    if (skip) return next();

    res.on('finish', () => {
      const contentType = String(res.getHeader('content-type') || '').toLowerCase();
      const isScreen = method === 'GET' && contentType.includes('text/html') && res.statusCode < 400;
      const isAction = ['POST','PUT','PATCH','DELETE'].includes(method) && res.statusCode < 400;
      if (!isScreen && !isAction) return;

      void trackEvent({
        staffId: user.id,
        eventType: isScreen ? 'screen_view' : 'http_action',
        routePath,
        httpMethod: method,
        httpStatus: res.statusCode
      });
    });

    next();
  };
}

module.exports = {
  ensureUsageSchema,
  trackEvent,
  usageMiddleware,
  normaliseRoute,
  screenKeyForRoute,
  moduleForRoute
};
