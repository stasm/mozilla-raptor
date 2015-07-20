var exec = require('child_process').exec;
var Promise = require('promise');
var debug = require('debug')('raptor:command');

/**
 * API for building up and executing shell commands
 * @param {string} [initialCommand] An optional first command
 * @constructor
 */
var Command = function(initialCommand) {
  if (!(this instanceof Command)) {
    return new Command(initialCommand);
  }

  this.builder = initialCommand ? [initialCommand] : [];
};

/**
 * Append content to the command builder
 * @param {string} content
 * @returns {Command}
 */
Command.prototype.append = function(content) {
  this.builder.push(content);
  return this;
};

/**
 * Append a command to be run against `adb <command>`
 * @param {string} command
 * @returns {Command}
 */
Command.prototype.adb = function(command) {
  var commandBuilder = ['adb'];

  if (this._host) {
    commandBuilder.push('-H ' + this._host);
  }

  if (this._port) {
    commandBuilder.push('-P ' + this._port);
  }

  commandBuilder.push(command);
  this.builder.push(commandBuilder.join(' '));

  return this;
};

/**
 * Append a command to be run against `adb shell <command>`
 * @param {string} command
 * @returns {Command}
 */
Command.prototype.adbShell = function(command) {
  return this.adb("shell '" + command + "'");
};

/**
 * Forward an adb port from the device to the local connection
 * @param {number} port
 * @returns {Command}
 */
Command.prototype.adbForward = function(port) {
  return this.adb('forward tcp:' + port + ' tcp:' + port);
};

/**
 * Append an AND (&&) to the builder with an optional AND-ed command
 * @param {string} [command]
 * @returns {Command}
 */
Command.prototype.and = function (command) {
  this.builder.push('&&');
  if (command) {
    this.builder.push(command);
  }
  return this;
};

/**
 * Append a PIPE (|) to the builder with an optional PIPE-ed command
 * @param {string} [command]
 * @returns {Command}
 */
Command.prototype.pipe = function(command) {
  this.builder.push('|');
  if (command) {
    this.builder.push(command);
  }
  return this;
};

/**
 * Get the stringified value of the current command build
 * @returns {string}
 */
Command.prototype.value = function() {
  return this.builder.join(' ');
};

/**
 * Append a command to be run against `echo <command>`
 * @param {string} command
 * @returns {Command}
 */
Command.prototype.echo = function(command) {
  this.builder.push('echo ' + command);
  return this;
};

/**
 * Append an environment variable to be run as `<name>=<command>`
 * @param {string} name Environment variable name
 * @param {string} command Environment variable value
 * @returns {Command}
 */
Command.prototype.env = function(name, command) {
  this.builder.push(name + '=' + command);
  return this;
};

/**
 * Execute the built command in a child process
 * @returns {Promise}
 */
Command.prototype.exec = function() {
  var command = this.value();
  debug('[Executing] %s', command);
  return new Promise(function(resolve, reject) {
    exec(command, function(err, stdout, stderr) {
      if (err) {
        return reject(err, stderr);
      }

      resolve(stdout);
    });
  });
};

/**
 * Factory function to generate commands for a given device
 * @param {Device} device
 * @returns {Function}
 */
module.exports = function(device) {
  /**
   * @param {string} [initialCommand] An optional first command
   * @returns {Command}
   */
  return function(initialCommand) {
    var command = new Command(initialCommand);

    command._host = device.options.adbHost;
    command._port = device.options.adbPort;

    return command;
  };
};
