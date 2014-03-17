var HostSession = require('./HostSession.js'),
	RequestScheduler = require('./RequestScheduler.js');

/**
 *
 *
 * @class CrawlerWorkflowTrace
 * @constructor
 */
var CrawlerWorkflowTrace = module.exports = function(id, url, start) {
	if (id === undefined || id === null) {
		 throw new Error("Id must be set");
	} else if (url === undefined || url === null) {
		 throw new Error("URL must be set");
	};

	/**
	 * Uniq page id
	 *
	 * @property id
	 * @type String
	 */
	this.id = id;

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
	 *
	 * @property request
	 * @type Object
	 */
	this.request = {

	};

	/**
	 *
	 * @property response
	 * @type Object
	 */
	this.response = {

	};

	/**
	 *
	 * @property content
	 * @type Object
	 */
	this.content = {
		origSize: 0,
		realSize: 0,
		data: null
	};

	/**
	 *
	 * @property processed
	 * @type Object
	 */
	this.processed = false;


	/**
	 *
	 * @property _errors
	 * @type Array of Error
	 */
	this._errors = [];

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
};

/**
 * Creates new CrawlerWorkflowTrace represents error page for the
 * internal Crawler error
 *
 * @method createForInternalError
 * @return CrawlResult
 */
CrawlerWorkflowTrace.createForInternalError = function(url, start, error) {
	var result = new CrawlerWorkflowTrace(start, url);
	result._error = error.toString();
	result._stack = error.stack;

	result._timings.dns = 0;
	result._timings.receive = 0;
	result._timings.blocked = Date.now() - start;
	return result;
};

/**
 * Returns true if crawl result has error
 *
 * @method isError
 * @returns {Boolean}
 */
CrawlerWorkflowTrace.prototype.hasErrors = function() {
	return this._errors.length > 0;
};

CrawlerWorkflowTrace.prototype.setInternalError = function(error) {
	this._errors.push(error.stack);
};

CrawlerWorkflowTrace.prototype.hasCachedVersion = function() {
	return false;
};

CrawlerWorkflowTrace.prototype.isRedirect = function() {
	return false;
};

CrawlerWorkflowTrace.prototype.getRedirectTarget = function() {
	return false;
};

CrawlerWorkflowTrace.prototype.isPageCacheUpdateNeeds = function() {
	return false;
};

/**
 *
 * @method setResolveResult
 * @param result {Object} result of Crawler#resolveHost behavior
 */
CrawlerWorkflowTrace.prototype.setResolveResult = function(result) {
	// TODO: Check format
	this._ipList = result;
};

/**
 *
 * @method setCacheResult
 * @param result {Object} result of Crawler#loadCacheState behavior result
 */
CrawlerWorkflowTrace.prototype.setCacheLoadResult = function(result) {
	// TODO: implement cache
};

/**
 *
 * @method setCacheResult
 * @param result {Object} result of Crawler#loadCacheState behavior result
 */
CrawlerWorkflowTrace.prototype.setSessionCreateResult = function(result) {
	if (result !== null && !(result instanceof HostSession)) {
		throw new Error("Session has wrong type");
	}
	this._session = result;
};

CrawlerWorkflowTrace.prototype.completePrepareStage = function() {
	if (!this._session) {
		this._errors.push(new Error("Wrong value for the host session: "+this._session));
	} else if (!this._scheduler) {
		this._errors.push(new Error("Wrong value for the request scheduler: "+this._scheduler));
	} else if (!this._ipList) {
		this._errors.push(new Error("Wrong value for the ip list: "+this._ipList));
	}

	this.ip = this._session.selectIp(this._ipList);
	return true;
};

/**
 *
 * @returns {Boolean}
 */
CrawlerWorkflowTrace.prototype.isReadyToBeScheduled = function() {
	return !this.hasError() && this.ip;
};

/**
*
* @method setRequestScheduler
* @param result {Object} result of Crawler#loadCacheState behavior result
*/
CrawlerWorkflowTrace.prototype.setRequestScheduler = function(result) {
	if (result !== null && !(result instanceof RequestScheduler)) {
		throw new Error("Scheduler has wrong type");
	}
	this._scheduler = result;
};

CrawlerWorkflowTrace.prototype.completeSchedulingStage = function() {

};

CrawlerWorkflowTrace.prototype.isReadyToBeFetched = function() {
	return !this.hasError() && this.ip && this._scheduler;
};

CrawlerWorkflowTrace.prototype.setFetchResult = function (fetchResult) {
	// TODO: analyze redirect
	// TODO: merge timings
};

CrawlerWorkflowTrace.prototype.completeFetchStage = function() {
	// TODO: Merge & analyse caching headers
};