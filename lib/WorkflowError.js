var util = require('util');

var CODES = {

};

var WorkflowError = module.exports = function (code, message) {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);

  this.name = this.constructor.name; //set our function’s name as error name.
  this.code = code;
  this.message = message || CODES[code];
};

// inherit from Error
util.inherits(WorkflowError, Error);