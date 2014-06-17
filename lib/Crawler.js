var _ = require('lodash'),
	dns = require('dns'),
	url = require('url'),
	util = require('util'),
	crypto = require('crypto'),
	Logger = require('bunyan'),
	when = require('when'),
	nodefn = require('when/node/function'),
	urlutils = require('node-url-utils'),
	HostSession = require('./HostSession.js'),
	RequestScheduler = require('./RequestScheduler.js'),
	WorkflowError = require('./WorkflowError.js'),
	WorkflowTrace = require('./WorkflowTrace.js'),
	TFactory = require('./tempo/TemporaryObjectFactory.js'),
	DefaultResultBuilder = require('./defaults/ResultBuilder.js'),
	DefaultFetchPageContent = require('./defaults/FetchPageContent.js');

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
var Crawler = module.exports = function(opts) {

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
		loadCookies: false,
		storeCookies: false,
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
	this.setup('loadCookies', noop);
	this.setup('storeCookies', noop);
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

	this.setup('fetchPageContent', DefaultFetchPageContent);

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

	/**
	 * Default values for the WorkflowTrace object
	 *
	 * @property defaults
	 * @type Object
	 */
	this.defaults = {
		// default request headers
		request: {
			'accept': '*/*',
			'accept-language': 'en-us;q=0.7,en;q=0.3',
			'accept-charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.7',
			'user-agent': 'Mozilla/5.0 (compatible; jsbot/0.1; +http://jsbot.com/bot.html)'
		},

		// Maximum document size in bytes, that is the hard limit of bytes
		// to be stored in the cache
		fetchLimit: 5 * 1024 * 1024,

		// Additional content processors. That is a function called
		// by the fetcher to create content procession streams
		_processors: null,
	};

	this.log = (opts && opts.log) || new Logger({name: 'Crawler'});
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
Crawler.prototype.crawl = function(urls, opts) {
	var promises = [], dns_cache = {}, topts = _.omit(opts, ['builder']);

	// Add all requests to crawler. There are two ways how we could get duplicated
	// queries:
	// 1. Someone put two equal URLs in array
	// 2. Two URLs become equals during normalization process
	//----------------------------------------------------------------------
	// Note: URLs are equals if AFTER normalization String equalent of URLs
	// are the same with respect to characters case
	//----------------------------------------------------------------------
	//
	// Instead of separate that two cases we just check that we do not execute
	// similar URLs after normalization (see _execute method). That could leads us
	// to situation when we are passing more promises then required to join method, i.e
	// we pass same promise more then once. However it is worth to allow that situation and
	// return client exactrly the same number of results as a number of requests.
	urls.forEach(function(orig){
		// Parse method should take care of URL normalization here.
		//
		// We generate more traces then it is needs, however as all trace fields calculations are
		// "lazy" we expirience just a bit more memory allocations then it is needs. However as
		// allocations are happen in young generation that should be fine.
		var u = this._parseUrl(orig);
		var trace = this._createTrace(u, topts);

		// check do we have DNS request already or no
		if (dns_cache.hasOwnProperty(u.hostname)) {
			trace.ip = dns_cache[u.hostname];
		} else {
			dns_cache[u.hostname] = trace.ip = this._behave('resolveHost', trace);
		}

		// Start new trace execution OR get exiting promise
		promises.push(this._execute(trace));
	}, this);

	// Return promise to execute everything
	builder = (opts && opts.builder || DefaultResultBuilder);
	return when.settle(promises).then(function(values){
		var result = {};
		values.forEach(function(item, index) {
			var traces;
			if (item.state === 'rejected') {
				traces = [WorkflowTrace.createForInternalError(
						"unknown",
						urls[index],
						-1,
						item.reason
				)];
			} else {
				traces = item.value;
			}

			builder(result, traces);
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
Crawler.prototype._createTrace = function(u, opts, id) {
	// Generate uniq request ID
	if (!id) {
		var hasher = crypto.createHash('sha1');
		hasher.update(u.href);
		id = hasher.digest('hex');
	}

	var result = new WorkflowTrace(id, u);
	_.assign(result, opts);
	_.merge(result, this.defaults, _.defaults);
	result.log = result.log || this.log;
	result.log = result.log.child({tid: id});
	return result;
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
* @param trace
*/
Crawler.prototype._execute = function(trace) {
	// We already has the same trace
	if (this._requests.hasOwnProperty(trace.id)) {
		return this._requests[trace.id];
	}

	// Promise for a crawling sequence
	var self = this;
	var promise = this._requests[trace.id] = this._prepare(trace)
	.then(this._init.bind(this))
	.then(this._schedule.bind(this))
	.then(this._complete.bind(this))
	.otherwise(function(error){
		trace.addGenericError(error);
		return [trace];
	})
	.ensure(function(){
		delete self._requests[trace.id];
	});

	return promise;
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
Crawler.prototype._prepare = function (trace) {
	// Start async jobs
	ip = trace.ip || this._behave('resolveHost', trace);
	cached = trace.cached || this._behave('loadCachedPage', trace);
	session = trace._session || this._sessions.get(1000, trace.url.hostname, trace);

	// Return promise.
	//Register
	// If any of steps fails then whole sequence has no sense anymore. Crawler treats
	// any internal error as a critical bug that stops query execution because we'd like
	// to be sure about logic consistency
	var crawler = this;
	trace.log.debug('prepare');
	return when.join(ip, cached, session).then(function(results){
		// Setup all values
		trace.setResolveResult(results[0]);
		trace.setCacheLoadResult(results[1]);
		trace.setSessionCreateResult(results[2]);

		// Complete request preparation, i.e setup all default values if needs,
		// generating all logical errors if any, e.t.c
		//
		// and route workflow to the next stage
		trace.completePrepareStage();
		return trace;
	}).ensure(function(){
		// After request has been complete on that stage, we need to ensure we schedule
		// session removal if this request was the last one
		when(session).then(function(result){
			if (result.isEmpty()) {
				crawler._sessions.destroy(trace.url.hostname, result);
			}
		});
	});
};

/**
 * Create all necessery resources, such as:
 * 1. Fetch cookies
 * 2. Create scheduler
 *
 * @protected
 * @method _init
 * @param {Object} trace
 */
Crawler.prototype._init = function(trace) {
	var scheduler = this._schedulers.get(500, trace.ip, trace),
		cookies = this._behave('loadCookies', trace),
		crawler = this;

	trace.log.debug('init');
	return when.join(scheduler, cookies).then(function(results){
		trace.setRequestScheduler(results[0]);
		trace.setCookies(results[1]);

		trace.completeSchedulingStage();
		return trace;
	}).ensure(function(){
		if (trace._scheduler.isEmpty()) {
			crawler._schedulers.destroy(trace.ip, scheduler);
		}
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
	var crawler = this;
	trace.log.debug('schedule');
	return trace._scheduler.schedule(trace._session, trace.url).then(function(time){
		trace._timings.scheduling = time;
		// fetchPageContent behaviour gets called here as we'd like to be sure that
		// requestEnd will be called in appropriate time, so we need to "wrap" fetch
		// promise
		trace.log.info('fetch '+trace.url.href);
		return crawler._behave('fetchPageContent', trace).then(function(fetchResult){
			// Setup value
			trace.setFetchResult(fetchResult);
			trace.completeFetchStage();
			return trace;
		});
	}).ensure(function(){
		trace._session.requestEnd();
		trace._scheduler.requestEnd();
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
		storeCookies = this._behave('storeCookies', trace),
		cacheUpdate = this._behave('storeCachedPage', trace),
		crawler = this;

	trace.log.debug({trace: trace}, 'complete');
	return when.join(storeContent, storeCookies, cacheUpdate).then(function(){
		if (trace.isRedirect()) {
			// WorkflowTrace should takes care of relative URLs
			var target = trace.getRedirectTarget();
			target = crawler._parseUrl(target);

			// Build a new trace and inherite as much current trace properties
			// as it possible to not outperform expensive operations like
			// Session/Scheduler creation or DNS lookup
			var rtrace = crawler._createTrace(target), source = trace.url;
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
				rtrace._ipList = trace._ipList;
				rtrace._session = trace._session;
			};

			// Here we pass newely create trace to begin of workflow. That allows to check
			// if we already have that URL running.
			//
			// TODO: Current URL equals test has some minor issues, i.e:
			// 1. We do not check cookies - only URLs are equal. However different cookies
			//    could leads to different results
			// 2. No IP check. It is a question could different IPs leads to different results
			// 3. ?
			return crawler._execute(rtrace).then(function(sequence){
				// We don't want to change array "sequence" as it could be passed around to many
				// promise listeners
				return [trace].concat(sequence);
			}, function(sequence){
				// We don't want to change array "sequence" as it could be passed around to many
				// promise listeners
				return [trace].concat(sequence);
			});
		};
		return [trace];
	});
};