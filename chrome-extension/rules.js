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

// Legacy CONNECT rule IDs from earlier versions (DNR cannot modify proxy CONNECT).
const LEGACY_CONNECT_RULE_IDS = [1, 101];

const DYNAMIC_RULE_IDS = {
  http: 2,
};

const SESSION_RULE_IDS = {
  http: 102,
};

function buildHttpHeaderRule(sessionId, id) {
  if (!sessionId) return null;

  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: SESSION_HEADER, operation: 'set', value: sessionId },
      ],
    },
    condition: {
      urlFilter: '|http*',
      resourceTypes: ALL_RESOURCE_TYPES,
    },
  };
}

function buildDynamicHeaderRules(sessionId) {
  const rule = buildHttpHeaderRule(sessionId, DYNAMIC_RULE_IDS.http);
  return rule ? [rule] : [];
}

function buildSessionHeaderRules(sessionId) {
  const rule = buildHttpHeaderRule(sessionId, SESSION_RULE_IDS.http);
  return rule ? [rule] : [];
}

function allRuleIds(ids) {
  return Object.values(ids);
}

function allRuleIdsToRemove(ids) {
  return [...LEGACY_CONNECT_RULE_IDS, ...allRuleIds(ids)];
}

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

  return { proxyHost: host, proxyPort: port, proxyScheme: scheme };
}
