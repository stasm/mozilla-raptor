var EventEmitter = require('events').EventEmitter;
var Promise = require('promise');
var util = require('util');
var stats = require('stats-lite');
var Table = require('markdown-table');
var influent = require('influent');
var crypto = require('crypto');
var utils = require('../../utils');
var Dispatcher = require('../dispatcher');
var performanceParser = require('../parsers/performance');
var memoryParser = require('../parsers/memory');
var Device = require('../device');
var reporter = require('../reporter');
var debug = require('debug')('raptor:phase');
var merge = utils.merge;
var Value = influent.Value;

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
  this.report = reporter(options);

  this.log('Preparing to start testing...');
  this.resetTimeout();
};

util.inherits(Phase, EventEmitter);

Phase.prototype.homescreenFullyLoaded = false;
Phase.prototype.systemFullyLoaded = false;

Phase.PERFORMANCEENTRY = 'performanceentry';
Phase.MEMORYENTRY = 'memoryentry';
Phase.TAG_IDENTIFIER = 'persist.raptor.';
Phase.PERFORMANCE_BUFFER_SAFETY = 50;
Phase.ICON_TAP_OFFSET = 20;
Phase.NOOP = function() {};

/**
 * Send phase-formatted message(s) to the console. Takes same arguments as
 * console.log
 */
Phase.prototype.log = function() {
  if (this.options.output !== 'console') {
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
        .adbForward(phase.options.forwardPort || phase.options.marionettePort)
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
  this.currentTry = 1;

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

  return this.test();
};

/**
 * Write the given entries to a format suitable for reporting
 * @param {Array} entries
 * @param {String} startMark
 * @returns {object}
 */
Phase.prototype.format = function(entries, startMark) {
  // Convert time to nanoseconds, then encode the current run into the
  // insignificant digits beyond the millisecond. This allows us to
  // aggregate runs together by millisecond in Grafana but still provide a
  // unique record to create in InfluxDB
  var time = this.options.time + utils.zeroPad(this.currentRun);
  var points = [];
  var initialAction = null;
  var initialActionIndex = null;
  var testTags = merge({
    test: this.options.test,
    phase: this.name,
    revisionId: this.getRevisions().revisionId
  }, this.getDeviceTags());

  // Find the initialAction and its location in the entries
  entries.some(function(entry, index) {
    if (entry.name !== startMark) {
      return false;
    }

    initialAction = entry;
    initialActionIndex = index;
    return true;
  });

  if (!initialAction) {
    this.emit('error', new Error('Missing initial entry mark for run'));
    return;
  }

  // Remove initialAction from the other entries to avoid another filtering
  entries.splice(initialActionIndex, 1);

  entries.forEach(function(entry) {
    var seriesName, value;

    if (entry.entryType === 'mark') {
      seriesName = 'measure';
      value = entry.epoch - initialAction.epoch;
    } else {
      seriesName = entry.entryType;
      value = entry.value || entry.duration;
    }

    // Nothing should ever measure to be less than 0
    if (value < 0) {
      return;
    }

    var point = {
      key: seriesName,
      timestamp: time,
      fields: {
        value: value
      },
      tags: merge({
        metric: entry.name,
        context: entry.entryPoint ?
          entry.context + '@' + entry.entryPoint :
          entry.context
      }, testTags)
    };

    if (entry.epoch) {
      point.fields.epoch = new Value(entry.epoch, influent.type.INT64);
    }

    points.push(point);
  });

  // Only inject an annotation point during the first run
  if (this.currentRun === 1) {
    this.annotate();
  }

  this.formattedRuns.push(points);

  return points;
};

/**
 * Create a data point for a Grafana/InfluxDB annotation
 * @param {string} title
 * @param {string} text
 * @returns {{timestamp: string, key: string, fields: object, tags: object}}
 */
Phase.prototype._createAnnotationPoint = function fn(title, text) {
  if (!fn.id) {
    fn.id = 1;
  }

  return {
    timestamp: this.options.time + utils.zeroPad(fn.id++),
    key: 'annotation',
    fields: { text: text },
    tags: merge({
      title: title,
      test: this.options.test
    }, this.getDeviceTags())
  };
};

/**
 * Fetch the formatted revisions and revision id for the current device
 * @returns {object}
 */
Phase.prototype.getRevisions = function fn() {
  if (fn.cache) {
    return fn.cache;
  }

  var hash = crypto.createHash('sha1');
  var gaia = this.device.gaiaRevision.substr(0, 16);
  var gecko = this.device.geckoRevision.substr(0, 16);
  var digest;

  hash.update(gaia);
  hash.update(gecko);
  digest = hash.digest('hex');

  return fn.cache = {
    gaia: gaia,
    gecko: gecko,
    revisionId: digest
  };
};

/**
 * Report test metadata annotations
 * @returns {Promise}
 */
Phase.prototype.annotate = function() {
  var revisions = this.getRevisions();

  var gaia = this._createAnnotationPoint('Gaia', revisions.gaia);
  var gecko = this._createAnnotationPoint('Gecko', revisions.gecko);

  gaia.tags.revisionId = revisions.revisionId;
  gecko.tags.revisionId = revisions.revisionId;

  return this.report([gaia, gecko]);
};

/**
 * Output aggregate statistical information for all suite runs to the console
 */
Phase.prototype.calculateStats = function() {
  var results = {};
  var statistics = {};

  this.formattedRuns.forEach(function(run) {
    run.forEach(function(point) {
      // The key is the type of metric, e.g. measure, memory, ...
      var contextResults = results[point.tags.context];
      var metric = point.tags.metric;
      var value = point.fields.value;

      if (!contextResults) {
        contextResults = results[point.tags.context] = {};
      }

      if (!contextResults[metric]) {
        contextResults[metric] = [];
      }

      if (point.key === 'memory') {
        value = value / 1024 / 1024;
      }

      contextResults[metric].push(value);
    });
  });

  Object
    .keys(results)
    .forEach(function(contextKey) {
      var contextResults = results[contextKey];
      statistics[contextKey] = [];

      Object
        .keys(contextResults)
        .forEach(function(key) {
          var values = contextResults[key];
          var mean = stats.mean(values);

          statistics[contextKey].push({
            Metric: key,
            Mean: mean,
            Median: stats.median(values),
            Min: Math.min.apply(Math, values),
            Max: Math.max.apply(Math, values),
            StdDev: stats.stdev(values),
            p95: stats.percentile(values, 0.95) || mean
          });
        });
    });

  return statistics;
};

/**
 * Output aggregate statistical information for all suite runs to the console
 */
Phase.prototype.logStats = function(statistics) {
  if (this.options.output === 'quiet') {
    return;
  }

  if (this.options.output === 'json') {
    console.log(JSON.stringify(statistics));
    return;
  }

  Object
    .keys(statistics)
    .forEach(function(contextKey) {
      var table = [];
      var metrics = statistics[contextKey];

      metrics.forEach(function(metric, index) {
        var keys = Object.keys(metric);

        // Capture the table headers from the first record
        if (index === 0) {
          table.push(keys);
        }

        // Now push each row into the table
        table.push(keys.map(function(key) {
          var value = metric[key];

          if (typeof value === 'number' && value % 1 !== 0) {
            value = value.toFixed(3);
          }

          return value;
        }));
      });

      this.log('Results from %s\n', contextKey);
      console.log(Table(table) + '\n');
    }, this);
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
    .waitForPerformanceEntry('fullyLoaded', this.options.homescreen)
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
      this.waitForPerformanceEntry('fullyLoaded', this.options.system),
      this.waitForPerformanceEntry('osLogoEnd', this.options.system)
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
