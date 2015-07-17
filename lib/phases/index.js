var fs = require('fs');
var phases = {
  'cold': 'cold-launch',
  'reboot': 'reboot',
  'restart-b2g': 'restart-b2g',
  'first-time': 'first-time-launch'
};

/**
 * Factory to instantiate a phase based on the phase type, e.g. `cold`,
 * `reboot`, `restart-b2g`
 * @param {{
 *   phase: String
 * }} options
 * @returns {Phase}
 * @constructor
 */
module.exports.create = function(options) {
  var phase = phases[options.phase];

  if (phase) {
    phase = './' + phase;
  }

  var Phase = require(phase);

  return new Phase(options);
};

/**
 * Register a customized phase.
 * @param {string} phase the phase name of the customized phase
 * @param {path} path the path to the phase file
 */
module.exports.register = function(phase, path) {
  phases[phase] = path;
};
