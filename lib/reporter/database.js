var Promise = require('promise');
var influx = require('influx');
var debug = require('debug')('raptor:reporter');

module.exports = function(options) {
  /**
   * InfluxDB client. This connection is HTTP-based, so it is not persistent.
   */
  var client = influx({
    host: options.host,
    port: options.port,
    username: options.username,
    password: options.password,
    database: options.database,
    timePrecision: 'n'
  });

  debug('[Database Client] Host: %s', options.host);
  debug('[Database Client] Port: %d', options.port);
  debug('[Database Client] Username: %s', options.username);
  debug('[Database Client] Password: %s', options.password);
  debug('[Database Client] Database: %s', options.database);

  /**
   * Write time-series data to an InfluxDB database
   * @param {object} data
   * @returns {Promise}
   */
  return function(data) {
    return new Promise(function(resolve, reject) {
      debug('Writing report results to database');

      client.writeSeries(data, function(err) {
        if (err) {
          return reject(err);
        }

        resolve();
      });
    });
  };
};