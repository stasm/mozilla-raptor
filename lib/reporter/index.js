module.exports = function(options) {
  var reportToFile = require('./file')(options);

  if (options.database) {
    var reportToDatabase = require('./database')(options);
  }

  /**
   * Report time-series data to a file and possibly also to a database
   * determined from the configuration
   * @param {object} data
   * @returns {Promise}
   */
  return function(data) {
    var promises = [reportToFile(data)];

    if (options.database) {
      promises.push(reportToDatabase(data));
    }

    return Promise.all(promises);
  };
};
