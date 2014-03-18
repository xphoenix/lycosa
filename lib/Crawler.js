var dns = require('dns'),
	url = require('url'),
	crypto = require('crypto'),
	when = require('when'),
	nodefn = require('when/node/function'),
	urlutils = require('node-url-utils'),
	HostSession = require('./HostSession.js'),
	RequestScheduler = require('./RequestScheduler.js'),
	WorkflowTrace = require('./CrawlerWorkflowTrace.js'),
	TFactory = require('./tempo/TemporaryObjectFactory.js');

/**
 * Crawler
 *
 * Main crawler role is to ensure that requests stream to external servers is conform with
 * general crawling policies, i.e doesn't break robots.txt rules, respects crawl delays and not
 * generates to much request on an every single IP.
 *
 * Also crawler is trying to mimics usual HTTP client like a browser, i.e it follows redirects,
 * support cookies transmission protocols and might execute client side JavaScript (to be done)
 *
 * Along with that crawler generates some statistics about request stream, for example:
 * + Tracks progress of all in-flight requests and its status
 * + Calculates statistics per host and per IP
 * + Measures in and out traffic
 *
 * Each request goes though predefined workflow, however each step of workflow user could
 * replace by the async function. In crawler context that functions are known as 'behaviors'
 * and has predefined format:
 *
 * 	function behavior(trace, callback);
 *
 * Where
 * +	**this**	 - instance of crawler that request operation;
 * +	**trace**    - object stores context of workflow execution
 * +	**callback** - node.js style async callback: first argument is a error if any, second is
 * the result for a successful call;
 *
 * @class Crawler
 * @constructor
 */
var Crawler = module.exports = function() {

	/**
	 *
	 * @property userAgent
	 * @type String
	 */
	this.userAgent = 'Mozilla/5.0 (compatible; jsbot/0.1; +http://jsbot.com/bot.html)';

	/**
	 * Named behaviors to be used by crawler on different stages of
	 * page fetching workflow.
	 *
	 * All functions below has 'behavior' interface, but returns A+ promise for the
	 * structure and has binded this pointer:
	 * 	{
	 * 		time: time taken by behavior to complete
	 * 		value: value, returned by behavior implementation
	 * 	}
	 *
	 * See setup method
	 *
	 * @property _behaviors
	 * @protected
	 * @type Object
	 */
	this._behaviors = {
		resolveHost: false,
		createHostSession: false,
		disposeHostSession: false,
		createScheduler: false,
		disposeScheduler: false,
		loadCachedPage: false,
		storeCachedPage: false,
		storePageContent: false,
		fetchPageContent: false
	};

	var noop = function(trace, callback) {
		callback(null, false);
	};

	// TODO: Caching functions.
	this.setup('loadCachedPage', noop);
	this.setup('storeCachedPage', noop);
	this.setup('fetchPageContent', noop);
	this.setup('storePageContent', noop);
	this.setup('disposeHostSession', noop);
	this.setup('disposeScheduler', noop);

	this.setup('resolveHost',function (trace, callback) {
		dns.resolve4(trace.url.hostname, callback);
	});

	this.setup('createHostSession',function (trace, callback) {
		callback(null, new HostSession(1000, {}));
	});

	this.setup('createScheduler',function (trace, callback) {
		callback(null, new RequestScheduler(500, 4));
	});

	/**
	 * Infligh requests we are processing right now.
	 *
	 * Scheduling algorithm is using that set to ensure that crawler does not fetch
	 * same pages in parallel
	 *
	 * @property _requests
	 * @type Object
	 */
	this._requests = {};

	/**
	 * Caching factory for the request schedulers
	 *
	 * That is caching factory of schedulers serving individual IPs.
	 * Each time crawler would like to make a request for a particular IP,
	 * a such request must be registered in the appropriate scheduler.
	 *
	 * Scheduler ensures that crawler do not overflow remote peers by high
	 * request frequency.
	 *
	 * Scheduler is planned for removal once last request is done. Please note
	 * scheduler gets destroyed after timeout. That ensures we do not create
	 * & destroy scheduler for the same IP too frequently and also is a part of
	 * throttling logic, see Crawler scheduling notes.
	 *
	 * @property _schedules
	 * @type Object
	 */
	this._schedulers = new TFactory(
		this._behave.bind(this, 'createScheduler'),
		this._behave.bind(this, 'disposeScheduler')
	);

	/**
	 * Caching factory for the host sessions
	 *
	 * That is caching factory of host sessions which are tracks host
	 * specific information shared across all request such as robots rules,
	 * crawl delay, IP select policy, e.t.c.
	 *
	 * Session is planned for removal once last request is done. Please note
	 * sessions are get destroyed after timeout. That ensures we do not create
	 * & destroy sessions for the same host too frequently and also is a part of
	 * throttling logic, see Crawler scheduling notes.
	 *
	 * @property _sessions
	 * @type Object
	 */
	this._sessions = new TFactory(
		this._behave.bind(this, 'createHostSession'),
		this._behave.bind(this, 'disposeHostSession')
	);
};

