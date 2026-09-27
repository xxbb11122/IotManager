const DEFAULT_ROUTE = { screen: 'devices', entityId: null, scopeKey: '' };

function normalizeRoute(route = DEFAULT_ROUTE) {
  route = route && typeof route === 'object' ? route : DEFAULT_ROUTE;
  return {
    screen: String(route.screen || 'devices'),
    entityId: route.entityId == null ? null : String(route.entityId),
    scopeKey: String(route.scopeKey ?? '')
  };
}

export function navigationRouteKey(route) {
  const normalized = normalizeRoute(route);
  return JSON.stringify([normalized.scopeKey, normalized.screen, normalized.entityId]);
}

function copyPosition(position = {}) {
  position = position && typeof position === 'object' ? position : {};
  const scrollY = Number(position.scrollY);
  return {
    scrollY: Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0,
    focus: position.focus && typeof position.focus === 'object' ? { ...position.focus } : position.focus ?? null
  };
}

/** Source-aware navigation. Platform history integration remains an UI concern. */
export function createNavigationState(initialRoute = DEFAULT_ROUTE) {
  let current = normalizeRoute(initialRoute);
  let stack = [];
  const positions = new Map();

  function outcome(kind, changed) {
    return {
      route: { ...current }, kind: changed ? kind : null, changed,
      position: copyPosition(positions.get(navigationRouteKey(current))),
      canGoBack: stack.length > 0
    };
  }

  return {
    get current() { return { ...current }; },
    get canGoBack() { return stack.length > 0; },
    savePosition(position) {
      positions.set(navigationRouteKey(current), copyPosition(position));
    },
    navigate(route, { kind = 'push' } = {}) {
      const next = normalizeRoute(route);
      if (next.scopeKey !== current.scopeKey) kind = 'context-replace';
      if (navigationRouteKey(next) === navigationRouteKey(current)) return outcome(null, false);
      if (!['push', 'peer', 'replace', 'context-replace'].includes(kind)) throw new TypeError(`Unknown navigation kind: ${kind}`);
      if (kind === 'context-replace') {
        stack = [];
        positions.clear();
      } else if (kind === 'peer') {
        stack = [];
      } else if (kind === 'push') {
        stack.push(current);
      }
      current = next;
      return outcome(kind, true);
    },
    back(fallback = null) {
      const next = stack.pop() ?? (fallback ? normalizeRoute(fallback) : null);
      if (!next) return outcome(null, false);
      if (next.scopeKey !== current.scopeKey) {
        stack = [];
        positions.clear();
      }
      const changed = navigationRouteKey(next) !== navigationRouteKey(current);
      current = next;
      return outcome('back', changed);
    },
    snapshot() {
      return {
        version: 1, current: { ...current }, stack: stack.map(route => ({ ...route })),
        positions: [...positions].map(([key, position]) => [key, copyPosition(position)])
      };
    },
    restore(snapshot) {
      if (snapshot?.version !== 1 || typeof snapshot.current?.screen !== 'string'
        || !Array.isArray(snapshot.stack) || !Array.isArray(snapshot.positions)) return null;
      const next = normalizeRoute(snapshot.current);
      // A browser Back entry must never revive data from another identity scope.
      if (next.scopeKey !== current.scopeKey) return null;
      const changed = navigationRouteKey(next) !== navigationRouteKey(current);
      const nextStack = snapshot.stack.filter(route => route && typeof route.screen === 'string')
        .map(normalizeRoute).filter(route => route.scopeKey === next.scopeKey);
      const nextPositions = snapshot.positions.filter(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string');
      current = next;
      stack = nextStack;
      for (const [key, position] of nextPositions) {
        // Live positions are newer than the copy stored in browser history.
        if (!positions.has(key)) positions.set(key, copyPosition(position));
      }
      return outcome('back', changed);
    }
  };
}
