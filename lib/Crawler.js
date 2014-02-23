/**
 * Crawler instance
 *
 * <ol>
 * 	<li>Tracks progress of all flight requests</li>
 *	<li>Manages hosts/ip crawl delays</li>
 * </ol>
 *
 * @class Crawler
 * @constructor
 */
var Crawler = module.exports = function() {

	// Inflight requests we are processing right now:
	//
	// key   - is a normalized request URL
	// value - is a promise of CrawlResult
	this._requests = {};

	// Scheduling information for each IP
	//
	// key   - IP of the host in text form
	// value - IpScheduler
	this._schedulers = {};

	// Active hosts sessions info
	//
	// key   - normalized host name
	// value - HostSession
	this._sessions = {};


	// Builtin functions
	//
	// 1. Each operation is designed to be async
	// 2. Each function could be replaced by custom one
	// 3. We accept custom function in standard node.js form
	//    when callback if a function(err, result)
	//
	// With respect to given rules, we wrap each function (user provided
	// or default impl) by when wrapper to convert function to promise
	// based async operation
	this._resolveHost;
	this._loadSession;
	this._loadScheduler;
	this._loadCookies;
	this._loadCache;
	this._fetch;
	this._saveCookies;
	this._updateCache;
};

/**
 * Allows to setup implementation of various
 * operations in crawler.
 *
 * <p> Each provided operation much come in form of standard
 * node.js async function, i.e last argument is a callback accepts
 * two parameters where first one is error if any.
 *
 * First argument of user supplied function is a crawler, second is
 * operation arguments, third is a crawler internal callback to notified
 * once operation is complete or abort due a error.
 * </p>
 *
 * @example
 *  Crawler c = new Crawler();
 *  c.setup('resolveHost', function(crawler, host, resolveCallback){
 *
 *  });
 *
 * @method setup
 * @param {Function} impl operation implementation
 */
Crawler.prototype.setup = function(impl) {
	throw new Error("Not implemented yet");
};

/**
 * Crawl given set of URLs and return promise for a HAR
 * archive with information about given set
 *
 * That is a general purpose method. All URLs get split into groups
 * of hosts which will be resolved. After resolving URLs are scheduled
 * in the normal way
 *
 * Please note that URLs will be normalized as a part of crawling process
 *
 * @method crawl
 * @param {Array} String array with urls to crawl
 */
Crawler.prototype.crawl = function(urls) {
	throw new Error("Not implemented yet");
};

/**
 * Crawl given set of URLs and returns promise for a HAR
 * archive with information about given set
 *
 *  That is method to crawl single host with exact IP declaration.
 * All URL parts (protocol, host, file, query, e.t.c) will be normalized
 * before crawling
 *
 * @method crawlGroup
 * @param {String} ip to fetch from
 * @param {String} host hostname to fetch
 * @param {String} protocol protocol to use
 * @param {Array} String array with relative URLs in form (path?query#hash) to fetch
 */
Crawler.prototype.crawlGroup = function(ip, host, protocol, files) {
	throw new Error("Not implemented yet");
};

/**
 * Crawler fetch implementation
 *
 * Method must schedule and execute downloading of the given URL
 * to ensure host and ip crawling delays
 *
 * @method _schedule
 * @protected
 * @param {String} ip to fetch from
 * @param {Object} Node.js url parse object
 * @param {Object} fContext Fetching context
 */
Crawler.prototype._schedule = function (ip, url, fContext) {
	throw new Error("Not implemented yet");
};