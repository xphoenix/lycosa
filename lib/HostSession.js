var tough = require('tough-cookie');

/**
 * ## Host crawling session information
 *
 * Encapsulate all information needs by crawler to perform request
 * scheduling. Also track host crawling statistics
 *
 * @class HostSession
 * @constructor
 */
var HostSession = module.exports = function(delay, rules) {
	/**
	 * When host session has been create
	 *
	 * We need to recreate host session from time to time. That
	 * is because session cached robots rules inside as long as
	 * statistics information wich could affects host crawling process
	 *
	 * @property creationTime
	 * @type timestamp
	 */
	this.creationTime = Date.now();

	/**
	 * Crawl delay choosed to be used
	 *
	 * Number of milliseconds between two request crawler has to wait
	 *
	 * @property crawlDelay
	 * @type number
	 * @default 1000
	 */
	this.crawlDelay = delay || 1000;

	/**
	 * How many requests has been registered for the session in total
	 * since creation
	 *
	 * That number includes activeRequests, awaitin requests and done
	 * requests
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
	 * Stores all cookies known for the current host session
	 *
	 * @property cookiejar
	 * @type Object
	 */
	this.cookiejar = new tough.CookieJar();

	/**
	 * Compiled rules from host's robots.txt
	 *
	 * That is all rules host contains. During crawling we need
	 * to check URLs against that rules to be sure we are not fetching
	 * prohibited pages
	 *
	 * @property _rules
	 * @type RobotsRules
	 * @default allow all
	 */
	this._rules = rules || {};

	/**
	 * When last request to the host was issued
	 *
	 * @property _lastRequestTime
	 * @type numeber
	 */
	this._lastRequestTime = false;
};

/**
 * Session age is a number of milliseconds since session was created
 * Crawler is using that information to decide when seccion should be
 * recreated to ensure we are using actual host information
 *
 * @method age
 * @returns number of milliseconds
 */
HostSession.prototype.age = function() {
	return Date.now() - this.creationTime;
};

HostSession.prototype.isEmpty = function() {
	return (this.activeRequestsCount == 0 && this.awaitingRequestsCount == 0);
};

/**
 * How many milliseconds Crawler should wait till next request could be
 * issued to the host
 *
 * @method timeToWait
 * @returns number of milliseconds
 */
HostSession.prototype.timeToWait = function() {
	return (this._lastRequestTime ? this._lastRequestTime + this.crawlDelay - Date.now() : 0);
};

/**
 * Checks if given URL is allowed to be fetched by crawler with given
 * agent name
 *
 * @method isAllowed
 * @param agent {String} agent name to use with robots.txt rules
 * @param url {Object} node.js url parse result
 * @returns **true** if url could be crawled by agent and **false** otherwise
 */
HostSession.prototype.isAllowed = function(agent, url) {
	// TODO: once robots.txt parser is ready - implement
	// that method
	return true;
};

/**
 * ## Select ip
 *
 * Host session decides what host IP should be used for the next request.
 * That decision might be based on statistics or any other assumption.
 *
 * For example default implementation sends all request to the 'smaller' except
 * every 10th request which is gets route to some other random IP from the list.
 *
 * That is used for client to be able to detect that crawler has been banned on
 * particular IP
 *
 * @param ips {Array} List of IP strings for the host
 * @method selectIp
 * @returns ip string to be used for the next request
 */
HostSession.prototype.selectIp = function(ips) {
	// Don't do any expensive operations for a single value
	// list
	if (!ips || ips.length == 0) {
		return undefined;
	} else if (ips.length == 1) {
		return ips[0];
	}

	// Sort array to define in what order it is access
	ips.sort();

	// For each 10th request we'd like to choose random IP
	var index = 0;
	if (ips.length > 1 && (this.totalRequestsCount - this.awaitingRequestsCount + 1) % 10 == 0) {
		index = 1+Math.floor((Math.random()*(ips.length -1)));
	}

	return ips[index];
};

/**
 * Reports about new request to the HostSession
 *
 */
HostSession.prototype.requestAdded = function() {
	this.totalRequestsCount += 1;
	this.awaitingRequestsCount += 1;
};

/**
 * Reports about request begins to HostSession.
 *
 * Each time crawler sends request to some host, according session
 * must be notified with using of that method. That allows HostSession
 * to track statistics and calculate correct delays
 *
 * @method requestBegin
 * @param {timestamp} time [optional] Time when request has been sent
 * If parameter skipped Date.now assumed
 */
HostSession.prototype.requestBegin = function(time) {
	this._lastRequestTime = time || Date.now();
	this.activeRequestsCount += 1;
	this.awaitingRequestsCount -= 1;
};

/**
 * Reports about request processing has been done to the HostSession
 *
 * @method requestEnd
 * @param {timestamp} time [optional] Time when request has been sent
 * If parameter skipped Date.now assumed
 */
HostSession.prototype.requestEnd = function(time) {
	this.activeRequestsCount -= 1;
	return this.activeRequestsCount + this.awaitingRequestsCount;
};