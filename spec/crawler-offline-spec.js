var when = require('when'),
	Crawler = require('../lib/Crawler.js'),
	dnsMock = require('./mock/dns.js');

/*
 * Tests crawler in offline mode, just how methods are operates to control
 * basic crawler setup and logic
 */
describe('Crawler instance', function(){
	var crawler = new Crawler();

	it('has default behavious implementation', function(){
		expect(crawler._createScheduler).toBeDefined();
		expect(crawler._fetchPage).toBeDefined();
		expect(crawler._resolveHost).toBeDefined();
		expect(crawler._createHostSession).toBeDefined();
		expect(crawler._loadCachedPage).toBe(false);
		expect(crawler._loadCookies).toBeDefined(false);
		expect(crawler._storeCookies).toBeDefined(false);
		expect(crawler._storePage).toBeDefined(false);

	});

	it('overrides default dns resolver', function(done){
		crawler.setup('resolveHost', dnsMock);
		expect(crawler._resolveHost).toBeDefined();

		var t1 = crawler._resolveHost('good.com').then(function(ip){
			expect(ip).toEqual({
				time: 1,
				value: '127.0.0.1'
			});
		});

		var t2 = crawler._resolveHost('bad.com').then(function(ip){
			expect(ip).toEqual({
				time: 2,
				value: ''
			});
		});

		when.join(t1, t2).then(function(){
			done();
		}).otherwise(done);
	});
});