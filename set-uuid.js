#! /usr/bin/env node

var uuid = require('uuid');
var fs = require('fs');
var path = require('path');

var FILE = path.join(__dirname, '.uuid');

fs.stat(FILE, function(err, stats) {
  if (!err || stats) {
    return;
  }

  fs.writeFile(FILE, uuid.v4(), { encoding: 'utf8' }, function(err) {
    if (err) {
      throw err;
    }
  })
});
