var dns = require('dns'),
	nodefn = require("when/node/function");

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

	/**
	 * Infligh requests we are processing right now.
	 *
	 * Scheduling algorithm is using that set to ensure
	 * that crawler do not fetch some page in parallel
	 * @property _requests
	 * @type Object
	 */
	this._requests = {};

	/**
	 * Scheduling information for each IP
	 *
	 * Scheduling algorithm is using that structure to track
	 * requests history for a given IP and ensure crawl delays
	 * @property _schedules
	 * @type Object
	 */
	this._schedulers = {};

	/**
	 * Cache of host sessions are currently used by crawler
	 *
	 * Caches host sessions are using by scheduler to ensure
	 * crawl delays for the each host
	 * @property _sessions
	 * @type Object
	 */
	this._sessions = {};

	/**
	 * A+/Promise wrapper around asyn function resolves host names
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('resolveHost', function(hostname, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * Please note that function doesn't have a crawler instance argument,
	 * to stay compatible with node.js builtin resolve function
	 *
	 * @property _resolveHost
	 * @type Function
	 * @default is using node.js DNS module
	 */
	this._resolveHost = null;
	this.setup('resolveHost', dns.resolve4);

	/**
	 * A+/Promise wrapper around asyn function creates new host
	 * session
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('createScheduler', function(crawler, robotsContent, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * Where robotsContent is a String with robots.txt content or RobotsTxt class
	 * instance
	 *
	 * @property _createHostSession
	 * @type Function
	 * @default fetches robots.txt using normal Crawler workflow then builds default
	 * HostSession object from content.
	 */
	this._createHostSession = null;
	this.setup('createHostSession', function(crawler, robotsContent, callback){
		callback(null, new HostSession(3000, {}));
	});

	/**
	 * A+/Promise wrapper around asyn function creates new scheduler
	 * for IP
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('createScheduler', function(crawler, IP, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * @property _createScheduler
	 * @type Function
	 * @default builds standard RequestScheduler with IP delay 500ms
	 */
	this._createScheduler = null;
	this.setup('createScheduler', function(crawler, IP, callback){
		callback(null, new RequestScheduler(500));
	});

	/**
	 * A+/Promise wrapper around asyn function loads stored cookies
	 * for a host.
	 *
	 * Note that function result is not cached, i.e it is possible to
	 * have two concurrent loadCookies requests for the same host. User
	 * supplied function should takes case about that by itself.
	 *
	 * However it is not possible to have concurrent requests for the same
	 * URL
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('loadCookies', function(crawler, url, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * @property _loadCookies
	 * @type Function
	 * @default none
	 */
	this._loadCookies = false;

	/**
	 * A+/Promise wrapper around asyn function loads page info from cache
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('loadCachedPage', function(crawler, url, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * @property _loadCachedPage
	 * @type Function
	 * @default none
	 */
	this._loadCachedPage = false;

	/**
	 * A+/Promise wrapper around asyn function loads page from external
	 * source, like net
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('fetchPage', function(crawler, url, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * @property _fetchPage
	 * @type Function
	 * @default none
	 */
	this._fetchPage = false;

	/**
	 * A+/Promise wrapper around asyn function stores cookies
	 * back to storage
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('storeCookies', function(crawler, url, cookies, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * @property _storeCookies
	 * @type Function
	 * @default none
	 */
	this._storeCookies = false;

	/**
	 * A+/Promise wrapper around asyn function stores fetched page
	 * into the cache
	 *
	 * When supplied by user though setup method, should be
	 * given in format:
	 *
	 * 	crawler.setup('storePage', function(crawler, CrawlResult, callback){
	 * 		// some work
	 * 		callback(null, result);
	 *
	 * 		// if error
	 * 		callback(error, null);
	 * 	});
	 *
	 * @property _storePage
	 * @type Function
	 * @default none
	 */
	this._storePage = false;
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
Crawler.prototype.setup = function(name,impl) {
	if (!this.hasOwnProperty('_'+name)) {
		throw new Error("Crawler doesn't have behaviour with name: '"+name+"'");
	}
	this['_'+name] = nodefn.lift(impl);
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
 * ## Crawler fetch implementation
 * Method must schedule and execute downloading of the given URL
 * to ensure host and ip crawling delays
 *
 * Once request received, implementation should take care that all
 * necessary information provided. I.e resolve host, create host session
 * if necessary, e.t.c
 *
 * It is allowed for that method to issue additional requests to complete
 * given, for example it could be that host session is not defined, so robots.txt
 * should be downloaded. It is important to record all additional requests into
 * context entries
 *
 * ## Fetch context
 * Is used to trace requests sequence for a single page download as long as
 * all relevant information like IP address, cookies used by current download
 * sequence, e.t.c
 *
 * @method _schedule
 * @protected
 *
 * @param {String} ip to fetch from
 * @param {Object} Node.js url parse object
 */
Crawler.prototype._schedule = function (ip, url) {
	throw new Error("Not implemented yet");
};