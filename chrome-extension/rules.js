const SESSION_HEADER = 'x-session-id';

const ALL_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];

const DYNAMIC_RULE_IDS = {
  connect: 1,
  http: 2,
};

const SESSION_RULE_IDS = {
  connect: 101,
  http: 102,
};

function buildProxyAuthorization(sessionId) {
  return `Basic ${btoa(`${sessionId}:session`)}`;
}

function buildRequestHeaders(sessionId) {
  return [
    { header: SESSION_HEADER, operation: 'set', value: sessionId },
    {
      header: 'proxy-authorization',
      operation: 'set',
      value: buildProxyAuthorization(sessionId),
    },
  ];
}

function buildHeaderRules(sessionId, ids) {
  if (!sessionId) return [];

  const headerAction = {
    type: 'modifyHeaders',
    requestHeaders: buildRequestHeaders(sessionId),
  };

  return [
    {
      id: ids.connect,
      priority: 2,
      action: headerAction,
      condition: {
        requestMethods: ['connect'],
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    },
    {
      id: ids.http,
      priority: 1,
      action: headerAction,
      condition: {
        urlFilter: '|http*',
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    },
  ];
}

function buildDynamicHeaderRules(sessionId) {
  return buildHeaderRules(sessionId, DYNAMIC_RULE_IDS);
}

function buildSessionHeaderRules(sessionId) {
  return buildHeaderRules(sessionId, SESSION_RULE_IDS);
}

function allRuleIds(ids) {
  return [ids.connect, ids.http];
}

const FORWARD_PROXY_PORTS = { go: 8081, node: 8080 };
const ADMIN_API_PORTS = [3001, 9001];

function parseProxySettings(rawHost, rawPort, rawScheme) {
  let host = String(rawHost || '').trim();
  let port = parseInt(rawPort, 10);
  const scheme = rawScheme === 'https' ? 'https' : 'http';

  if (!host) {
    throw new Error('Proxy host is empty — enter hostname only (no http://)');
  }

  host = host.replace(/^(https?|socks5|socks4):\/\//i, '');

  if (host.includes('@')) {
    host = host.split('@').pop().trim();
  }

  host = host.split('/')[0].split('?')[0].trim();

  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) {
      const rest = host.slice(end + 1);
      host = host.slice(1, end);
      if (rest.startsWith(':')) {
        const embedded = parseInt(rest.slice(1), 10);
        if (Number.isInteger(embedded) && embedded > 0 && embedded <= 65535) {
          port = embedded;
        }
      }
    }
  } else if (host.includes(':')) {
    const lastColon = host.lastIndexOf(':');
    const embedded = parseInt(host.slice(lastColon + 1), 10);
    if (Number.isInteger(embedded) && embedded > 0 && embedded <= 65535) {
      port = embedded;
      host = host.slice(0, lastColon);
    }
  }

  host = host.trim();
  if (!host) {
    throw new Error('Proxy host is invalid — use hostname only, e.g. proxy.example.com');
  }

  if (host.toLowerCase() === 'localhost' || host === '127.0.0.1' || host === '::1') {
    host = '127.0.0.1';
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Proxy port must be between 1 and 65535');
  }

  if (ADMIN_API_PORTS.includes(port)) {
    throw new Error(
      `Port ${port} is the read-only admin API. Use forward proxy port ${FORWARD_PROXY_PORTS.go} (Go) or ${FORWARD_PROXY_PORTS.node} (Node) for browsing.`
    );
  }

  return { proxyHost: host, proxyPort: port, proxyScheme: scheme };
}
