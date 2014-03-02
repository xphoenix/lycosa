var when = require('when'),
	Crawler = require('../lib/Crawler.js'),
	HostSession = require('../lib/HostSession.js'),
	RequestScheduler = require('../lib/RequestScheduler.js'),
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
		crawler.setup('createHostSession', function (seq, hostname, callback) {
			expect(this).toBe(crawler);
			callback(null, new HostSession());
		});
		crawler.setup('disposeHostSession', function (seq, session, callback) {
			expect(this).toBe(crawler);
			callback(null, session);
		});

		crawler._sessions.get(1000, 'bad.com', 'seq', 'bad.com').then(function(result){
            expect(result.time).toBeGreaterThan(0);
            expect(result.time).toBeLessThan(11);
			expect(result.value).toBeDefined();
			expect(result.value instanceof HostSession).toBe(true);
		}, done).otherwise(done);

		// Crawler will take care of passing correct session object into the destroy action
		crawler._sessions.destroy('bad.com', 'seq', 'session here').then(function(result) {
            expect(result.time).toBeGreaterThan(-1);
            expect(result.time).toBeLessThan(10);
			expect(result.value).toBe('session here');
			done();
		}, done).otherwise(done);
	});

	it('creates and destroyes schedulers', function(done){
		crawler.setup('createScheduler', function (seq, ip, callback) {
			expect(this).toBe(crawler);
			callback(null, new RequestScheduler(500));
		});

		crawler.setup('disposeScheduler', function (seq, scheduler, callback) {
			expect(this).toBe(crawler);
			callback(null, scheduler);
		});

		crawler._schedulers.get(500, 'bad.com', 'seq', '127.0.0.1').then(function(result){
            expect(result.time).toBeGreaterThan(0);
            expect(result.time).toBeLessThan(11);
			expect(result.value).toBeDefined();
			expect(result.value instanceof RequestScheduler).toBe(true);
		}, done).otherwise(done);

		// Crawler will take care of passing correct session object into the destroy action
		crawler._schedulers.destroy('bad.com', 'seq', 'scheduler here').then(function(result) {
            expect(result.time).toBeGreaterThan(-1);
            expect(result.time).toBeLessThan(10);
			expect(result.value).toBe('scheduler here');
			done();
		}, done).otherwise(done);
	});
});