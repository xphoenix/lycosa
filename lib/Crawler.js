var dns = require('dns'),
	nodefn = require("when/node/function"),

	HostSession = require('./HostSession.js'),
	RequestScheduler = require('./RequestScheduler.js'),
	TFactory = require('./tempo/TemporaryObjectFactory.js');

/**
 * Crawler
 *
 * Main crawler role is to ensure that request stream to external servers is conform with
 * general policies, i.e doesn't break robots.txt rules, respects crawl delays and not
 * generates to much request on an every single IP.
 *
 * Also crawler is trying to mimics usual HTTP client like a browser, i.e it follows redirects,
 * support cookies transmission protocols and might execute client side JavaScript (to be done)
 *
 * Along with that crawler generates some statistics about request stream, like:
 * + Tracks progress of all flight requests
 * + Manages hosts/ip crawl delays
 *
 * Each request goes though predefined workflow each step of it user could replace
 * by the async function. In crawler context that functions are called 'behaviors' and
 * has special format:
 *
 * 	function behavior(sequence, argument, callback);
 *
 * Where
 * +	**this**  - instance of crawler that request operation;
 * +	**sequence** - string id of page fetching sequence initiated request
 * +	**argument** - operation dependent argument, for example hostname;
 * +	**callback** - node.js style async callback: first argument is a error if any, second is
 *  the result for a successful call;
 *
 * Behavior implementation function result should always be a A+ promise even if behavior
 * implementation is synchronous.
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
	 * page fetch workflow.
	 *
	 * All functions has 'behavior' interface, but returns A+ promise for the
	 * structure:
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

	this.setup('resolveHost',function (seq, hostname, callback) {
		dns.resolve4(hostname, callback);
	});

	this.setup('createHostSession', function (seq, hostname, callback) {
		callback(null, new HostSession());
	});

	this.setup('disposeHostSession', function (seq, session, callback) {
		callback(null, session);
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

	// Create A+ wrapper around
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
	throw new Error("Not implemented yet");
};

/**
 * Crawl given by set of URLs and returns promise for a HAR
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
Crawler.prototype._schedule = function (seq, ip, url) {
	throw new Error("Not implemented yet");
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
 * @param argument {Object} [optional] argument for the behavior
 * @return A+ promise
 */
Crawler.prototype._behave = function(name, seq) {
	var start = Date.now();

	if (!this._behaviors.hasOwnProperty(name)) {
		throw new Error("Crawler has no behavior with given name: '"+name+"'");
	}

	var op = this._behaviors[name];
	if (op === false) {
		return when.resolve({time: 0, value: false});
	} else {
		return op.apply(this, Array.prototype.slice.call(arguments, 1)).then(function(result){
			return {
				value: result,
				time: Date.now() - start
			};
		});
	}
};