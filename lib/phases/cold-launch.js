var Phase = require('./phase');
var util = require('util');
var path = require('path');
var Promise = require('promise');
var debug = require('debug')('raptor:coldlaunch');

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
  if (!options.app) {
    throw new Error('--app is required for cold-launch phase');
  }

  this.title = 'Cold Launch: ' + options.app;

  Phase.call(this, options);

  var phase = this;

  /**
   * To prepare for a test run we need to:
   * 1. Clear the ADB log
   * 2. Restart B2G
   * 3. Wait for the Homescreen to load so we know when to be able to launch
   * 4. Prime the application to remove initial outlier
   * 5. Register to capture performance entries
   * 6. Start runs
   */

  this.getDevice()
    .then(function() {
      return phase.device.log.clear();
    })
    .then(function() {
      return phase.device.helpers.restartB2G();
    })
    .then(function() {
      return phase.waitForB2GStart();
    })
    .then(function() {
      return phase.prime();
    })
    .then(function() {
      return phase.capture();
    })
    .then(function() {
      return phase.start();
    });
};

util.inherits(ColdLaunch, Phase);

ColdLaunch.prototype.title = 'Cold Launch';
ColdLaunch.prototype.START_MARK = 'appLaunch';

/**
 * Create event listeners for performance and memory entries which determine
 * whether we store the entry as pertinent to the test run
 */
ColdLaunch.prototype.capture = function() {
  var phase = this;
  this.fullyLoaded = false;

  /**
   * Captured performance entries:
   * 1. performance.measures belonging to the tested app
   * 2. performance.mark for appLaunch
   * 3. performance.marks that occur at or before fullyLoaded as these are
   *    de facto performance.measures
   */
  this.dispatcher.on(Phase.PERFORMANCEENTRY, function(entry) {
    phase.debugEventEntry(Phase.PERFORMANCEENTRY, entry);

    var ignore = phase.fullyLoaded &&
        entry.entryType === 'mark' &&
        entry.name !== phase.START_MARK;

    if (ignore) {
      return;
    }

    if (entry.name === 'fullyLoaded') {
      phase.fullyLoaded = true;
    }

    if (entry.context === phase.options.app) {
      phase.setEntryAppName(entry);
      phase.results.push(entry);
    }
  });

  /**
   * Captured memory entries:
   * All matching the tested app
   */
  this.dispatcher.on(Phase.MEMORYENTRY, function(entry) {
    phase.debugEventEntry(Phase.MEMORYENTRY, entry);

    if (entry.context === phase.options.app) {
      phase.setEntryAppName(entry);
      phase.results.push(entry);
    }
  });
};

/**
 * Cache the PID of an application based on performance entry metadata
 * @param entry
 */
ColdLaunch.prototype.captureEntryMetadata = function(entry) {
  if (!this.appPid && entry.pid !== this.homescreenPid) {
    debug('Capturing application PID: %d', entry.pid);
    this.appPid = entry.pid;
  }
};

/**
 * Launch the application and resolve when it has fullyLoaded
 * @returns {Promise}
 */
ColdLaunch.prototype.launch = function() {
  var phase = this;
  var marionette = phase.device.marionette;

  var selector = '#icons > .icon[data-identifier*="' + phase.options.app + '"]';

  if (phase.options.entryPoint) {
    selector += '[data-identifier*="' + phase.options.entryPoint + '"]';
  }

  if (phase.options.launchDelay) {
    debug('Pausing before launching application');
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

  return this.waitForPerformanceEntry('fullyLoaded', this.options.app);
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
      phase.fullyLoaded = true;
      phase.captureEntryMetadata(entry);

      if (phase.options.memoryDelay) {
        debug('Pausing before capturing memory');
      }

      setTimeout(function() {
        phase.device.log.memory(phase.appPid, entry.context);
      }, phase.options.memoryDelay);
    });

  return this.waitForMemory(this.options.app);
};

/**
 * Close the currently launched application if it is open
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
 * Retry handler which is invoked if a test run fails to complete. For cold
 * launch, delete any outstanding Marionette session and close the app
 * @returns {Promise}
 */
ColdLaunch.prototype.retry = function() {
  if (this.device.marionette.client) {
    this.device.marionette.client.deleteSession();
  }

  return this.closeApp();
};

/**
 * Report the results for an individual test run
 * @returns {Promise}
 */
ColdLaunch.prototype.handleRun = function() {
  this.fullyLoaded = false;
  return this.report(this.format(this.results, 'coldlaunch', this.START_MARK));
};

module.exports = ColdLaunch;
