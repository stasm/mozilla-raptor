var Promise = require('promise');
var MarionetteClient = require('marionette-client');
var debug = require('debug')('raptor:marionette');
var Driver = MarionetteClient.Drivers.TcpSync;
var Client = MarionetteClient.Client;

var plugins = {
  apps: require('marionette-apps'),
  contentScript: require('marionette-content-script'),
  fileManager: require('marionette-file-manager'),
  forms: require('marionette-plugin-forms'),
  helper: require('marionette-helper'),
  settings: require('marionette-settings-api')
};

var promisifyCallback = function(resolve, reject) {
  return function(err) {
    if (err) {
      return reject();
    }

    return resolve();
  };
};

var HOMESCREEN_FRAME_SELECTOR = '#homescreen iframe';

/**
 * Instantiate a Marionette.js TcpSync Driver for marionette clients
 * @param {Device} device Device session to generate marionette driver
 * @constructor
 */
var Marionette = function(device) {
  this.device = device;
  this.serial = device.serial;
  this.host = device.options.marionetteHost;
  this.port = device.options.marionettePort;
  this.timeout = device.options.connectionTimeout;

  var client = this.client = new Client(null, {
    lazy: true
  });

  Object
    .keys(plugins)
    .forEach(function(key) {
      client.plugin(key, plugins[key]);
    });
};

/**
 * Start a Marionette.js client session; promise receives a marionette client
 * @returns {Promise.<MarionetteClient.Client>}
 */
Marionette.prototype.startSession = function() {
  debug('[Creating driver] %s:%d with %dms connection timeout',
    this.host, this.port, this.timeout);

  var client = this.client;
  var driver = this.driver = new Driver({
    host: this.host,
    port: this.port,
    connectionTimeout: this.timeout
  });

  return new Promise(function(resolve, reject) {
    /**
     * 1. Connect the Marionette TcpSync driver
     * 2. Create a marionette client from the driver
     * 3. Attach the plugins to the client
     * 4. Call client.startSession and resolve with client
     */

    var done = function() {
      client.resetWithDriver(driver);
      client.startSession(function() {
        resolve(client);
      });
    };

    driver.connect(promisifyCallback(done, reject));
  });
};

/**
 * Switch to the homescreen iframe
 * Prerequisite: must be in marionette client session
 */
Marionette.prototype.switchToHomescreen = function() {
  this.client.switchToFrame();
  this.client.switchToFrame(this.client.findElement(HOMESCREEN_FRAME_SELECTOR));
};

/**
 * Force platform to perform memory minimization, resolving when finished
 * Prerequisite: must be in marionette client session
 * @returns {Promise}
 */
Marionette.prototype.triggerGC = function() {
  var client = this.client;
  var scriptTimeout = this.device.options.scriptTimeout;

  debug('Triggering memory minimization');

  return new Promise(function(resolve, reject) {
    client.switchToFrame();
    client.setScriptTimeout(scriptTimeout);

    client
      .scope({ context: 'chrome' })
      .executeAsyncScript(function() {
        var Cu = Components.utils;
        var Cc = Components.classes;
        var Ci = Components.interfaces;

        Cu.import('resource://gre/modules/Services.jsm');
        Services.obs.notifyObservers(null, 'child-mmu-request', null);

        var memoryManagerService = Cc['@mozilla.org/memory-reporter-manager;1']
          .getService(Ci.nsIMemoryReporterManager);

        memoryManagerService.minimizeMemoryUsage(marionetteScriptFinished);
      }, promisifyCallback(resolve, reject));
  });
};

/**
 * Remove all performance marks and measures in the current frame
 * @returns {Promise}
 */
Marionette.prototype.clearPerformanceBuffer = function() {
  var client = this.client;

  debug('Clearing performance entries buffer');

  return new Promise(function(resolve) {
    client.executeScript(function() {
      var performance = window.wrappedJSObject.performance;

      performance.clearMarks();
      performance.clearMeasures();
    });

    resolve(client);
  });
};

/**
 * Delete the current Marionette client session, ensuring client & driver state
 * @returns {Promise}
 */
Marionette.prototype.deleteSession = function() {
  var client = this.client;

  if (!client || !this.driver || !this.driver.ready) {
    return Promise.resolve();
  }

  return new Promise(function(resolve, reject) {
    client.deleteSession(promisifyCallback(resolve, reject));
  });
};

module.exports = function(device) {
  return new Marionette(device);
};
