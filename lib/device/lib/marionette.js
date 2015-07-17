var Promise = require('promise');
var MarionetteClient = require('marionette-client');
var debug = require('debug')('raptor:marionette');

var plugins = {
  apps: require('marionette-apps'),
  contentScript: require('marionette-content-script'),
  fileManager: require('marionette-file-manager'),
  forms: require('marionette-plugin-forms'),
  helper: require('marionette-helper'),
  settings: require('marionette-settings-api')
};

var VERTICAL_FRAME_SELECTOR = '#homescreen iframe';

/**
 * Instantiate a Marionette.js TcpSync Driver for marionette clients
 * @param {Device} device Device session to generate marionette driver
 * @constructor
 */
var Marionette = function(device) {
  this.device = device;
  this.serial = device.serial;
  this.driver = new MarionetteClient.Drivers.TcpSync({
    host: device.options.marionetteHost,
    port: device.options.marionettePort
  });
};

/**
 * Start a Marionette.js client session; promise receives a marionette client
 * @returns {Promise.<MarionetteClient.Client>}
 */
Marionette.prototype.startSession = function() {
  var marionette = this;
  var driver = this.driver;

  return new Promise(function(resolve, reject) {
    /**
     * 1. Connect the Marionette TcpSync driver
     * 2. Create a marionette client from the driver
     * 3. Attach the plugins to the client
     * 4. Call client.startSession and resolve with client
     */

    driver.connect(function(err) {
      if (err) {
        return reject(err);
      }

      var client = marionette.client = new MarionetteClient.Client(driver);

      Object
        .keys(plugins)
        .forEach(function(key) {
          client.plugin(key, plugins[key]);
        });

      client.startSession(function() {
        resolve(client);
      });
    });
  });
};

/**
 * Switch to the verticalhome frame
 * Prerequisite: must be in marionette client session
 */
Marionette.prototype.switchToHomescreen = function() {
  this.client.switchToFrame();
  this.client.switchToFrame(this.client.findElement(VERTICAL_FRAME_SELECTOR));
};

/**
 * Force platform to perform memory minimization, resolving when finished
 * Prerequisite: must be in marionette client session
 * @returns {Promise}
 */
Marionette.prototype.triggerGC = function() {
  var client = this.client;

  debug('Triggering memory minimization');

  return new Promise(function(resolve) {
    client.switchToFrame();

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
      });

    resolve();
  });
};

module.exports = function(device) {
  return new Marionette(device);
};
