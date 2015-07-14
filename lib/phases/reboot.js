var Phase = require('./phase');
var Dispatcher = require('../dispatcher');
var Promise = require('promise');
var util = require('util');
var performanceParser = require('../parsers/performance');
var memoryParser = require('../parsers/memory');

/**
 * Create a phase which achieves a ready state when the device has been rebooted
 * @param {{
 *   runs: Number,
 *   timeout: Number,
 *   retries: Number
 * }} options
 * @constructor
 */
var Reboot = function(options) {
  // The connection to the dispatcher is ADB-based, so rebooting the device will
  // kill the ADB stream. Prevent the base phase from instantiating it so we
  // can control the dispatcher lifecycle
  options.preventDispatching = true;

  Phase.call(this, options);
  this.start();
};

util.inherits(Reboot, Phase);

Reboot.prototype.title = 'Reboot';
Reboot.prototype.homescreenFullyLoaded = false;
Reboot.prototype.systemFullyLoaded = false;
Reboot.prototype.START_MARK = 'deviceReboot';
Reboot.prototype.SUITE = 'reboot';

/**
 * Manually instantiate a Dispatcher and listen for performance entries
 */
Reboot.prototype.setup = function() {
  this.device.log.restart();
  this.dispatcher = new Dispatcher(this.device);
  this.registerParser(performanceParser);
  this.registerParser(memoryParser);
  this.capture();
};

/**
 * Perform a device reboot
 * @returns {Promise}
 */
Reboot.prototype.reboot = function() {
  var phase = this;

  this.homescreenFullyLoaded = false;
  this.systemFullyLoaded = false;
  this.homescreenPid = null;
  this.systemPid = null;

  return this.getDevice()
    .then(function() {
      return phase.device.log.clear();
    })
    .then(function() {
      phase._start = Date.now();
      return phase._restart();
    })
    .then(function(time) {
      return phase.device.log.mark(phase.START_MARK, time);
    });
};

Reboot.prototype._restart = function() {
  return this.device.helpers.reboot();
};

Reboot.prototype.capture = function() {
  var phase = this;

  this.dispatcher.on(Phase.PERFORMANCEENTRY, function(entry) {
    var name = entry.name;
    var ignore = phase.homescreenFullyLoaded &&
        phase.systemFullyLoaded &&
        entry.entryType === 'mark';

    // Due to a bug in a device's ability to keep consistent time after
    // a reboot, we are currently overriding the time of entries. Not
    // very accurate, but it's better than nothing. :/
    entry.epoch = name === phase.START_MARK ? phase._start : Date.now();

    phase.debugEventEntry(Phase.PERFORMANCEENTRY, entry);

    if (ignore) {
      return;
    }

    if (name === 'fullyLoaded' && entry.context === Phase.VERTICAL_CONTEXT) {
      phase.homescreenFullyLoaded = true;
    }

    if (name === 'fullyLoaded' && entry.context === Phase.SYSTEM_CONTEXT) {
      phase.systemFullyLoaded = true;
    }

    phase.results.push(entry);
  });

  this.dispatcher.on(Phase.MEMORYENTRY, function(entry) {
    phase.debugEventEntry(Phase.MEMORYENTRY, entry);
    phase.results.push(entry);
  });
};


/**
 * Stand up a device reboot for each individual test run. Will denote the run
 * has completed its work when the System marks the end of the logo screen.
 * @returns {Promise}
 */
Reboot.prototype.testRun = function() {
  var phase = this;

  return this
    .reboot()
    .then(function() {
      return phase.setup();
    })
    .then(function() {
      return phase.waitForB2GStart();
    })
    .then(function() {
      var promises = Promise.all([
        phase.waitForMemory(Phase.VERTICAL_CONTEXT),
        phase.waitForMemory(Phase.SYSTEM_CONTEXT)
      ]);

      phase.device.log.memory(phase.systemPid, Phase.SYSTEM_CONTEXT);
      phase.device.log.memory(phase.homescreenPid, Phase.VERTICAL_CONTEXT);

      return promises;
    });
};

/**
 * Retry handler which is invoked if a test run fails to complete. Currently
 * does nothing to handle a retry.
 * @returns {Promise}
 */
Reboot.prototype.retry = Phase.NOOP;

/**
 * Report the results for an individual test run
 * @returns {Promise}
 */
Reboot.prototype.handleRun = function() {
  return this.report(this.format(this.results, this.SUITE, this.START_MARK));
};

module.exports = Reboot;
