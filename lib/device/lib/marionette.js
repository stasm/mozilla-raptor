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

var Marionette = function(device) {
  this.device = device;
  this.serial = device.serial;
  this.driver = new MarionetteClient.Drivers.TcpSync({});
};

Marionette.prototype.startSession = function() {
  var marionette = this;
  var driver = this.driver;

  return new Promise(function(resolve, reject) {
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

Marionette.prototype.switchToHomescreen = function() {
  this.client.switchToFrame();
  this.client.switchToFrame(this.client.findElement(VERTICAL_FRAME_SELECTOR));
};

module.exports = function(device) {
  return new Marionette(device);
};


