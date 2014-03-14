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
 * + Measure in and out traffic
 *
 * Each request goes though predefined workflow, however each step of workflow user could
 * replace by the async function. In crawler context that functions are known as 'behaviors'
 * and has predefined format:
 *
 * 	function behavior(sequence, argument, callback);
 *
 * Where
 * +	**this**	 - instance of crawler that request operation;
 * +	**sequence** - string id of page fetching sequence initiated request;
 * +	**argument** - operation dependent argument, for example hostname;
 * +	**callback** - node.js style async callback: first argument is a error if any, second is
 * the result for a successful call;
 *
 * ## Workflow
 *
 * #### Stage 1 - cache lookup && gather information necessary for a request scheduling
 * Crawler is querying cache and also prepare request to be scheduled for download. That
 * is done, because in most cases even if page exists in the cache crawler will have to
 * do remote request for at cache validation. To not spend too much time we are doing
 * cache lookup and scheduler preparations in parallel.
 *
 * If cache responds with a page and no validation needs then workflow terminates here and
 * cached results returned.
 *
 * Behaviors are: **loadCachedPage**, **resolveHost** and **createSession**
 *
 * #### Stage 2 - prepare request and scheduler
 * Here crawler selects IP to use for the current request, updates host session statistic
 * requests for the scheduler and load cookies to be used. Once execution of that stage complete,
 * crawler pass request to the selected scheduler and awaits when request will be planned for execution
 *
 * Behaviors are: **createScheduler**
 *
 * #### Stage 3 - fetch
 * That steps comes when scheduler decides it is time to isse request for a remote peer. Here
 * crawler creates HTTP request and pass it to the remove server and receive response.
 *
 * Behaviors are: **fetch**
 *
 * #### Stage 4 - cache update
 * Results got from fetch behavior is saved into page cache along with received cookies.
 *
 * Behaviors are: **storePage** and **storeCookies**
 *
 * #### Stage 5 - redirect detection
 * If response was a redirect (exact semantics of 'redirect' is defined by fetch behavior) then
 * crawler generate new request, passes it to the start of workflow and awaits till new request
 * is done. Please note that sequenceid will not change, i.e new request will belongs to original
 * page fetching sequence
 *
 * ## Behaviors
 * TODO:
 *
 * @class Crawler
 * @constructor
 */
var Crawler = module.exports = function() {

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
	this.setup('loadCachedPage', noop);
	this.setup('storeCachedPage', noop);
	this.setup('disposeHostSession' ,noop);
	this.setup('disposeScheduler', noop);
	this.setup('fetchPageContent', noop);
	this.setup('storePageContent', noop);

	this.setup('resolveHost',function (seq, trace, callback) {
		dns.resolve4(trace.url.hostname, callback);

	this.setup('createHostSession',function (seq, trace, callback) {
	});
		callback(null, new HostSession(1000, {}));
	});

	this.setup('createScheduler',function (seq, trace, callback) {
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
		var u = urlutils.normalize(orig);
		u = url.parse(u, true);

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
				console.log(item.reason.stack);
				trace = WorkflowTrace.createForInternalError(urls[index], start, item.reason);
			} else {
				trace = item.value;
			}

			builder(result, trace);
		});
		return result;
	});
};

Crawler.prototype._createTrace = function(u, id, trace) {
	// Generate uniq request ID
	if (!id) {
		var hasher = crypto.createHash('sha1');
		hasher.update(u.href);
		id = hasher.digest('hex');
	}

	return new WorkflowTrace(id, u);
};

Crawler.prototype._attachTrace = function(id, trace) {
	if (!this._requests.hasOwnProperty(id)) {
		throw new Error("Given id doesn't exists: "+id);
	}
	this._requests[id].traces.push(trace);
};
/**
 * Executes crawler behavior
 *
 * That method is calling builtin crawler behavior and also measures execution time.
 * Returned value is a promise for a structure:
 *
 * 	{
 * 		value: (value, returned by behavior),
 * 		time: (time behavior took to complete)
 *  }
 *
 * @method behave
 * @param name {String} name of crawler behavior
 * @param seq {String} fetch sequence to call behavior for
 * @param arguments {Object} [optional] All other arguments to be passed to
 * behavior implementation
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
 * @method _prepare
 * @protected
 *
 * @param start {Number} timestamp of the request begin or null
 * @param ip {String} AP+ promise for IP or null
 * @param url {Object} Node.js url parse object
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
		trace.completePrepareStage();

		if (trace.hasErrors()) {
			// If there are logical errors - terminate request
			return trace;
		} else if (trace.hasCachedVersion()) {
			// Could we serve request from cache?
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
 * @param seq
 * @param result
 * @returns {String}
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
		if (trace.hasErrors()) {
			// If there are logical errors - terminate request
			trace._timings.scheduling.end = Date.now();
			return trace;
		} else if (trace.isReadyToBeFetched()){
			// If request is ready to be fetched - schedule it execution
			trace._timings.scheduling = {
					start: Date.now()
			};
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
 * @method _fetch
 * @param seq
 * @param result
 * @returns
 */
Crawler.prototype._fetch = function(trace) {
	var crawler = this;
	return this._behave('fetchPageContent', trace).then(function(fetchResult){
		// Setup value
		trace.setFetchResult(fetchResult);
		trace.completeFetchStage();

		// Propagate trace to the next workflow stage
		if (trace.hasErrors()) {
			return trace;
		} else {
			return crawler._complete(trace);
		}
	});
};

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
			// TODO: follow redirect if needs:
			// TODO: derive new Trace object, clear IP and cookies if
			// needs and call _prepare
		}
	});
};