/**
 * Set Crawler behavior implementation
 *
 * <p> Each provided implementation much comes in form of standard
 * node.js async function, i.e last argument is a callback accepts
 * two parameters where first one is error if any.
 * </p>
 *
 * @example
 *  Crawler c = new Crawler();
 *  c.setup('resolveHost', function(sequence, host, resolveCallback){
 *		// this === crawler calls that behavior
 *  });
 *
 * @method setup
 * @param {Function} impl behavior implementation
 * @throws Error if crawler has no behavior with given name
 */
Crawler.prototype.setup = function(name, impl) {
	if (!this._behaviors.hasOwnProperty(name)) {
		throw new Error("Crawler doesn't have behaviour with name: '"+name+"'");
	}

	// Create A+ promise wrapper around
	this._behaviors[name] = nodefn.lift(impl);
};


/**
 * Crawl given by set of URLs and returns promise for a HAR
 * archive with information about given set
 *
 * That is a general purpose method. All URLs are get split into groups
 * of hosts which will be resolved. After resolving URLs are scheduled
 * in the normal way
 *
 * Please note that URLs will be normalized as a part of crawling process
 *
 * @method crawl
 * @param {Array} String array with urls to crawl
 * @param {Function} [optional] builder transforms Workflow context to client result
 */
Crawler.prototype.crawl = function(urls, builder) {
	var promises = [], dns_cache = {}, start = Date.now(), self = this;

	// Add all requests to crawler, however we gonna be carefull and
	// not add requests that are already in work. Even if two same
	//
	// Also we don't want to issue too much DNS requests, so lets run
	// dns work first and cache promises
	//
	// URLs arrived in call arguments
	urls.forEach(function(orig){
		// Before generating uniq ID we must be sure that URL is in
		// canonical form, i.e relative paths decoded, hashbangs resolved,
		// hostname is in punny code and so on. That is needs to ensure we
		// will generate same uniq id for URLs that represents same request
		// in different forms
		var u = this._parseUrl(orig);

		// Generate uniq request ID
		var hasher = crypto.createHash('sha1');
		hasher.update(u.href);

		// Check if we have same page in progress already
		var id = hasher.digest('hex');
		if (!this._requests.hasOwnProperty(id)) {
			// Build trace for a new request
			var trace = this._createTrace(u, id);

			// check do we have DNS request already or no
			var ip;
			if (dns_cache.hasOwnProperty(u.hostname)) {
				ip = dns_cache[u.hostname];
			} else {
				dns_cache[u.hostname] = ip = this._behave('resolveHost', trace);
			}

			// Register request
			this._requests[id] = {
					promise: this._prepare(trace, ip).then(function(){
						var result = self._requests[id].traces;
						return result;
					}).ensure(function(){
						delete self._requests[id];
					}),
					traces: [trace]
			};
		}

		promises.push(this._requests[id].promise);
	}, this);

	// Return promise to execute everything
	builder = builder || require('./defaults/ResultBuilder.js');
	return when.settle(promises).then(function(values){
		var result = {};
		values.forEach(function(item, index) {
			var trace;
			if (item.state === 'rejected') {
				trace = WorkflowTrace.createForInternalError(urls[index], start, item.reason);
			} else {
				trace = item.value;
			}

			builder(result, trace);
		});
		return result;
	});
};

/**
 * Parse given URL and ensures all crawler requirements, such are
 *
 * + Hashbangs expansion
 * + Normalization
 * + Query string parsing
 *
 * @protected
 * @method _parseUrl
 * @param {String} url string representation to be parsed
 * @returns {Object} parsed url object in node.js format
 */
Crawler.prototype._parseUrl = function(orig) {
	var u = urlutils.normalize(orig);
	// TODO: Hashbang extension
	return url.parse(u, true);
};

