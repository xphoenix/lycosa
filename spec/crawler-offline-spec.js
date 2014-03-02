var when = require('when'),
	Crawler = require('../lib/Crawler.js'),
	dnsMock = require('./mock/dns-mock.js');

/*
 * Tests crawler in offline mode, just how methods are operates to control
 * basic crawler setup and logic
 */
describe('Crawler instance', function() {

	it('overrides default resolveHost behaviour', function(done){
		var crawler = new Crawler();
		crawler.setup('resolveHost', dnsMock);
		expect(crawler._behaviors.resolveHost).toBeDefined();

		var t1 = crawler._behave('resolveHost', null, 'good.com').then(function(ip){
            expect(ip.time).toBeGreaterThan(0);
            expect(ip.time).toBeLessThan(10);
			expect(ip.value).toEqual('127.0.0.1');
		});

		var t2 = crawler._behave('resolveHost', null, 'bad.com').then(function(ip){
            expect(ip.time).toBeGreaterThan(0);
            expect(ip.time).toBeLessThan(10);
			expect(ip.value).toEqual('');
		});

		when.join(t1, t2).then(function(){
			done();
		}, done).otherwise(done);
	});

//	it('creates host sessions', function(done){
//		var crawler = new Crawler();
//		crawler.setup('createHostSession', function(){
//
//		});
//	});
});