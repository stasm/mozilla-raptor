var EventEmitter = require('events').EventEmitter;
var Promise = require('promise');
var util = require('util');
var merge = require('../../utils').merge;
var Dispatcher = require('../dispatcher');
var performanceParser = require('../parsers/performance');
var memoryParser = require('../parsers/memory');
var Device = require('../device');
var reporter = require('../reporter');
var stats = require('stats-lite');
var Table = require('markdown-table');
var debug = require('debug')('raptor:phase');

/**
 * Base phase. Functionality which is common to all phases should be
 * accessible here
 * @param {{
 *   runs: Number,
 *   timeout: Number,
 *   retries: Number,
 *   preventDispatching: Boolean
 * }} options
 * @constructor
 */
var Phase = function(options) {
  EventEmitter.call(this);

  this.runs = [];
  this.results = [];
  this.formattedRuns = [];
  this.options = options;
  this.time = this.options.time;
  this._report = reporter(options);

  this.log('Preparing to start testing...');
  this.resetTimeout();
};

util.inherits(Phase, EventEmitter);

Phase.prototype.homescreenFullyLoaded = false;
Phase.prototype.systemFullyLoaded = false;

Phase.PERFORMANCEENTRY = 'performanceentry';
Phase.MEMORYENTRY = 'memoryentry';
Phase.VERTICAL_CONTEXT = 'verticalhome.gaiamobile.org';
Phase.SYSTEM_CONTEXT = 'system.gaiamobile.org';
Phase.TAG_IDENTIFIER = 'persist.raptor.';
Phase.PERFORMANCE_BUFFER_SAFETY = 50;
Phase.ICON_TAP_OFFSET = 20;
Phase.APP_NAMES = {
  'calendar.gaiamobile.org': 'Calendar',
  'camera.gaiamobile.org': 'Camera',
  'clock.gaiamobile.org': 'Clock',
  'contacts': 'Contacts',
  'email.gaiamobile.org': 'E-Mail',
  'fm.gaiamobile.org': 'FM Radio',
  'gallery.gaiamobile.org': 'Gallery',
  'sms.gaiamobile.org': 'Messages',
  'music.gaiamobile.org': 'Music',
  'dialer': 'Dialer',
  'settings.gaiamobile.org': 'Settings',
  'system.gaiamobile.org': 'System',
  'verticalhome.gaiamobile.org': 'Homescreen',
  'video.gaiamobile.org': 'Video',
  'test-startup-limit.gaiamobile.org': 'Test Startup Limit'
};
Phase.NOOP = function() {};

/**
 * Determine the name of well-known applications based on a performance entry
 * context
 * @param entry
 */
Phase.prototype.setEntryAppName = function(entry) {
  var entryPoint = this.options.entryPoint;

  if (entryPoint && entryPoint in Phase.APP_NAMES) {
    entry.appName = Phase.APP_NAMES[entryPoint];
  } else if (entry.context in Phase.APP_NAMES) {
    entry.appName = Phase.APP_NAMES[entry.context];
  } else {
    entry.appName = entry.context;
  }
};

/**
 * Send phase-formatted message(s) to the console. Takes same arguments as
 * console.log
 */
Phase.prototype.log = function() {
  if (this.options.output === 'quiet') {
    return;
  }

  var args = Array.prototype.slice.call(arguments);

  args.splice(1, 0, this.title);
  args[0] = '[%s] ' + arguments[0];

  console.log.apply(console, args);
};

/**
 * Emit an error if a test run times out
 */
Phase.prototype.timeoutError = function() {
  this.emit('error', new Error('Test timeout exceeded ' +
    this.options.timeout + 'ms'));
};

/**
 * Halt handling of a test run timeout
 */
Phase.prototype.stopTimeout = function() {
  if (this.timeout) {
    clearTimeout(this.timeout);
  }
};

/**
 * Restart the timeout timer and optionally specify a function to run on timeout
 * @param {function} [handler]
 */
Phase.prototype.resetTimeout = function(handler) {
  var phase = this;

  this.stopTimeout();
  this.timeout = setTimeout(handler || function() {
    phase.timeoutError();
  }, this.options.timeout);
};

/**
 * Register a parser to be able to handle incoming log messages
 * @param {function} parser
 */
Phase.prototype.registerParser = function(parser) {
  this.dispatcher.registerParser(parser);
};

