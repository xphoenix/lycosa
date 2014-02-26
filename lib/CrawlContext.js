/**
 * CrawlContext is state storage for a sequence of calls
 *
 * During page crawling crawler could issue many requests,
 * for example:
 * * Request robots.txt to create host session
 * * Redirects
 * * In page JavaScript redirect
 *
 * We'd like to see all that queries as sequence, i.e we'd like
 * to group all that queries in HAR under particular page. That
 * gives ability to trace WHY crawler issue query and WHEN it happens.
 *
 *
 * @class CrawlContext
 * @constructor
 */
var CrawlContext = module.exports = function(page) {
	/**
	 * HAR page ID. Each request made by crawler with current
	 * CrawlContext should be made on behalf of that page
	 *
	 * @property pageref
	 */
	this.pageref = null;

	/**
	 * Host session to use for request.
	 *
	 * During fetch sequence that field value could varay.
	 * However when particular request starts field must
	 * be either null or has correct value for the requested host
	 *
	 * @property session
	 */
	this.session = null;

	/**
	 * IP to use for query query.
	 *
	 * During fetch sequence that field value could varay.
	 * However when particular request starts field must
	 * be either null or has correct value for the requested host
	 *
	 * @property ip
	 */
	this.ip = null;

	/**
	 * IP scheduler to use for request.
	 *
	 * During fetch sequence that field value could varay.
	 * However when particular request starts field must
	 * be either null or has correct value for the requested host
	 *
	 * @property scheduler
	 */
	this.scheduler = null;

	/**
	 * Cookies to use for query query.
	 *
	 * All cookies for the sequence gets accomulated here. During
	 * the query crawler must carefuly select appropriate cookies
	 *
	 * @property cookies
	 */
	this.cookies = [];

	/**
	 * Crawl results for the sequence
	 * Each call should add results here after it has been done
	 *
	 * @property results
	 */
	this.results = [];
};

CrawlerContext.prototype.startRequest = function(url) {

};

CrawlerContext.prototype.endRequest = function(fetchResult) {

};