var Promise = require('promise');
var influent = require('influent');
var debug = require('debug')('raptor:reporter');

module.exports = function(options) {
  /**
   * InfluxDB client. This connection is HTTP-based, so it is not persistent.
   */
  var createClient = influent
    .createClient({
      precision: 'n',
      username: options.username,
      password: options.password,
      database: options.database,
      max_batch: options.batch,
      server: {
        protocol: options.protocol,
        host: options.host,
        port: options.port
      }
    })
    .then(function(client) {
      debug('[Database Client] Host: %s', options.host);
      debug('[Database Client] Port: %d', options.port);
      debug('[Database Client] Username: %s', options.username);
      debug('[Database Client] Password: %s', options.password);
      debug('[Database Client] Database: %s', options.database);

      return client;
    });

  /**
   * Write time-series data to an InfluxDB database
   * @param {object} data
   * @returns {Promise}
   */
  return function(data) {
    debug('Writing report results to database');

    return createClient
      .then(function(client) {
        return client.writeMany(data);
      })
      .catch(function(err) {
        debug('Error:', err);
        throw err;
      });
  };
};