/**
 * Report time-series data
 * @param {object} data
 * @returns {Promise}
 */
Phase.prototype.report = function(data) {
  var phase = this;

  return this
    ._report(data)
    .then(function() {
      phase.canReport = true;
    });
};

/**
 * Resolve when a device is ready for user interaction, e.g. tapping, swiping
 * @returns {Promise}
 */
Phase.prototype.getDevice = function() {
  var phase = this;

  if (this.device) {
    return Promise.resolve(this.device);
  }

  return Device(this.options.serial, this.options)
    .then(function(device) {
      phase.device = device;

      // Allow specific phases to handle their own Dispatcher set up
      if (phase.options.preventDispatching) {
        return device;
      }

      phase.dispatcher = new Dispatcher(device);
      device.log.start();
      phase.registerParser(performanceParser);
      phase.registerParser(memoryParser);

      return device
        .adbForward()
        .then(function() {
          return device;
        });
    })
    .catch(function(err) {
      phase.emit('error', err);
    });
};

/**
 * Attempt to perform a test run
 * @returns {Promise}
 */
Phase.prototype.tryRun = function() {
  var phase = this;

  return new Promise(function(resolve, reject) {
    phase.resetTimeout(function() {
      reject(new Error('timeout'));
    });

    phase
      .testRun()
      .then(resolve)
      .catch(reject);
  });
};

/**
 * Before the next test run, reset the state of the phase and determine next
 * course of action, whether that be ending the test or starting the next run.
 * Resolves with function to handle continuation
 * @returns {Promise}
 */
Phase.prototype.beforeNext = function() {
  var phase = this;

  this.stopTimeout();
  this.log('Run %d complete', this.currentRun);
  this.runs.push(this.results);

  if (this.currentRun < this.options.runs) {
    // If we have more runs to do, notify the tester that the current run has
    // completed and pass a function which will start the next run...
    this.currentRun++;

    return Promise.resolve(function() {
      return phase.test();
    });
  }

  // ...otherwise notify the tester that the current run has completed and
  // pass a function which will end the test suite
  return Promise.resolve(function() {
    phase.emit('end');
    phase.removeAllListeners();
    phase.dispatcher.end();
  });
};

/**
 * Cache a function to be called at every test run phase point
 * @param {Function} handler
 */
Phase.prototype.afterEach = function(handler) {
  this.afterEach.handlers.push(handler);
};

Phase.prototype.afterEach.handlers = [];

/**
 * Handler to be invoked when the current run is completed and ready for another
 * run or end of suite. Continuation is passed to the test itself for next
 * determination.
 */
Phase.prototype.next = function() {
  var phase = this;

  var promises = this.afterEach.handlers.map(function(handler) {
    return handler(phase);
  });

  Promise
    .all(promises)
    .then(function() {
      return phase.handleRun();
    })
    .then(function() {
      return phase.beforeNext();
    })
    .then(function(next) {
      return next();
    })
    .catch(function(err) {
      phase.emit('error', err);
    });
};

/**
 * Handle a test run failure by attempting any retries or notifying the test
 * phase of the failure
 * @param err
 */
Phase.prototype.fail = function(err) {
  var phase = this;

  this.stopTimeout();

  if (err.message && err.message === 'timeout') {
    if (this.currentTry <= this.options.retries) {
      this.log('Run %d timed out, retry attempt %d',
        this.currentRun, this.currentTry);
      this.currentTry++;

      // reset the timer and any potentially erroneous results
      this.resetTimeout();
      this.results = [];

      this.device.log
        .clear()
        .then(function() {
          return phase.retry();
        })
        .then(function() {
          return phase.tryRun();
        })
        .then(function() {
          phase.next();
        })
        .catch(function(err) {
          phase.fail(err);
        });
    } else {
      this.timeoutError();
    }
  } else {
    phase.emit('error', err);
  }
};

/**
 * Start a single test run
 */
Phase.prototype.test = function() {
  var phase = this;

  this.log('Starting run %d', this.currentRun);

  this.results = [];

  this
    .tryRun()
    .then(function() {
      phase.next();
    })
    .catch(function(err) {
      phase.fail(err);
    });
};

