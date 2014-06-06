var when = require('when');

/**
 * Keeps track of all requests issued to the particular IP
 *
 * Instance of that class is created by crawler for each particular IP.
 * Scheduler is responsible to ensure that crawler is following crawling
 * limits, i.e:
 *
 * 1. Not issue more the 2 requests per second for IP
 * 2. Follows each host crawl delay
 *
 * @class RequestScheduler
 * @constructor
 */
// TODO: Try to minimize number of _execute calls. Right now logic behind is not optimal,
// scheduling could be done much better in terms of number of _execute calls
var RequestScheduler = module.exports = function(delay, connectionLimit) {

	/**
	 * Crawling delay
	 *
	 * How many milliseconds crawler should wait before requests to the IP
	 * represented by current scheduler.
	 *
	 * @property delay
	 * @type Number
	 * @default 500
	 */
	this.delay = delay || 500;

	/**
	 * How many parallel connections crawler could keep to the IP
	 * represented by current scheduler.
	 *
	 * @property connectionLimit;
	 * @type Number
	 * @default 4
	 */
	this.connectionLimit = connectionLimit || 4;

	/**
	 * How many requests has been registered in the scheduler in total
	 * since creation
	 *
	 * @property totalRequestsCount
	 * @type Number
	 */
	this.totalRequestsCount = 0;

	/**
	 * How many requests are active right now
	 *
	 * Number of requests that are processing by crawler right now
	 *
	 * @property activeRequestsCount
	 * @type Number
	 */
	this.activeRequestsCount = 0;

	/**
	 * Number of requests awaiting for execution by crawler
	 *
	 * @property awaitingRequestsCount
	 * @type Number
	 */
	this.awaitingRequestsCount = 0;

	/**
	 * How many connections are currently opened by crawler
	 *
	 * @property _connections
	 * @type Number
	 */
	// TODO: rename to _connectionsCount
	this._connections = 0;

	/**
	 * Last time when request was fired
	 *
	 * @protected
	 * @property _lastRequestTime {Number} epoch when the last request has
	 * been fired
	 */
	this._lastRequestTime = false;

	/**
	 * Timer handler for the next execution
	 *
	 * @protected
	 * @property _timer
	 * @type node.js Timer handler
	 */
	this._timer = false;

	/**
	 * Time when next time scheduler allows fetching
	 *
	 * Please note that that is earliest time when it could happens, node.js has no precise
	 * guarantee about when timer triggers except "not earlier then a timeout".
	 *
	 * That field is used to check new requests and recreate timer if needs (see
	 * add method implementation)
	 *
	 * @protected
	 * @property _timerTarget
	 * @type Number
	 */
	this._timerTarget = false;

	/**
	 * Callback to be called when number of opened connections
	 * fall below watermark defined by this.connectionLimit
	 *
	 * That fields is using by scheduler in conjuction with _timer.
	 * When scheduler has enough connection, callback is not defined.
	 * Once connectionLimit is reached, _timer gets canceled and this
	 * callback becomes a function to continue self exection
	 *
	 * @protected
	 * @property _onConnection
	 * @type Function
	 */
	this._onConnection = false;

	/**
	 * All known queues to be scheduled
	 *
	 * Each element of array is a pair of a host session and array of all requests
	 * registered for that host in the current scheduler.
	 *
	 * @protected
	 * @property _queues
	 * @type Object
	 */
	this._queues = {};
};

RequestScheduler.prototype.isEmpty = function() {
	return (this.activeRequestsCount == 0 && this.awaitingRequestsCount == 0);
};

/**
 * Checks if given host is present in the scheduler
 *
 * @method has
 * @returns {Boolean} true if given host has urls to be scheduled in that
 * schedulers, false otherwise
 */
RequestScheduler.prototype.has = function(hostname) {
	return this._queues.hasOwnProperty(hostname);
};

/**
 * Return time before next registered request will be triggered.
 *
 * @method nextTime
 * @returns time before next request or undefined is scheduler has no
 * awaiting requests or is awaiting for available connections
 */
