var dns = require('dns'),
	url = require('url'),
	crypto = require('crypto'),
	when = require('when'),
	nodefn = require('when/node/function'),
	urlutils = require('node-url-utils'),
	HostSession = require('./HostSession.js'),
	RequestScheduler = require('./RequestScheduler.js'),
	CrawlResult = require('./CrawlResult.js'),
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
 * Here crawler selects IP to use for the current request, updates host session statistics,
 * requests for the scheduler and load cookies to be used. Once execution of that stage complete,
 * crawler pass request to the selected scheduler and awaits when request will be planned for execution
 *
 * Behaviors are: **createScheduler** and **loadCookies**.
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
		storePage: false,
		loadCookies: false,
		storeCookie: false,
		fetchPage: false
	};

	var noop = function(seq, arg, callback) {
		callback(null, false);
	};
	this.setup('loadCachedPage', noop);
	this.setup('disposeHostSession' ,noop);
	this.setup('disposeScheduler', noop);
	this.setup('loadCookies', noop);
	this.setup('fetchPage', noop);

	this.setup('resolveHost',function (seq, hostname, callback) {
		dns.resolve4(hostname, callback);
	});

	this.setup('createHostSession',function (seq, hostname, callback) {
		callback(null, new HostSession(1000, {}));
	});

	this.setup('createScheduler',function (seq, ip, callback) {
		callback(null, new RequestScheduler(500, 4));
	});

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
Crawler.prototype.crawl = function(urls) {
	var promises = [], dns_cache = {}, start = Date.now();

	// Add all requests to crawler, however we gonna be carefull and
	// not add requests that are already in work. Even if two same
	//
	// Also we don't want to issue too much DNS requests, so lets run
	// dns work first and cache promises
	//
	// URLs arrived in call arguments
	urls.forEach(function(orig){
		// Before generating uniq ID we must be sure that URL are in
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
			// check do we have DNS request already or no
			var ip;
			if (dns_cache.hasOwnProperty(u.hostname)) {
				ip = dns_cache[u.hostname];
			} else {
				dns_cache[u.hostname] = ip = this._behave('resolveHost', id, u.hostname);
			}

			// Plan request
			this._requests[id] = this._prepare(start, id, ip, u);

			// don't forget to cleanup resources
			this._requests[id].ensure(function(){
				delete self._requests[id];
			});
		}

		promises.push(this._requests[id]);
	}, this);

	// Return promise to execute everything
	return when.settle(promises).then(function(values){
		var result = [];
		values.forEach(function(item, index) {
			if (item.state === 'rejected') {
				result.push(CrawlResult.createForInternalError(urls[index], start, item.reason));
			} else {
				result.push(item.value);
			}
		});
		return result;
	});
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
Crawler.prototype._behave = function(name, seq) {
	var start = Date.now();

	if (!this._behaviors.hasOwnProperty(name)) {
		throw new Error("Crawler has no behavior with given name: '"+name+"'");
	}

	var op = this._behaviors[name];
	if (op === false) {
		// If there is no behavior - reject request
		return when.reject(new Error("Behavior '"+name+"' is not set"));
	} else {
		// Call behavior function, don't forget to bind crawler and pass all
		// arguments
		return op.apply(this, Array.prototype.slice.call(arguments, 1)).then(function(result){
			return {
				value: result,
				time: Date.now() - start
			};
		});
	}
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
 * @return A+ promise for the result
 */
Crawler.prototype._prepare = function (start, seq, ip, url) {
	var result = new CrawlResult(url, start);

	// Start async jobs
	ip = ip || this._behave('resolveHost', seq, url.hostname);
	cached = this._behave('loadCachedPage', seq, url);
	session = this._sessions.get(1000, url.hostname, seq, url.hostname);

	// Return promise.
	//
	// If any of steps fails then whole sequence has no sense anymore
	var crawler = this;
	return when.join(ip, cached, session).then(function(results){
		// Setup all values
		result.setResolveResult(results[0]);
		result.setCacheLoadResult(results[1]);
		result.setSessionCreateResult(results[2]);
		result.setIpAddress(results[2].value.selectIp(results[0].value));

		// If it was an logic error during request processing
		if (result.isError()) {
			result.generateErrorPage();
			return result;
		}

		// Request could be continued
		return crawler._schedule(seq, results[2].value, result);
	}).ensure(function(_prepareResult){
		return session.then(function(sr){
			if (sr.value.isEmpty()) {
				crawler._sessions.destroy(url.hostname, seq, sr.value);
			}
			return _prepareResult;
		});
	});
};

/**
 * Request scheduling stage.
 *
 * On that stage we know all information about request and ready to start it scheduling.
 *
 * @param seq
 * @param session
 * @param result
 * @returns {String}
 */
Crawler.prototype._schedule = function(seq, session, result) {
	var scheduler = this._schedulers.get(500, result.ip, seq, result.ip),
		cookies = this._behave('loadCookies', seq, result.url);

	// Wait for async operations to complete. If anything fails,
	// then whole sequence is failed
	var crawler = this;
	return when.join(scheduler, cookies).then(function(values) {
		// Setup values
		result.setRequestScheduler(values[0]);
		result.setOutgoingCookies(values[1]);

		// Schedule request
		return values[0].value.schedule(session, result.url).then(function(time){
				result._timings.blocked = time;
				return crawler._fetch(seq, result);
		}).ensure(function(){
			session.requestEnd();
			values[0].value.requestEnd();
		});
	}).ensure(function(_scheduleResult){
		return scheduler.then(function(sr){
			if (sr.value.isEmpty()) {
				crawler._schedulers.destroy(result.ip, seq, sr.value);
			}
			return _scheduleResult;
		});
	});
};

Crawler.prototype._fetch = function(seq, result) {
	return this._behave('fetchPage', seq, result).then(function(fetchResult){
		result.setFetchResult(fetchResult);

		// TODO: update cache

		// TODO: update cookies

		if (result.isRedirect()) {
			// TODO: follow cookies
		}

		return result;
	});
};