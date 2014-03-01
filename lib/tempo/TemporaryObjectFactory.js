var when = require('when');

// Global constants to be used as names for registered objects properties
var	_kTimer = "__tof_timer",
	_kTimeout = "__tof_timeout",
	_kDestroy = "__tof_isDestroy";
	_kDeferer  = "__tof_deferer";

/**
 * TemporaryObjectFactory wraps given functions to create and destroy objects
 * and create factory wich is ensure that:
 * 1. Created objects get cached
 * 2. Remove object from cache happens after given timeout
 * 4. If during timeout get request arrives, object destroy cancelled
 * 3. If actual object destroy happens all get requests delayed till
 *    destroy action completes
 *
 *
 * @module tempo
 * @class TemporaryObjectFactory
 * @constructor TemporaryObjectFactory
 * @param buildAction
 * @param destroyAction
 */
var TemporaryObjectFactory = module.exports = function(buildAction, destroyAction) {
	if (!buildAction) {
		throw new Error("TemporaryObjectFactory must has buildAction");
	}

	if (!destroyAction) {
		throw new Error("TemporaryObjectFactory must has purgeAction");
	}

	/**
	 *
	 * @protected
	 * @property _entries {Object} all alive entries contains in cache
	 */
	this._entries = {};

	/**
	 *
	 * @property buildAction {Function} function using to build
	 * new object on cache miss
	 */
	this.buildAction = buildAction;

	/**
	 *
	 * @property destroyAction {Function} action using to destrory
	 * unsed objects
	 */
	this.destroyAction = destroyAction;
};

/**
 * Checks whatever given key is present in the internal cache
 *
 * @method has
 */
TemporaryObjectFactory.prototype.has = function(key) {
	return this._entries.hasOwnProperty(key);
};

/**
 * Creates new object or returns cached version
 *
 *
 * @method get
 * @param key a name result object should be registered in cache with
 * @param timeout how many milliseconds factory should wait after destroy before actually
 * destroy object
 * @param [optional]* arguments to be passed to create function with key and timeout
 */
TemporaryObjectFactory.prototype.get = function (timeout, key) {
	if (!timeout) {
		throw new Error("Timeout is not specified");
	} else if (!key) {
		throw new Error("Key is not specified");
	}

	var promise, self = this, self_args = arguments;
	if (!this.has(key)) {
		// Build and register promise
		promise = this.buildAction.apply(null, Array.prototype.slice.call(self_args, 1));
		promise = this.__install(key, promise, timeout);
	} else {
		// We already have a promise it could be:
		promise = this._entries[key];
		if (promise[_kTimer]) {
			// Destroy was requested, however we come earlier, so able to cancel it
			clearTimeout(promise[_kTimer]);
			promise[_kTimer] = undefined;
		}  else if (promise[_kDestroy]) {
			// That is a promise to destroy session, so we need to
			// wait till destroy happens and then create session again
			promise = promise[_kDeferer].promise.ensure(function(){
				return self.get.apply(self, self_args);
			});
		} else {
			// usual promise for a value - return as it is
		}
	}

	return promise;
};

/**
 * Request object destroy
 *
 * Client is responsible for referencies tracking of objects, i.e when
 * object is not needs anymore, client should call that method. Function
 * returns a promise to destroy object some time later
 *
 * Once there is no more referencies for the object, factory will wait
 * for a specified timeout. If during that time no more referencies appears
 * for the object, factory will call destroy action, supplied by user.
 *
 * During destroy function execution it is possible for user to ask for the
 * object again. In that case all request will be served after destroy function
 * finishes its execution. For performance reason factory won't create a new
 * object instead old one will be returned
 *
 * @param key {Object} key for a object to be destroyed or the object itself.
 */
TemporaryObjectFactory.prototype.destroy = function (key) {
	if (!this.has(key)) {
		throw new Error("Entry doesnt exist: "+key);
	}

	var promise = this._entries[key];
	if (promise[_kTimer]) {
		// Promise is awaiting for timeout as we requested
		// for delete - return delete promise
	} else if (promise[_kDestroy]){
		// that is already promise to destroy object
	} else {
		// That is a promise for a value, so we need to register timer
		// once timer fired we will replace promise by the destroy one
		promise[_kTimer] = setTimeout(
				this.__delete.bind(this),
				promise[_kTimeout],
				key
		);
	}
	return promise[_kDeferer].promise;
};

/**
 * Setup hidden fields used for Factory logic in the promise object.
 *
 * @method __install
 * @private
 */
TemporaryObjectFactory.prototype.__install = function (key, promise, timeout) {
	// If promise fails, we need to cleanup cache before any client gets
	// know about that to ensure we are not cache failures
	var self = this;
	this._entries[key] = promise = promise.otherwise(function() {
		delete self._entries[key];
	});

	// Setup hidden fields in promise to track information
	// needs by factory logic. That must be done AFTER setup,
	// becase otherwise method wraps original promise
	promise[_kTimer] = undefined;
	promise[_kDestroy] = false;
	promise[_kDeferer] = when.defer();
	promise[_kTimeout] = timeout;
	return promise;
};

/**
 * Performs actual cache eviction job
 *
 * @method __delete
 * @private
 */
TemporaryObjectFactory.prototype.__delete = function(key) {
	// That is a function to be called when factory was requested
	// to delete item and timeout if passed, so delete it
	var self = this, value = this._entries[key];

	// We need to mark objects in a propper way as actual deletition
	// will happens later and some get call could arrives during that
	// time. So get method should be aware of entry state to delay creation
	// till destroy method complete
	value[_kDestroy] = true;
	value[_kTimer] = undefined;

	// Schedule actual removal.
	// Returned value is a promise to perform removal
	value.then(function(obj){
		try {
			return value[_kDeferer].resolve(self.destroyAction(key, obj));
		} catch(err) {
			return  value[_kDeferer].reject(err);
		};
	}, function(error){
		return value[_kDeferer].reject(error);
	});

	// We will be first who get knows about actual removal happens,
	// so it is safe to clear cache now.
	value[_kDeferer].promise.ensure(function(){
		delete self._entries[key];
	});
};