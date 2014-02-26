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
	this._creationTIme = Date.now();

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

};