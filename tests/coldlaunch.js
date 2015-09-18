setup(function(options) {
  options.test = 'cold-launch';
  options.phase = 'cold-launch';
});

afterEach(function(phase) {
  return phase.closeApp();
});
