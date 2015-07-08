var Phase = require('./phase');
var util = require('util');
var path = require('path');
var Promise = require('promise');

//var homescreenConfig = require('../../dist/homescreens.json');
var debug = require('debug')('raptor:coldlaunch');

// These are derived from GAIA/shared/elements/gaia_grid/js/grid_layout.js
//var GAIA_MIN_ICONS_PER_ROW = 3;
//var GAIA_MIN_ROW_HEIGHT_FACTOR = 3.8;
//var GAIA_MAX_ROW_HEIGHT_FACTOR = 5;
//var GAIA_MIN_ICON_DISTANCE = 36;
//var GAIA_MAX_ICON_DISTANCE = 38;
//var VERTICAL_CONTEXT = 'verticalhome.gaiamobile.org';

/**
 * Create a suite phase which achieves a ready state when an application is
 * cold-launched, e.g. from a new process
 * @param {{
 *   appPath: String,
 *   runs: Number,
 *   timeout: Number,
 *   retries: Number
 * }} options
 * @constructor
 */
var ColdLaunch = function(options) {
  this.title = 'Cold Launch: ' + options.app;

  Phase.call(this, options);

  var phase = this;

  /**
   * To prepare for a test run we need to:
   * 1. Clear the ADB log
   * 2. Restart B2G
   * 3. Pre-fetch the application's coordinates
   * 4. Wait for the Homescreen to load so we know when to be able to launch
   * 5. Reset kernel cached values so following input events won't be ignored
   */

  this.getDevice()
    .then(function() {
      return phase.device.log.clear();
    })
    .then(function() {
      return phase.device.helpers.restartB2G();
    })
    .then(function() {
      return phase.waitForHomescreen();
    })
    //.then(function() {
    //  return phase.setCoordinates();
    //})
    .then(function() {
      return phase.prime();
    })
    .then(function() {
      return phase.start();
    });
};

ColdLaunch.prototype.title = 'Cold Launch';

util.inherits(ColdLaunch, Phase);

//ColdLaunch.prototype.setCoordinates = function() {
//  var phase = this;
//
//  return new Promise(function(resolve, reject) {
//    var marionette = phase.device.marionette;
//
//    marionette
//      .startSession()
//      .then(function(client) {
//        marionette.switchToHomescreen();
//
//        var icons = client.executeScript(function() {
//          var icons = window.wrappedJSObject.document
//            .querySelectorAll('#icons > .icon');
//
//          return Array.prototype.map.call(icons, function(icon) {
//            var rect = icon.getBoundingClientRect();
//
//            return {
//              x: rect.x + rect.width / 2,
//              y: rect.y + rect.height / 2,
//              origin: icon.getAttribute('data-identifier')
//            };
//          });
//        });
//
//        client.deleteSession();
//
//        icons.some(function(icon) {
//          var origin = icon.origin;
//
//          /**
//           * If the origin contains app specified, check if an entry point is
//           * also specified. If the origin also contains the entry point, or if
//           * there is no entry point set, capture the icon as the target.
//
//           * If the origin doesn't contain the app or if it does but the entry
//           * point doesn't match, then skip and move on
//           */
//          if (origin.indexOf(phase.options.app) !== -1) {
//            if (phase.options.entryPoint) {
//              if (origin.indexOf(phase.options.entryPoint) !== -1) {
//                phase.appX = icon.x;
//                phase.appY = icon.y;
//                return true;
//              }
//
//              return false;
//            } else {
//              phase.appX = icon.x;
//              phase.appY = icon.y;
//              return true;
//            }
//          }
//
//          return false;
//        });
//
//        debug('App %s coordinates at (%d, %d)',
//          phase.options.app, phase.appX, phase.appY);
//        resolve();
//      });
//  });
//};

///**
// * Set the coordinates of the Homescreen location for the application to launch.
// * This will translate the coordinates to device pixels.
// */
//ColdLaunch.prototype.setCoordinates = function() {
//  var appIndex = this.appIndex;
//  var columns = homescreenConfig.preferences['grid.cols'];
//
//  // The dimensions we receive from device.config are already the result
//  // of an applied device pixel ratio. Therefore any calculations involving this
//  // deviceWidth SHOULD NOT also use devicePixelRatio.
//  var deviceWidth = this.device.config.dimensions[0];
//  var devicePixelRatio = this.device.pixelRatio;
//
//  var gridOrigin = this.GRID_ORIGIN_Y * devicePixelRatio;
//  var columnWidth = deviceWidth / columns;
//  var iconDistance = (columns === GAIA_MIN_ICONS_PER_ROW ?
//    GAIA_MIN_ICON_DISTANCE : GAIA_MAX_ICON_DISTANCE) * devicePixelRatio;
//  var rowHeightFactor = columns === GAIA_MIN_ICONS_PER_ROW ?
//    GAIA_MIN_ROW_HEIGHT_FACTOR : GAIA_MAX_ROW_HEIGHT_FACTOR;
//  var rowHeight = deviceWidth / rowHeightFactor;
//  var ordinalX = columnWidth / 2;
//  var ordinalY = gridOrigin + rowHeight / 2;
//  var row = Math.floor(appIndex / columns);
//  var column = appIndex % columns;
//
//  this.appX = ordinalX + columnWidth * column;
//  this.appY = ordinalY + (iconDistance + rowHeight) * row;
//};

