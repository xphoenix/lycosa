var when = require('when'),
	Crawler = require('../lib/Crawler.js'),
	HostSession = require('../lib/HostSession'),
	dnsMock = require('./mock/dns-mock.js');

/*
 * Tests crawler in offline mode, just how methods are operates to control
 * basic crawler setup and logic
 */
describe('Crawler instance', function() {

	var crawler = new Crawler();
	crawler.setup('resolveHost', dnsMock);

	it('overrides default resolveHost behaviour', function(done){
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

	it('creates and destroyes host sessions', function(done){
		crawler._sessions.get(1000, 'bad.com', 'seq', 'good.com').then(function(result){
            expect(result.time).toBeGreaterThan(0);
            expect(result.time).toBeLessThan(10);
			expect(result.value).toBeDefined();
			expect(result.value instanceof HostSession).toBe(true);
			done();
		}, done).otherwise(done);
	});
});