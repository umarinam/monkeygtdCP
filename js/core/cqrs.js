'use strict';

function createCommandBus() {
  const handlers = new Map();

  return {
    register(name, handler) {
      handlers.set(name, handler);
    },
    dispatch(name, payload) {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error('No command handler registered for: ' + name);
      }
      return handler(payload);
    }
  };
}

function createQueryService() {
  const resolvers = new Map();

  return {
    register(name, resolver) {
      resolvers.set(name, resolver);
    },
    select(name, payload) {
      const resolver = resolvers.get(name);
      if (!resolver) {
        throw new Error('No query resolver registered for: ' + name);
      }
      return resolver(payload);
    }
  };
}
