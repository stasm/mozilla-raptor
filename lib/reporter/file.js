var path = require('path');
var fs = require('fs');
var Promise = require('promise');
var ndjson = require('ndjson');
var debug = require('debug')('raptor:reporter');

module.exports = function(options) {
  var destination = options.metrics;
  var stream = fs.createWriteStream(destination, { flags: 'a' });
  var serializer = ndjson.serialize();

  serializer.pipe(stream);

  /**
   * Write time-series data to an LDJSON file
   * @param {object} data
   */
  return function(data) {
    debug('Writing report results to file');
    serializer.write(data);
  };
};