RequestScheduler.prototype.nextTime = function() {
	return this._timerTarget ? Math.max(this._timerTarget - Date.now(), 0) : undefined;
};

/**
 * Check how many requests could be issued right now by scheduler
 * without awating for current requests to be finished.
 *
 * @method availableConnectionsCount
 * @returns {Number}
 */
RequestScheduler.prototype.availableConnectionsCount = function() {
	return this.connectionLimit - this._connections;
};

/**
 * Notifies scheduler that request has been done
 *
 * After request scheduled by the current scheduler is done, client must
 * notify scheduler about that to allow it to free internal resource.
 *
 * That is needs to let scheduler to be aware about how many requests are
 * in flight for the given IP right now and to control request stream
 * rate
 *
 * @method requestEnd
 */
RequestScheduler.prototype.requestEnd = function() {
	this._connections -= 1;
	this.activeRequestsCount -= 1;
	if (this._onConnection) {
		process.nextTick(this._onConnection);
		this._onConnection = false;
	}
};

/**
 * Schedule URL execution
 *
 * Method is scheduling url execution to happens in some future
 * when it won't breach crawling limits
 *
 * @method schedule
 * @param session HostSession
 * @param url node.js parsed url
 * @return A+ promise for url to be scheduled
 */
RequestScheduler.prototype.schedule = function (session, url) {
	// Select queue to add request to. We want to aggregate all incoming
	// requests in per host lists. That allows us to perform "fair" scheduling
	// when we select most starving hosts first.
	var queue, deferer = when.defer();
	if (this.has(url.hostname)) {
		queue = this._queues[url.hostname];
	} else {
		this._queues[url.hostname] = queue =  {
			session: session,
			items: []
		};
	}

	// Push new url to the host queue
	queue.items.push({
		url: url,
		start: Date.now(),
		resolver: deferer.resolver
	});

	queue.session.requestAdded();
	this.totalRequestsCount += 1;
	this.awaitingRequestsCount += 1;


	// Check if we need to restart timer
	//
	// It could be that next execution scheduled to happens in the far future,
	// however current url could be crawled earlier, so we need to recreate
	// timer on the nearest future
	//
	// On the other hand if scheduler is awaiting for a available connection
	// timeout makes no any difference
	//
	// Also it could be very first request in that scheduler, so we just need
	// to start timer
	if (this._timer || !this._onConnection) {
		// That is how many milliseconds we SHOULD wait before it is possible
		// to crawl given host
		var hostDelay = session.timeToWait();

		// That is how many milliseconds we are going to wait right now. If undefined
		// then we are going to schedule first request (_onConnection is not set as per
		// condition in outer if)
		var schedulerDelay = this.nextTime();

		// Lets check if we need to recreate timer. The only case left to consider is when
		// scheduler is already planned for the next tick, so we have no need to change anything
		// as it is nearest future
		if (schedulerDelay === undefined || schedulerDelay > 0 && hostDelay < schedulerDelay) {
			this._schedule(Math.max(0, hostDelay));
		}
	}

	// Return promise
	return deferer.promise;
};

/**
 * Delay self execution for a given number of milliseconds
 *
 * @protected
 * @method _schdule
 * @param delay {Number} [optional] how many milliseconds to wait till next request
 * could be issued. If parameter not set or has negative value then onConnection call
 * back setup
 */
RequestScheduler.prototype._schedule = function(delay) {
	if (delay && delay < 0) {
		throw new Error("Negative delay: "+delay);
	}

	if (this._timer) {
		clearTimeout(this._timer);
		this._timerTarget = false;
	}
	if (delay == 0) {
		process.nextTick(this._execute.bind(this));
		this._timerTarget = Date.now();
	} else if (delay > 0) {
		this._timerTarget = Date.now()+delay;
		this._timer = setTimeout(this._execute.bind(this), delay);
	} else {
		this._onConnection = this._execute.bind(this);
	}
};

