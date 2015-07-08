var fs = require('fs');
var path = require('path');
var Promise = require('promise');
var merge = require('deepmerge');
var config = require('../../config.json');
var Command = require('./lib/command');
var modules = {
  helpers: require('./lib/helpers'),
  input: require('./lib/input'),
  log: require('./lib/logging'),
  marionette: require('./lib/marionette')
};
var devices;

// Regular expression for extracting adb property output
var GETPROP_MATCHER = /^\[([\s\S]*?)]: \[([\s\S]*?)]\r?$/gm;

/**
 * API for interacting with devices and environments
 * @param {String} [serial]
 * @constructor
 */
var Device = function(serial, options) {
  this.serial = serial;
  this.options = options;
  this.command = Command(this);

  if (options.config) {
    config = merge(config, require(options.config))
  }

  devices = config.devices;
};

/**
 * Map of properties obtained from `getprop`
 * @type {Object}
 */
Device.prototype.properties = null;

/**
 * Fetch and set the device serial, verifying that the device is connected
 * @returns {Promise}
 */
Device.prototype.setSerialVerified = function() {
  var device = this;
  var serial = device.serial;

  device.serial = null;

  return this.command()
    .adb('devices')
    .exec()
    .then(function(output) {
      var lines = output.split('\n').slice(1, -2);

      if (!lines.length) {
        throw new Error('No devices found');
      }

      lines.some(function(line) {
        var parts = line.split('\t');
        var currentSerial = parts[0];
        var state = parts[1];

        if (!currentSerial.length) {
          throw new Error('Unable to determine serial of connected device');
        }

        if (!serial) {
          device.serial = currentSerial;
          device.state = state;
          return true;
        }

        if (currentSerial === serial) {
          device.serial = serial;
          device.state = state;
          return true;
        }

        return false;
      });

      if (!device.serial || device.state !== 'device') {
        throw new Error('Unable to connect to device');
      }
    });
};

/**
 * Capture the data from `getprop` and assign to Device#properties
 * @returns {Promise}
 */
Device.prototype.setProperties = function() {
  var device = this;
  this.properties = {};

  return this.command()
    .env('ANDROID_SERIAL', this.serial)
    .adbShell('getprop')
    .exec()
    .then(function(output) {
      var value = output.toString();
      var match;

      while (match = GETPROP_MATCHER.exec(value)) {
        device.properties[match[1]] = match[2];
      }
    });
};

/**
 *
 * @param string deviceType Device type, e.g. 'b2g', 'android'
 * @param string model Device model to pull configuration data for
 * @returns {object}
 */
Device.prototype.findConfiguration = function(deviceType, model) {
  var key;

  model = model.toUpperCase();

  Object
    .keys(devices[deviceType])
    .some(function(device) {
      var isMatch = device.toUpperCase() === model;

      if (isMatch) {
        key = device;
        return true;
      }

      return false;
    });

  return devices[deviceType][key];
};

/**
 * Set device-specific configuration data based on the model of the device
 */
Device.prototype.setConfiguration = function() {
  var model = this.properties['ro.product.model'];

  this.config = this.findConfiguration('b2g', model) ||
    this.findConfiguration('android', model);
  this.pixelRatio = this
    .properties[this.config.densityProperty || 'ro.sf.lcd_density'] / 160;
  this.touchFrequency = this.config.touchFrequency || 10;
};

Device.prototype.createModules = function() {
  var device = this;

  Object
    .keys(modules)
    .forEach(function(key) {
      var lib = modules[key];
      device[key] = lib(device);
    });

  return Promise.resolve(device);
};

Device.prototype.installBinary = function() {
  return this.input.installBinary();
};

Device.prototype.setGaiaRevision = function() {
  var device = this;

  return this.helpers
    .getGaiaRevision()
    .then(function(sha) {
      device.gaiaRevision = sha;
    });
};

Device.prototype.setGeckoRevision = function() {
  var device = this;

  return this.helpers
    .getGeckoRevision()
    .then(function(sha) {
      device.geckoRevision = sha;
    });
};

/**
 * Instantiate a Device API:
 * 1. Verify and set the serial for the device
 * 2. Fetch the device properties and set common values
 * 3. Set up device APIs and prepare for input
 * 4. Pre-fetch the Gecko and Gaia revisions
 * @param {String} [serial]
 * @returns {Promise}
 */
Device.create = function(serial, options) {
  var device = new Device(serial, options);

  return device
    .setSerialVerified()
    .then(device.setProperties.bind(device))
    .then(device.setConfiguration.bind(device))
    .then(device.createModules.bind(device))
    .then(device.installBinary.bind(device))
    .then(device.setGaiaRevision.bind(device))
    .then(device.setGeckoRevision.bind(device))
    .then(function() {
      return device;
    });
};

/**
 * Instantiate a Device API
 * @param {String} [serial]
 * @returns {Promise}
 */
module.exports = function(serial, options) {
  return Device
    .create(serial, options)
    .then(function(device) {
      process.on('exit', function() {
        // Failsafe to ensure that if the process is force-killed that any
        // logging process still around is not left hanging
        device.log.stop();
      });

      return device;
    });
};
