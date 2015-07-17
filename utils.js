var GAIA_ORIGIN = '.gaiamobile.org';

var path = require('path');
var validator = module.exports.validator = require('validator');
var merge = module.exports.merge = require('deepmerge');
var compose = module.exports.compose = require('compose-function');

var toAbsolute = module.exports.toAbsolute = function(fileOrDirectory) {
  if (!fileOrDirectory) {
    return fileOrDirectory;
  }

  if (!path.isAbsolute(fileOrDirectory)) {
    fileOrDirectory = path.join(process.cwd(), fileOrDirectory);
  }

  return fileOrDirectory;
};

var toInt = module.exports.toInt = function(str) {
  return parseInt(str, 10);
};

var fromEnvironment = module.exports.fromEnvironment = function(envName) {
  return function(value) {
    if (process.env[envName]) {
      value = process.env[envName];
    }

    return value;
  };
};

var toFQDN = module.exports.toFQDN = function(appOrigin) {
  if (!validator.isFQDN(appOrigin)) {
    appOrigin += GAIA_ORIGIN;
  }

  return appOrigin;
};

var validate = module.exports.validate = function(option, fn) {
  return function(value) {
    if (!fn(value)) {
      return 'the value for "' + option + '" is not valid';
    }
  }
};

var findTest = module.exports.findTest = function(nameOrPath) {
  try {
    return require.resolve(path.join(__dirname, 'tests', nameOrPath));
  } catch (e) {
    return require.resolve(toAbsolute(nameOrPath));
  }
};
