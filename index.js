var Promise = require('promise');
var merge = require('deepmerge');
var phases = require('./lib/phases');

// Each test run can generate many event handlers, so let's shut off Node's
// too-many-listeners warning.
process.setMaxListeners(Infinity);

var factory = function() {
  var instance = function(handler) {
    instance._handler = handler;
  };

  instance.invoke = function() {
    var args = arguments;

    return Promise
      .resolve()
      .then(function() {
        if (instance._handler) {
          return instance._handler.apply(null, args);
        }
      });
  };

  return instance;
};

['setup', 'afterEach', 'teardown'].forEach(function(method) {
  global[method] = factory();
});

/**
 * Handle any remaining logic after all suites have been completed
 */
var complete = function(phase) {
  phase.log('Testing complete');

  if (!phase.device) {
    return Promise.resolve();
  }

  return phase
    .reportTest()
    .then(function() {
      return phase.device.log.stop();
    })
    .then(function() {
      return global.teardown.invoke(phase);
    });
};

/**
 * Report error to the console and exit
 */
var handleError = function(phase, err) {
  if (phase) {
    phase.log('Aborted due to error:\n');
  }

  console.error(err.stack || err);
  process.exit(1);
};

/**
 *
 * @param {object} options phases options, e.g. appPath, runs, retries
 * @param {function} callback
 */
var raptor = function(testPath, options) {
  // If registering a new runner: { phase: String, path: ModulePath }.
  // If registering a new runner there is no need to add 'phase' in options.
  if (options.runner) {
    var phase = options.runner.phase;
    var path = options.runner.path;

    phases.register(phase, path);
    options.phase = options.runner.phase;
  }

  require(testPath);

  global.setup
    .invoke(options)
    .then(function() {
      var phase = phases.create(options);

      phase.once('error', function(err) {
        return complete(phase)
          .then(function() {
            handleError(phase, err);
          });
      });

      phase.once('end', function() {
        phase.logStats();
        return complete(phase);
      });

      phase.afterEach(global.afterEach.invoke);
    })
    .catch(function(err) {
      handleError(null, err);
    });
};

module.exports = raptor;