///**
// * Trigger the launch of an application by tapping at its coordinates on the
// * Homescreen.
// * @returns {Promise}
// */
//ColdLaunch.prototype.launch = function() {
//  return this.device.input.tap(this.appX, this.appY, 1);
//};

///**
// * From a given <appPath> generate any necessary manifest metadata, e.g.
// * entry point, application name, and other manifest data
// * @param appPath
// */
//ColdLaunch.prototype.setApplicationMetadata = function(appPath, entryPoint) {
//  var parts = appPath.split('/');
//
//  this.manifestPath = parts[0];
//  this.entryPoint = parts[1] || '';
//  this.appIndex = null;
//  this.appGaiaPath = null;
//  var phase = this;
//
//  // Walk through the config apps until we find one matching the current app
//  homescreenConfig.homescreens[0]
//    .every(function(app, index) {
//      if (runner.manifestPath === app[1]) {
//        if (runner.entryPoint) {
//          if (runner.entryPoint === app[2]) {
//            phase.appIndex = index;
//            phase.appGaiaPath = app[0];
//            return false;
//          }
//        } else {
//          phase.appIndex = index;
//          phase.appGaiaPath = app[0];
//          return false;
//        }
//      }
//      return true;
//    });
//
//  if (runner.appIndex === null) {
//    return this.emit('error',
//      new Error('Unable to find specified application on Homescreen'));
//  }
//
//  this.manifestURL = this.manifestPath + '.gaiamobile.org';
//  this.manifest = this.requireManifest(path.join(
//    process.cwd(), this.appGaiaPath, this.manifestPath, 'manifest.webapp'));
//  this.appName = this.entryPoint ?
//    this.manifest.entry_points[this.entryPoint].name :
//    this.manifest.name;
//  this.options.title = 'Cold Launch: ' + this.appName;
//};

ColdLaunch.prototype.captureEntryMetadata = function(entry) {
  //entry.appName = this.appName;

  if (!this.appPid && entry.pid !== this.homescreenPid) {
    debug('Capturing application PID: %d', entry.pid);
    this.appPid = entry.pid;
  }
};

ColdLaunch.prototype.launch = function() {
  var phase = this;
  var marionette = phase.device.marionette;

  var selector = '#icons > .icon[data-identifier*="' + phase.options.app + '"]';

  if (phase.options.entryPoint) {
    selector += '[data-identifier*="' + phase.options.entryPoint + '"]';
  }

  // Delay launch to give time for pre-allocated process and system cool-down
  setTimeout(function() {
    marionette
      .startSession()
      .then(function(client) {
        marionette.switchToHomescreen();

        client
          .findElement(selector)
          .tap(20, 20);

        client.deleteSession();

        resolve();
      });
  }, phase.options.launchDelay);

  return this.waitForMark('fullyLoaded', this.options.app);
};

/**
 * Prime application for cold-launch by starting the application and closing it,
 * causing it to do any introductory operations e.g. DB, IO, etc.
 * @returns {Promise}
 */
ColdLaunch.prototype.prime = function() {
  var phase = this;

  this.log('Priming application');

  return this
    .launch()
    .then(function(entry) {
      phase.captureEntryMetadata(entry);
      return phase.closeApp();
    });
};

/**
 * Stand up an application cold launch for each individual test run. Will denote
 * the run has completed its work when the application is fully loaded and its
 * memory captured
 * @returns {Promise}
 */
ColdLaunch.prototype.testRun = function() {
  var phase = this;

  phase
    .launch()
    .then(function(entry) {
      phase.captureEntryMetadata(entry);
      phase.device.log.memory(phase.appPid, entry.context);
    });

  return this.waitForMemory(this.options.app);
};

/**
 * Close the currently launched application if one is opened
 * @returns {Promise}
 */
ColdLaunch.prototype.closeApp = function() {
  if (!this.appPid) {
    return Promise.resolve(null);
  }

  var phase = this;

  return this.device.helpers
    .kill(this.appPid)
    .then(function() {
      phase.appPid = null;
    });
};

/**
 * Retry handler which is invoked if a test run fails to complete. Do a input
 * reset to clear kernel cached values.
 * @returns {Promise}
 */
ColdLaunch.prototype.retry = function() {
  return this.closeApp();
};

/**
 * Report the results for an individual test run
 * @returns {Promise}
 */
ColdLaunch.prototype.handleRun = function() {
  var app = this.options.app;

  var results = this.format(this.results.filter(function(entry) {
    return entry.context === app;
  }), 'coldlaunch', 'appLaunch');

  return this.report(results);
};

module.exports = ColdLaunch;