/**
 * Input event will be ignored if the value equals to the kernel cached one.
 * Initiate a reset to set cached values 0 after a B2G restart. Check bug
 * 1168269 comment 22 for more information.
 * @returns {Promise}
 */
Phase.prototype.resetInput = function() {
  return this.device.input.reset();
};

/**
 * Start the suite by passing execution back to the phase for event binding and
 * test notifications
 */
Phase.prototype.start = function() {
  this.currentRun = 1;
  this.currentTry = 1;

  return this.test();
};

/**
 * Write the given entries to a format suitable for reporting
 * @param {Array} entries
 * @param {String} suite
 * @param {String} startMark
 * @returns {object}
 */
Phase.prototype.format = function(entries, suite, startMark) {
  var phase = this;
  var results = {};
  var initialAction = null;
  var initialActionIndex = null;

  // Find the initialAction and its location in the entries
  entries.every(function(entry, index) {
    if (entry.name !== startMark) {
      return true;
    }

    initialAction = entry;
    initialActionIndex = index;
    return false;
  });

  if (!initialAction) {
    this.emit('error', new Error('Missing initial entry mark for run'));
    return;
  }

  // Remove initialAction from the other entries to avoid another filtering
  entries.splice(initialActionIndex, 1);

  entries.forEach(function(entry) {
    var name = entry.name;
    var series = suite + '.' + name;
    var point = {
      time: phase.time,
      suite: suite,
      entryType: entry.entryType,
      context: entry.context
    };

    if (entry.appName) {
      point.appName = entry.appName;
    }

    if ('value' in entry) {
      point.value = entry.value;
    } else {
      point.epoch = entry.epoch;
      point.value = entry.entryType === 'mark' ?
        entry.epoch - initialAction.epoch : entry.duration;
    }

    if (point.value < 0) {
      return;
    }

    point = merge(point, phase.getDeviceTags());

    if (!results[series]) {
      results[series] = [];
    }

    results[series].push(point);
  });

  this.formattedRuns.push(results);

  return results;
};

/**
 * Output aggregate statistical information for all suite runs to the console
 */
Phase.prototype.logStats = function() {
  var phase = this;
  var results = {};

  this.formattedRuns.forEach(function(run) {
    Object
      .keys(run)
      .forEach(function(key) {
        var entries = run[key];

        entries.forEach(function(entry) {
          var contextResults = results[entry.context];

          if (!contextResults) {
            contextResults = results[entry.context] = {};
          }

          if (!contextResults[key]) {
            contextResults[key] = [];
          }

          var value = entry.value;

          if (entry.entryType === 'memory') {
            value = value / 1024 / 1024;
          }

          contextResults[key].push(value);
        });
      });
  });

  Object
    .keys(results)
    .forEach(function(contextKey) {
      var contextResults = results[contextKey];
      var metrics = [
        ['Metric', 'Mean', 'Median', 'Min', 'Max', 'StdDev', 'p95']
      ];

      Object
        .keys(contextResults)
        .forEach(function(key) {
          var values = contextResults[key];
          var percentile = stats.percentile(values, 0.95);

          metrics.push([
            key,
            stats.mean(values).toFixed(3),
            stats.median(values).toFixed(3),
            Math.min.apply(Math, values).toFixed(3),
            Math.max.apply(Math, values).toFixed(3),
            stats.stdev(values).toFixed(3),
            percentile ? percentile.toFixed(3) : 'n/a'
          ]);
        });

      phase.log('Results from %s\n', contextKey);
      console.log(Table(metrics) + '\n');
    });
};

/**
 * Read device-specific tags from the device's properties
 * @returns {object}
 */
Phase.prototype.getDeviceTags = function() {
  if (this.getDeviceTags.cache) {
    return this.getDeviceTags.cache;
  }

  var properties = this.device.properties;
  var tags = {};

  Object
    .keys(properties)
    .forEach(function(key) {
      if (key.indexOf(Phase.TAG_IDENTIFIER) === 0) {
        tags[key.slice(Phase.TAG_IDENTIFIER.length)] = properties[key];
      }
    });

  return this.getDeviceTags.cache = tags;
};

/**
 * Report event metadata used for writing annotations to Raptor visualization UI
 * @returns {Promise}
 */
