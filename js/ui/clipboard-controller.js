'use strict';

/**
 * Clipboard UI Controller
 * Handles copy, cut, paste, and related clipboard operations
 */

function copyUi(app, S) {
  copyDomain(app, S);
}

function cutUi(app, S) {
  cutDomain(app, S);
}

function pasteUi(app, S) {
  pasteDomain(app, S);
}

function clearCutUi(app, S) {
  if (clearCutDomain(app, S)) app.toast('Cut cancelled');
}

function dupUi(app, S, id) {
  dupDomain(app, S, id);
}

function copyWithUrlUi(app, S) {
  copyWithUrlDomain(app, S);
}

function copyPermalinkUi(app, S) {
  copyPermalinkDomain(app, S);
}
