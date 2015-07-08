var Promise = require('promise');
var async = require('async');
var merge = require('deepmerge');
var PhaseRunner = require('./lib/phases');

// Each test run can generate many event handlers, so let's shut off Node's
// too-many-listeners warning.
process.setMaxListeners(0);

/**
 * Handle any remaining logic after all suites have been completed
 */
var complete = function(runner) {
  runner.log('Testing complete');

  if (!runner.device) {
    return Promise.resolve();
  }

  return runner
    .reportTest()
    .then(function() {
      return runner.device.log.stop();
    });
};

/**
 * Report error to the console and exit
 */
var handleError = function(runner, err) {
  runner.log('Aborted due to error:\n');
  console.error(err.stack || err);
  process.exit(1);
};

/**
 * Factory to instantiate a test runner. Sets up error and ready notification.
 * @param {object} options options to pass through to suite
 * @param {function} callback
 * @returns {PhaseRunner}
 */
var createRunner = function(options) {
  return new Promise(function(resolve) {
    currentRunner = new PhaseRunner(options);

    currentRunner.once('ready', function() {
      resolve(currentRunner);
    });
  });
};

/**
 * Register a customized runner.
 * @param {string} phase the phase name of the customized runner
 * @param {path} path the path to the runner file
 */
var registerRunner = function(phase, path) {
  PhaseRunner.registerRunner(phase, path);
};

/**
 *
 * @param {object} options PhaseRunner options, e.g. appPath, runs, retries
 * @param {function} callback
 */
var raptor = function(options) {
  // If registering a new runner: { phase: String, path: ModulePath }.
  // If registering a new runner there is no need to add 'phase' in options.
  if (options.runner) {
    var phase = options.runner.phase;
    var path = options.runner.path;

    PhaseRunner.registerRunner(phase, path);
    options.phase = options.runner.phase;
  }

  return new Promise(function(resolve, reject) {
    var runner = new PhaseRunner(options);

    runner
      .on('error', function(err) {
        complete(runner)
          .then(function() {
            handleError(runner, err);
          });
      })
      .on('end', function() {
        runner.logStats();
        complete(runner);
      })
      .once('ready', function() {
        resolve(runner);
      });
  });
};

module.exports = raptor;