Phase.prototype.reportTest = function() {
  if (!this.canReport) {
    return Promise.resolve();
  }

  // TODO: Evaluate the necessity of writing data this way once we switch to...
  // TODO: ...using Grafana 2.0 or InfluxDB 1.9
  var text = util.format('Gaia: %s<br/>Gecko: %s',
    this.device.gaiaRevision.substr(0, 16),
    this.device.geckoRevision.substr(0, 16));

  var row = merge({
    time: this.time,
    title: 'Revisions',
    tags: null,
    text: text
  }, this.getDeviceTags());

  return this.report({
    events: [row]
  });
};

/**
 * Write useful debug information about receiving an event entry
 * @param {string} event
 * @param {object} entry
 */
Phase.prototype.debugEventEntry = function(event, entry) {
  debug('Received %s `%s` in %s', event, entry.name, entry.context);
};

/**
 * Wait for a particular performance mark or measure from a given context
 * @param {string} name performance entry name to wait for
 * @param {string} context origin which will emit the performance entry
 * @returns {Promise}
 */
Phase.prototype.waitForPerformanceEntry = function(name, context) {
  var phase = this;

  return new Promise(function(resolve) {
    phase.dispatcher.on(Phase.PERFORMANCEENTRY, function handler(entry) {
      if (entry.name !== name || entry.context !== context) {
        return;
      }

      phase.dispatcher.removeListener(Phase.PERFORMANCEENTRY, handler);
      resolve(entry);
    });
  });
};

/**
 * Wait for the USS, PSS, and RSS from a given context
 * @param {string} context origin which will emit the memory entries
 * @returns {Promise}
 */
Phase.prototype.waitForMemory = function(context) {
  var phase = this;
  var hasUss = false;
  var hasPss = false;
  var hasRss = false;

  return new Promise(function(resolve) {
    phase.dispatcher.on(Phase.MEMORYENTRY, function handler(entry) {
      if (entry.context !== context) {
        return;
      }

      if (entry.name === 'uss') {
        hasUss = true;
      } else if (entry.name === 'pss') {
        hasPss = true;
      } else if (entry.name === 'rss') {
        hasRss = true;
      }

      if (hasUss && hasPss && hasRss) {
        phase.dispatcher.removeListener(Phase.MEMORYENTRY, handler);
        resolve(entry);
      }
    });
  });
};

/**
 * Wait for the Homescreen and System to reach fullyLoaded
 * @returns {Promise}
 */
Phase.prototype.waitForB2GStart = function() {
  return Promise.all([
    this.waitForHomescreen(),
    this.waitForSystem()
  ]);
};

/**
 * Resolve when the Homescreen has been fully loaded
 * @returns {Promise}
 */
Phase.prototype.waitForHomescreen = function waiter() {
  var phase = this;

  debug('Waiting for Homescreen');

  if (this.homescreenFullyLoaded) {
    return Promise.resolve(waiter.entry);
  }

  return this
    .waitForPerformanceEntry('fullyLoaded', Phase.VERTICAL_CONTEXT)
    .then(function(entry) {
      phase.homescreenFullyLoaded = true;

      if (!phase.homescreenPid) {
        debug('Capturing Homescreen PID: %d', entry.pid);
        phase.homescreenPid = entry.pid;
      }

      return waiter.entry = entry;
    });
};

/**
 * Resolve when the System has been fully loaded
 * @returns {Promise}
 */
Phase.prototype.waitForSystem = function waiter() {
  var phase = this;

  debug('Waiting for System');

  if (this.systemFullyLoaded) {
    return Promise.resolve(waiter.entry);
  }

  return Promise
    .race([
      this.waitForPerformanceEntry('fullyLoaded', Phase.SYSTEM_CONTEXT),
      this.waitForPerformanceEntry('osLogoEnd', Phase.SYSTEM_CONTEXT)
    ])
    .then(function(entry) {
      phase.systemFullyLoaded = true;

      if (!phase.systemPid) {
        debug('Capturing System PID: %d', entry.pid);
        phase.systemPid = entry.pid;
      }

      return waiter.entry = entry;
    });
};

/**
 * Trigger a memory minimization on the device
 * @returns {Promise}
 */
Phase.prototype.triggerGC = function() {
  var marionette = this.device.marionette;

  return marionette
    .startSession()
    .then(function() {
      return marionette.triggerGC();
    })
    .then(function() {
      return marionette.deleteSession();
    });
};

module.exports = Phase;
