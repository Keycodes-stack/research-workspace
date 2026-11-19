// Global error module: one place that turns any failure into a clear, consistent console report.
// Every API call goes through HaldenErrors.fromResponse / HaldenErrors.network (see apiFetch in halden-bridge.js),
// and every caught failure is logged with HaldenErrors.report(context, err). Uncaught errors are logged too.
(function () {
  'use strict';

  // Which part of the stack produced the failure, and what to check first.
  const LAYERS = {
    network: 'Browser could not reach the web server (localhost:3000). Is the web container running?',
    proxy: 'The web server could not get a reply from the gateway in time (Next.js proxy). Check the gateway/AI containers.',
    gateway: 'The gateway could not reach the AI service. Check that the AI container is running and healthy.',
    ai: 'The AI service rejected or failed the request. See code/message; grep its logs for the request id.',
    client: 'A bug in the page code (not a server error).'
  };

  class ApiError extends Error {
    constructor(f) {
      super(f.message);
      this.name = 'ApiError';
      Object.assign(this, f);
    }
  }

  function fromResponse({ method, path, status, body, ms }) {
    const structured = body && typeof body === 'object' && body.error && typeof body.error === 'object';
    let layer, code, message, requestId, where;
    if (structured) {                                   // the AI service's own error format (app/errors.py)
      ({ code, message, request_id: requestId, where } = body.error);
      layer = 'ai';
    } else if (body && typeof body === 'object' && typeof body.error === 'string') {
      layer = 'gateway'; code = body.error.replace(/\s+/g, '_'); message = body.error;
    } else if (status >= 500) {
      layer = 'proxy'; code = 'proxy_failed';
      message = status === 500 ? 'Proxy error: no reply from the gateway (timeout or connection reset)' : `HTTP ${status}`;
    } else {
      layer = 'ai'; code = `http_${status}`;
      const d = body && typeof body === 'object' ? body.detail : body;
      message = typeof d === 'string' && d ? d : `Request failed (${status})`;
    }
    return new ApiError({ message, status, code, layer, method, path, where, requestId, ms, hint: LAYERS[layer], body });
  }

  function network({ method, path, ms, cause }) {
    return new ApiError({ message: 'Cannot reach the server. Check that the web and gateway containers are running.',
      status: 0, code: 'network_error', layer: 'network', method, path, ms, hint: LAYERS.network, cause });
  }

  const recent = [];                                    // last 50 failures, for HaldenErrors.recent in the console

  function report(context, err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recent.push({ at: new Date().toISOString(), context, message: e.message, status: e.status, code: e.code, layer: e.layer });
    if (recent.length > 50) recent.shift();
    console.groupCollapsed(`%c✖ ${context}: ${e.message}`, 'color:#c0392b;font-weight:600');
    if (e instanceof ApiError) {
      console.error({
        request: `${e.method || 'GET'} ${e.path}`,
        status: e.status, code: e.code, layer: e.layer,
        failedAt: e.where, requestId: e.requestId, ms: e.ms
      });
      console.info('What to check:', e.hint);
      if (e.body && typeof e.body === 'object' && e.body.detail !== undefined) console.debug('Server detail:', e.body.detail);
    } else {
      console.error(e);
    }
    console.groupEnd();
    return e;
  }

  window.addEventListener('error', (ev) => {
    if (ev.error) report('Uncaught error', Object.assign(ev.error, { layer: 'client', hint: LAYERS.client }));
  });
  window.addEventListener('unhandledrejection', (ev) => report('Unhandled promise rejection', ev.reason));

  window.HaldenErrors = { ApiError, fromResponse, network, report, recent };
})();
