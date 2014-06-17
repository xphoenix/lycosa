var WorkflowError = require('./WorkflowError.js'),
	HostSession = require('./HostSession.js'),
	RequestScheduler = require('./RequestScheduler.js');

/**
 *
 *
 * @class WorkflowTrace
 * @constructor
 */
var WorkflowTrace = module.exports = function(id, url, start) {
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
	 * Results of URL fetching if any
	 *
	 * @property response
	 * @type Object
	 */
	this.response = {

	};

	/**
	 * HostSession to be used for current URL fetching
	 *
	 * @protected
	 * @property _session
	 * @type Object
	 */
	this._session = false;

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

	/**
	 * Redirect from the response headers or processed section
	 *
	 * @protected
	 * @property _redirectLocation
	 * @type String
	 */
	this._redirectLocation = false;
};

/**
 * Creates new WorkflowTrace represents error page for the
 * internal Crawler error
 *
 * @method createForInternalError
 * @return CrawlResult
 */
WorkflowTrace.createForInternalError = function(id, url, start, error) {
	var result = new WorkflowTrace(id, url, start);
	result.addGenericError(error);
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
WorkflowTrace.prototype.hasErrors = function() {
	return this._errors.length > 0;
};

WorkflowTrace.prototype.addWorkflowError = function(code, error) {
	this.addGenericError(new WorkflowError(code, error));
};

WorkflowTrace.prototype.addGenericError = function(error) {
	this._errors.push(error);
};

WorkflowTrace.prototype.hasCachedVersion = function() {
	return false;
};

WorkflowTrace.prototype.isRedirect = function() {
	return this._redirectLocation !== false;
};

WorkflowTrace.prototype.getRedirectTarget = function() {
	return this._redirectLocation;
};

WorkflowTrace.prototype.isPageCacheUpdateNeeds = function() {
	return false;
};

/**
 *
 * @method setResolveResult
 * @param result {Object} result of Crawler#resolveHost behavior
 */
WorkflowTrace.prototype.setResolveResult = function(result) {
	if (!(result instanceof Array)) {
		// That is a general code error
		throw new Error("Host resolving result expected to be an array: "+result);
	}
	this._ipList = result;
};

/**
 *
 * @method setCacheResult
 * @param result {Object} result of Crawler#loadCacheState behavior result
 */
WorkflowTrace.prototype.setCacheLoadResult = function(result) {
	// TODO: implement cache
};

/**
 *
 * @method setCacheResult
 * @param result {Object} result of Crawler#loadCacheState behavior result
 */
WorkflowTrace.prototype.setSessionCreateResult = function(result) {
	if (result !== null && !(result instanceof HostSession)) {
		throw new Error("Session has wrong type");
	}
	this._session = result;
};

/**
 * Complete request prepareation.
 *
 * If that step completes without error crawler is able to fetch request
 *
 * @method completePrepareStage
 */
WorkflowTrace.prototype.completePrepareStage = function() {
	if (!this._session || !(this._session instanceof HostSession)) {
		throw new Error("Wrong value for the host session: "+this._session);
	} else if (!this._ipList) {
		throw new new Error("Wrong value for the ip list: "+this._ipList);
	}

	this.ip = this._session.selectIp(this._ipList);
	if (!this.ip && !this.hasCachedVersion()) {
		this.addWorkflowError(-7, "No IP to fetch page from");
	}
};

/**
 *
 * @returns {Boolean}
 */
WorkflowTrace.prototype.isReadyToBeScheduled = function() {
	return !this.hasErrors() && this.ip;
};

/**
*
* @method setRequestScheduler
* @param result {Object} result of Crawler#loadCacheState behavior result
*/
WorkflowTrace.prototype.setRequestScheduler = function(result) {
	if (result !== null && !(result instanceof RequestScheduler)) {
		throw new Error("Scheduler has wrong type");
	}
	this._scheduler = result;
};

/**
 * Complete scheduling stage
 *
 * If that step completes without errors then crawler is ready to
 * schedule request from the trace for execution
 *
 * @method completeSchedulingStage
 */
WorkflowTrace.prototype.completeSchedulingStage = function() {
	if (!this.ip || !this._scheduler) {
		this.addWorkflowError(-8, "There is no enough information for the request scheduling");
	}
};

WorkflowTrace.prototype.isReadyToBeFetched = function() {
	return !this.hasErrors() && this.ip && this._scheduler;
};

WorkflowTrace.prototype.setCookies = function (cookies) {

};

WorkflowTrace.prototype.setFetchResult = function (fetchResult) {
	// TODO: check fetchResult format
	this.response = fetchResult;

	// Analyse redirect
	if (fetchResult.status == 301 || fetchResult.status == 302) {
		this._redirectLocation = fetchResult.headers['location'];
	} else if (fetchResult.processed && fetchResult.processed.redirect) {
		this._redirectLocation = fetchResult.processed.redirect;
	}
};

WorkflowTrace.prototype.completeFetchStage = function() {
	// TODO: Merge & analyse caching headers
};