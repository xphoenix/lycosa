/**
 *
 * @class CrawlResult
 * @constructor
 */
var CrawlResult = module.exports = function(url, start) {
	if (url === undefined || url === null) {
		 throw new Error("URL must be set")
	};

	/**
	 *
	 * @property url
	 * @type Object
	 */
	this.url = url;

	/**
	 *
	 * @property ip
	 * @type String
	 */
	this.ip = false;

	/**
	 *
	 * @property start
	 * @type TImestamp
	 */
	this.start = start || Date.now();

	/**
	 * Times for all behaviors
	 *
	 * Names are keep synchronized with HAR specification
	 *
	 * @protected
	 * @property _timings
	 * @type Object
	 */
	this._timings = {};

	/**
	 * List of all IPs appropriate for the given request
	 *
	 * @protected
	 * @property _ipList
	 * @type Array
	 */
	this._ipList = false;

	/**
	 * Cache version of requested URL if any
	 *
	 * @protected
	 * @property _cached
	 * @type Object
	 */
	this._cached = false;
};

/**
 * Creates new CrawlResult represents error page for the
 * internal Crawler error
 *
 * @method createForInternalError
 * @return CrawlResult
 */
CrawlResult.createForInternalError = function(url, start, error) {
	var result = new CrawlResult(start, url);
	result._error = error.toString();
	result._timings.dns = 0;
	result._timings.receive = 0;
	result._timings.blocked = Date.now() - start;
	result.generateErrorPage();
	return result;
};

CrawlResult.checkBehaviorResult = function(result) {
	var valid= result.time !== null && result.time !== undefined &&
			result.value !== null && result.value !== undefined;

	if (!valid) {
		throw new Error("Behavior result has wrong format: "+JSON.stringify(result));
	}
};

/**
 * Returns true if crawl result has error
 *
 * @method isError
 * @returns {Boolean}
 */
CrawlResult.prototype.isError = function() {
	return !(this.url && this.ip);
};

CrawlResult.prototype.isRedirect = function() {
	return false;
};

/**
 * Generate fake content with a page, describes error in fetch
 * page sequence
 *
 * @method generateErrorPage
 */
CrawlResult.prototype.generateErrorPage = function() {
	// TODO: Generate HTML
};

/**
 *
 * @method setResolveResult
 * @param result {Object} result of Crawler#resolveHost behavior
 */
CrawlResult.prototype.setResolveResult = function(result) {
	CrawlResult.checkBehaviorResult(result);

	this._ipList = result.value;
	this._timings.dns = result.time;
};

/**
 *
 * @method setCacheResult
 * @param result {Object} result of Crawler#loadCacheState behavior result
 */
CrawlResult.prototype.setCacheLoadResult = function(result) {
	CrawlResult.checkBehaviorResult(result);

	this._cached = result.value;
	this._timings.cache = result.time;
};

/**
 *
 * @method setCacheResult
 * @param result {Object} result of Crawler#loadCacheState behavior result
 */
CrawlResult.prototype.setSessionCreateResult = function(result) {
	CrawlResult.checkBehaviorResult(result);
	this._timings._sessionCreate = result.time;
};

/**
*
* @method setCacheResult
* @param result {Object} result of Crawler#loadCacheState behavior result
*/
CrawlResult.prototype.setIpAddress = function(ip) {
	this.ip = ip;
};

/**
 *
 * @method setRequestScheduler
 * @param result {Object} result of Crawler#loadCacheState behavior result
 */
CrawlResult.prototype.setRequestScheduler = function(result) {
	CrawlResult.checkBehaviorResult(result);
	this._timings._schedulerCreate = result.time;
};

/**
 *
 */
CrawlResult.prototype.setOutgoingCookies = function(result) {
	CrawlResult.checkBehaviorResult(result);
	this.outCookies = result.value;
	this._timings._loadCookies = result.time;
};

CrawlResult.prototype.setFetchResult = function (fetchResult) {
	// TODO: analyze redirect
	// TODO: merge timings
};