/**
 *
 *
 * @protected
 * @method _crateTarce
 * @param {Object} u url object to create trace for
 * @param {String} [optiona] id uniq trace id
 */
Crawler.prototype._createTrace = function(u, id) {
	// Generate uniq request ID
	if (!id) {
		var hasher = crypto.createHash('sha1');
		hasher.update(u.href);
		id = hasher.digest('hex');
	}

	var result = new WorkflowTrace(id, u);
    result.request['user-agent'] = this.userAgent;
    result.request['accept'] = '*/*';
    result.request['accept-language'] = 'en-us;q=0.7,en;q=0.3';
    result.request['accept-charset'] = 'ISO-8859-1,utf-8;q=0.7,*;q=0.7';
	return result;
};

/**
 *
 * @protected
 * @method _attachTrace
 * @param {String} id
 * @param {Object} trace
 */
Crawler.prototype._attachTrace = function(id, trace) {
	if (!this._requests.hasOwnProperty(id)) {
		throw new Error("Given id doesn't exists: "+id);
	} else if (!(trace instanceof WorkflowTrace)) {
		throw new Error("Trace should be an instance of CrawlerWorkflowTrace class: "+trace);
	}
	this._requests[id].traces.push(trace);
};

/**
 * Executes crawler behavior
 *
 * That method is calling builtin crawler behavior and also measures execution time. Returned value
 * is a promise for a behavior result. Along with that given trace object's timings structure will
 * be populated with start & end timestamps for a behavior call
 *
 * @protected
 * @method _behave
 * @param {String} name of behavior to execute
 * @param {Object} trace workflow to execute behavior for
 * @return A+ promise for result
 * @throws Error if there is no behavior with the given name
 */
Crawler.prototype._behave = function(name, trace) {
	if (trace !== null && !(trace instanceof WorkflowTrace)) {
		throw new Error("Trace object must be an instanceof CrawlerWorkflowTrace class: "+trace);
	} else if (!this._behaviors.hasOwnProperty(name)) {
		throw new Error("Crawler has no behavior with given name: '"+name+"'");
	}

	// Setup behavior start time
	if (trace !== null) {
		trace._timings[name] = {
				start: Date.now()
		};
	}

	var op = this._behaviors[name], promise;
	if (op === false) {
		// If there is no behavior - reject request
		promise = when.reject(new Error("Behavior '"+name+"' is not set"));
	} else {
		// Call behavior function, don't forget to bind crawler and pass all
		// arguments
		promise = op.apply(this, Array.prototype.slice.call(arguments, 1)).then(function(result){
			return result;
		});
	}

	// Record execution time
	return (trace === null ? promise : promise.ensure(function(){
		trace._timings[name].end = Date.now();
	}));
};

/**
 *
 * @protected
 * @method _prepare
 * @param {Object} trace
 * @param {String} ip
 * @param {Object} cached
 * @param {Object} session
 * @return A+ promise for the CrawlerWorkflowTrace
 */
Crawler.prototype._prepare = function (trace, ip, cached, session) {
	// Start async jobs
	ip = ip || this._behave('resolveHost', trace);
	cached = cached || this._behave('loadCachedPage', trace);
	session = session || this._sessions.get(1000, trace.url.hostname, trace);

	// Return promise.
	//Register
	// If any of steps fails then whole sequence has no sense anymore. Crawler treats
	// any internal error as a critical bug that stops query execution because we'd like
	// to be sure about logic consistency
	var crawler = this;
	return when.join(ip, cached, session).then(function(results){
		// Setup all values
		trace.setResolveResult(results[0]);
		trace.setCacheLoadResult(results[1]);
		trace.setSessionCreateResult(results[2]);

		// Now we have session and are able to complete request
		// populating it with known cookies
		var cookies = results[2].cookiejar.getCookiesSync(trace.url);
		trace.request['cookie'] = cookies.join(',');

		// Complete request preparation, i.e setup all default values if needs,
		// generating all logical errors if any, e.t.c
		//
		// and route workflow to the next stage
		trace.completePrepareStage();
		if (trace.hasErrors()) {
			// If there are logical errors - terminate request
			return trace;
		} else if (trace.hasCachedVersion()) {
			// TODO: Cache implementation
			return trace;
		} else if (trace.isReadyToBeScheduled()){
			// If we have enough information to schedule request &
			// there is no cached version (or we need to ensure cache)
			// then plan request execution
			return crawler._schedule(trace);
		} else {
			// Should never happens and added just to make system of conditions to
			// be full & complete
			trace.setInternalError(new Error("Unexpected _prepare stage error"));
			return trace;
		}
	}).ensure(function(){
		// After request has been complete on that stage, we need to ensure we schedule
		// session deletition if current request was the last one
		session.then(function(sr){
			if (sr.isEmpty()) {
				crawler._sessions.destroy(trace.url.hostname, session);
			}
		});
	});
};

