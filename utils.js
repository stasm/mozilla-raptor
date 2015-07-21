var GAIA_ORIGIN = '.gaiamobile.org';

var path = require('path');
var fs = require('fs');
var Promise = require('promise');
var newline = require('os').EOL;
var validator = module.exports.validator = require('validator');

/**
 * Recursive merge of properties from one object to another
 * @returns {object}
 */
var merge = module.exports.merge = require('deepmerge');

/**
 * Return a function which successively consumes the output of the previous
 * invocation. Evaluates arguments from right to left
 * @returns {Function}
 */
var compose = module.exports.compose = require('compose-function');

/**
 * Ensure a file or directory is in absolute form
 * @param fileOrDirectory file or directory to ensure is absolute
 * @returns {string|*}
 */
var toAbsolute = module.exports.toAbsolute = function(fileOrDirectory) {
  if (!fileOrDirectory) {
    return fileOrDirectory;
  }

  if (!path.isAbsolute(fileOrDirectory)) {
    fileOrDirectory = path.join(process.cwd(), fileOrDirectory);
  }

  return fileOrDirectory;
};

/**
 * Convert a string to a number
 * @param {string}
 * @returns {number}
 */
var toInt = module.exports.toInt = function(str) {
  return parseInt(str, 10);
};

/**
 * Factory function to capture a given environment variable
 * @param {string} envName
 * @returns {Function}
 */
var fromEnvironment = module.exports.fromEnvironment = function(envName) {
  // If envName exists in the environment, return that value instead of the one
  // provided to the function
  return function(value) {
    if (process.env[envName]) {
      value = process.env[envName];
    }

    return value;
  };
};

/**
 * Convert non-FQDNs to <appOrigin>.gaiamobile.org format, or leave FQDN as-is
 * @param appOrigin app name or FQDN to ensure format compliance
 * @returns {string}
 */
var toFQDN = module.exports.toFQDN = function(appOrigin) {
  if (!validator.isFQDN(appOrigin)) {
    appOrigin += GAIA_ORIGIN;
  }

  return appOrigin;
};

/**
 * Factory function to determine whether a particular option is validated by a
 * given function
 * @param {string} option name of the options to ensure validity
 * @param {Function} fn function used to test later-supplied value for validity
 * @returns {Function}
 */
var validate = module.exports.validate = function(option, fn) {
  // Run the supplied value through the `fn` function and determine validity
  return function(value) {
    if (!fn(value)) {
      return 'the value for "' + option + '" is not valid';
    }
  }
};

/**
 * for a given test name or filepath, resolve it to a particular test file
 * location
 * @param {string} nameOrPath test name or file path to resolve
 * @returns {string}
 */
var findTest = module.exports.findTest = function(nameOrPath) {
  try {
    return require.resolve(path.join(__dirname, 'tests', nameOrPath));
  } catch (e) {
    return require.resolve(toAbsolute(nameOrPath));
  }
};

/**
 *
 * @param {string} log path to newline-separated JSON log file
 * @returns {Promise}
 */
var readLog = module.exports.readLog = function(log) {
  return new Promise(function(resolve, reject) {
    fs.readFile(log, { encoding: 'utf8' }, function(err, contents) {
      if (err) {
        return reject(err);
      }

      var data = [];

      contents
        .split(newline)
        .forEach(function(line) {
          if (!line) {
            return;
          }

          data.push(JSON.parse(line));
        });

      resolve(data);
    });
  });
};