/**
 * Process known queues, resolve promise and setup _timer or
 * _onConnection for the next execution
 *
 * @protected
 * @method _execute
 */
RequestScheduler.prototype._execute = function() {
	var limit = this.availableConnectionsCount(),
		delay = (this._lastRequestTime ? this._lastRequestTime + this.delay - Date.now(): -1);
	if (limit <= 0) {
		// we don't want to do anything if there is no way to schedule
		// a request. In that case we'd like to assign execution to the
		// _onConnection callback
		this._schedule();
		return;
	} else if (delay > 0) {
		// we can't execute any request now as we need to wait for the IP
		// crawl delay. It is important to check it AFTER connection limit
		// as otherwise we will start polling availableConnectionsCount instead
		// of using trigger
		this._schedule(delay);
		return;
	} else if (this.awaitingRequestsCount == 0) {
		// No need to execute anything if we don't have any requests
		return;
	}

	// 1. We are looking for a queue that could be executed right now,
	// that is a queue with minimum timeToWait in session. We consider
	// only queues with negative and 0 time. Positive times means
	// that request might be issued only in the future
	//
	// 2. Also we'd like to know closest point in the future when next
	// request could be scheduled. That is the next _execute call time
	//
	// Lets do all of it in the one O(n) loop
	var host, queueToExecute, queueScore, timeToWait;
	for (name in this._queues) {
		var q = this._queues[name];
		var time = q.session.timeToWait();

		if (time <= 0 && (queueScore === undefined || time < queueScore)) {
			host = name;
			queueScore = time;
			queueToExecute = q;
		}
// TODO: Right now if we meet two hosts which are equally starving (0 for exmaple)
// then the winner is determinated by the order of _queues travel. Which is not good,
// so we need to define obvious model here
//
//		else if (time <= 0 && (time == queueScore)) {
//			// If we meet two equaly starving hosts then first
//			// we execute host with LESS crawl delay.
//			if (queueToExecute.session._crawlDelay > q.session._crawlDelay) {
//				queueScore = time;
//				queueToExecute = q;
//			}
//		}
		else if (time > 0 && (timeToWait === undefined || time < timeToWait)) {
			timeToWait = time;
		}
	}

	// 1. Now lets see what we could do. If there is a queue to execute
	// then consume scheduler counters and trigger queue resolver.
	if (queueToExecute) {
		limit -= 1;
		this._connections++;

		// If we consume the last request in the queue, it is safe to remove
		// a such queue to not consider it anymore during scheduling
		var item = queueToExecute.items.shift();
		if (queueToExecute.items.length == 0) {
			delete this._queues[host];
		}

		// adjust statistics
		this.awaitingRequestsCount -= 1;
		this.activeRequestsCount += 1;

		// Execute found request
		this._lastRequestTime = Date.now();
		queueToExecute.session.requestBegin(this._lastRequestTime);
		item.resolver.resolve(this._lastRequestTime - item.start);
	}


	// 2. It could be that after we do that there is no resources for the
	// next request, so stop self scheduling and setup _onConnection
	if (limit == 0) {
		this._schedule();
	} else if (limit > 0) {
		// If there are still available connections then timeToWait gives us
		// next point of time for the self execution.
		//
		// however there are two coveats to be covered:
		// 1. It could be that scheduled request was the last one, so there
		//    is no any timeToAwait. Or the only available request is in the
		//	  same queue that was scheduled on that run. In the last case
		//	  we can't calculate next time as delay for the session could be
		//	  defined only after request will be fire. In the both cases we need
		//	  to "poll" our internal queues every delay until we could schedule
		//	  self execution more precise
		// 2. It could be that timeToAwait is LESS then this.delay, so it should
		//    be adjusted
		timeToWait = (!timeToWait ? this.delay : Math.max(this.delay, timeToWait));
		this._schedule(timeToWait);
	} else {
		throw new Error("limit of connections should never be negative");
	}
};