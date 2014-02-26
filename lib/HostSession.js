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
	 * @property _creationTime
	 * @type timestamp
	 */
	this._creationTime = Date.now();

	/**
	 * Crawl delay choosed to be used
	 *
	 * Number of milliseconds between two request crawler has to wait
	 *
	 * @property _crawlDelay
	 * @type number
	 * @default 1000
	 */
	this._crawlDelay = delay || 1000;

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
	 * Number of request made to host during that session
	 *
	 * @property _sentRequestCount
	 * @type number
	 */
	this._sentRequestCount = 0;

	/**
	 * When last request to the host was issued
	 *
	 * @property _lastRequestTime
	 * @type numeber
	 */
	this._lastRequestTime = 0;
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
	return Date.now() - this._creationTime;
};

/**
 * How many milliseconds Crawler should wait till next request could be
 * issued to the host
 *
 * @method timeToWait
 * @returns number of milliseconds
 */
HostSession.prototype.timeToWait = function() {
	return Math.max(this._lastRequestTime + this._crawlDelay - Date.now(), 0);
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
		throw new Error("Given ip list is empty");
	} else if (ips.length == 1) {
		return ips[0];
	}
	// Sort array to define in what order it is access
	ips.sort();

	// For each 10th request we'd like to choose random IP
	var index = 0;
	if (ips.length > 1 && (this._sentRequestCount+1) % 10 == 0) {
		index = 1+Math.floor((Math.random()*ips.length));
	}

	return ips[index];
};

/**
 * Reports about request begin to HostSession. Each time crawler
 * sends request to some host according session must be notified
 * with using of that method.
 *
 * It allows HostSession to track statistics and calculate correct
 * delays
 *
 * @param {timestamp} time [optional] Time when request has been sent
 * If parameter skipped Date.now assumed
 */
HostSession.prototype.requestSent = function(time) {
	time = time || Date.now();
	this._lastRequestTime   = Math.max(this._lastRequestTime, time);
	this._sentRequestCount += 1;
};