/**
 * Request scheduling stage.
 *
 * On that stage we know all information about request and ready to start it scheduling.
 *
 * @protected
 * @method _schedule
 * @param {Object} trace
 */
Crawler.prototype._schedule = function(trace) {
	// Wait for async operations to complete. If anything fails,
	// then whole sequence is failed
	var crawler = this;
	return this._schedulers.get(500, trace.ip, trace).then(function(scheduler) {
		// Setup values
		trace.setRequestScheduler(scheduler);
		trace.completeSchedulingStage();

		// Propagate trace to the next workflow stage
		trace._timings.scheduling = {
				start: Date.now()
		};
		if (trace.hasErrors()) {
			// If there are logical errors - terminate request
			trace._timings.scheduling.end = Date.now();
			return trace;
		} else if (trace.isReadyToBeFetched()){
			// If request is ready to be fetched - schedule it execution
			return scheduler.schedule(trace._session, trace.url).then(function(time){
				trace._timings.scheduling.end = Date.now();
				return crawler._fetch(trace);
			}, function(errpr){
				trace._timings.scheduling.end = Date.now();
			}).ensure(function(){
				trace._session.requestEnd();
				trace._scheduler.requestEnd();

				if (trace._scheduler.isEmpty()) {
					crawler._schedulers.destroy(trace.ip, scheduler);
				}
			});
		} else {
			// Should never happens and added just to make system of conditions to
			// be full & complete
			trace.setInternalError(new Error("Unexpected _schedule stage error"));
			return trace;
		}
	});
};

/**
 * Request fetch & post processing stages
 *
 * @protected
 * @method _fetch
 * @param {Object} trace
 * @returns
 */
Crawler.prototype._fetch = function(trace) {
	var crawler = this;
	return this._behave('fetchPageContent', trace).then(function(fetchResult){
		// Setup value
		trace.setFetchResult(fetchResult);

		// Save all known cookies
		var cookies = (fetchResult ? fetchResult.response['set-cookie'] : []);
		cookies.forEach(function (c){
			trace._session.cookiejar.setCookieSync(c, trace.url);
		});

		// Propagate trace to the next workflow stage
		trace.completeFetchStage();
		if (trace.hasErrors()) {
			return trace;
		} else {
			return crawler._complete(trace);
		}
	});
};

/**
 *
 * @protected
 * @method _complete
 * @param {Object} trace
 */
Crawler.prototype._complete = function(trace) {
	var storeContent = this._behave('storePageContent', trace),
		cacheUpdate = false;

	// If it is needs lets update HTTP cache page info
	if (trace.isPageCacheUpdateNeeds()) {
		cacheUpdate = this._behave('storeCachedPage', trace);
	}

	//
	var crawler = this;
	return when.join(storeContent, cacheUpdate).then(function(){
		if (trace.isRedirect()) {
			var source = trace.url, target = trace.getRedirectTarget();
			target = crawler._parseUrl(target);

			// Build a new trace, attach it as a part of current crawling sequence.
			// That will allows us to trace whole sequence later
			var rtrace = crawler._createTrace(target, null, trace);
			crawler._attachTrace(trace.id, rtrace);

			// Then copy as much info as we could and route new trace to the appropriate
			// workflow step and skip as much work as we could
			var ipList = false, session = false;
			if (source.hostname === target.hostname) {
				// If host name ARE the same then we could reuse
				// 1. Session
				// 2. Resolver results
				// 3. cookies
				//
				// i.e it is not possible to skip entire  _prepare step, as we can't guess
				// cache results. Also as session could decide to use a different IP for the
				// request, so that is not possible to reuse _schedule stage results.
				//
				// Because of internal caching mechanism _scheduler step WILL reuse scheduler
				// in case of same IP selected for the new trace
				ipList = trace._ipList;
				session = trace._session;
			};
			return crawler._prepare(rtrace, ipList, false, session);
		};
		// NO return as result of sequence crawl is stored in the global requests
		// cache
	});
};