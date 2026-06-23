'use strict';

function registerAppReadModel(app, deps) {
  if (typeof registerAppQueries !== 'function') return;

  registerAppQueries(app, {
    state: deps.state,
    walkTasks: deps.walkTasks,
    skipChildren: deps.skipChildren,
    todayS: deps.todayS,
    tomorrowS: deps.tomorrowS,
    cmpDate: deps.cmpDate,
    esc: deps.esc
  });
}
