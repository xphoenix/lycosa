var when = require('when');

// Global constants to be used as names for registered objects properties
var	_kTimer = "__tof_timer",
	_kTimeout = "__tof_timeout",
	_kDestroy = "__tof_isDestroy";
	_kDeferer  = "__tof_deferer";

/**
 * Caching object factory with delayed eviction
 *
 * TemporaryObjectFactory creates and destroys object with using user supplied async
 * methods. After created objects are get cached, so next call won't create a new instance
 * but received cached version instead.
 *
 * During creation client defines a timeout that factory should wait after decide to destroy object and
 * before perform actual destroy logic. If during that timeout factory receives request for an object
 * then object removal gets canceled, i.e object life gets prolong.
 *
 * Client is responsible for tracking object referencies
 *
 *
 * @class TemporaryObjectFactory
 * @constructor TemporaryObjectFactory
 * @param buildAction [Function]
 * @param destroyAction [Function]
 */
var TemporaryObjectFactory = module.exports = function(buildAction, destroyAction) {
	if (!buildAction) {
		throw new Error("TemporaryObjectFactory must has buildAction");
	}

	if (!destroyAction) {
		throw new Error("TemporaryObjectFactory must has purgeAction");
	}

	/**
	 * Actual cache stores all alive objects
	 *
	 * @protected
	 * @property _entries {Object} all alive entries contains in cache
	 */
	this._entries = {};

	/**
	 * Object create action
	 *
	 * Factory uses that method to create new instances of object. Given method
	 * should always returns A+ promise, even if it works synchronously
	 *
	 * The first argument during the call is always requested key. Client might
	 * suply additional parameters during 'get' call
	 *
	 * @property buildAction {Function} function using to build new object instances
	 * on a cache miss
	 */
	this.buildAction = buildAction;

	/**
	 * Object removal action
	 *
	 * Factory calls that action before object gets removed from the internal cache.
	 * During the call first parameter is always the key gets removed from the cahe, second
	 * parameter is a value of promised returned by buildAction.
	 *
	 * Please note that action should always returns A+ promise even in the case of
	 * synchronious work
	 *
	 * @property destroyAction {Function} action using to destroy existing objects
	 */
	this.destroyAction = destroyAction;
};

/**
 * Checks whatever given key is present in the internal cache
 *
 * Please note that even if method returns true it doesn't means
 * that consequent call of get method will return existing value.
 *
 * This method is only checks if key is present in the cache, however
 * chances are that right now object with a such key is destroying, so
 * if client try to retrive it action will be delayed till destroy function
 * end with a subsequent call of the buildAction
 *
 * @method has
 * @returns {Boolean} true if key is present and false otherwise
 */
TemporaryObjectFactory.prototype.has = function(key) {
	return this._entries.hasOwnProperty(key);
};

/**
 * Creates new object instance or returns cached version
 *
 * Method ensures that the following is true:
 * 	If object is present in the cache then cached value returns
 * 	If there is no requested key object gets created
 *
 * 	If object removal is scheduler then removal get canceled
 * 	If object awating to be destroyed then current request gets delayed till
 * 	destroyAction complete
 *
 * @method get
 * @param timeout {Number} how many milliseconds factory should wait after destroy call and before
 * actual object removal
 * @param key {String} the name result object should be registered in cache with
 * @param [optional]* additional arguments to be passed to the buildAction along with key
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
 * Please note that actual object removal will be delayed for a timeout specified by
 * creator during 'get' call. If during timeout factory doesn't receive any request
 * for the given key then object will de removed otherwise results of the current call
 * will be discarded.
 *
 * @method destroy
 * @param key {String} key for a object to be destroyed or the object itself.
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