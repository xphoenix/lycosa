var	Crawler = require('../lib/Crawler.js'),
	dnsMock = require('./mock/dns.js');

describe('Crawler instance', function(){
	var crawler = new Crawler();

	it('has operations default implementation', function(){
		expect(crawler._createScheduler).toBeDefined();
		expect(crawler._createSession).toBeDefined();
		expect(crawler._fetchPage).toBeDefined();
		expect(crawler._loadCachedPage).toBeDefined();
		expect(crawler._resolveHost).toBeDefined();
		expect(crawler._loadCookies).toBeDefined();
		expect(crawler._storeCookies).toBeDefined();
		expect(crawler._storePage).toBeDefined();

	});

	it('overrides default dns resolver', function(){
		crawler.setup('resolveHost', dnsMock);

		expect(crawler._resolveHost).toBeDefined();
		expect(crawler._resolveHost.original).toBe(dnsMock);
	});
});