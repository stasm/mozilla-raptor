'use strict';

module.exports = function(raptor, options) {
  options.phase = 'cold';

  raptor(options)
    .then(function(runner) {
      runner.on('run', function(next) {
        runner
          .closeApp()
          .then(next);
      });
    });

};
