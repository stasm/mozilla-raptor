var fs = require('fs');
var path = require('path');
var utils = require('../../utils');

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
  var phasePath = options.phase;

  if (fs.existsSync(path.join(__dirname, phasePath + '.js'))) {
    phasePath = './' + phasePath;
  } else {
    phasePath = utils.toAbsolute(phasePath);
  }

  var Phase = require(phasePath);

  return new Phase(options);
};
