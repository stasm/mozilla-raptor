setup(function(options) {
  options.phase = 'cold';
});

afterEach(function(phase) {
  return phase.closeApp();
});
