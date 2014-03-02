/**
 * Keeps track of all request issued to particular IP
 *
 * Instance of that class is created by crawler for each particular IP.
 * Scheduler is responsible to ensure that crawler is following crawling
 * limits, i.e:
 *
 * 1. Not issue more the 2 requests per second for IP
 * 2. Follows each host crawl delay
 *
 * @class RequestScheduler
 * @constructor
 */
var RequestScheduler = module.exports = function() {

};