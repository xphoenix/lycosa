var when = require('when'),
	matchers = require('./jasmine/matchers.js'),
	Crawler = require('../lib/Crawler.js'),
	HostSession = require('../lib/HostSession.js'),
	RequestScheduler = require('../lib/RequestScheduler.js'),
	dnsMock = require('./mock/dns-mock.js');

/*
 * Tests crawler in offline mode, just how methods are operates to control
 * basic crawler setup and logic
 */
// TODO: add tests for the corner cases, like calling behavior with a wrong name, e.t.c
describe('Crawler instance', function() {

	beforeEach(function(){
		this.addMatchers(matchers);
	});

});