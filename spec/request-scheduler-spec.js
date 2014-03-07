var url = require('url'),
	when = require('when'),
	matchers = require('./jasmine/matchers.js'),
	RequestScheduler = require('../lib/RequestScheduler.js'),
	HostSession = require('../lib/HostSession.js');

describe('Request scheduler', function(){

	beforeEach(function(){
		this.addMatchers(matchers);
	});

	it('has defaults', function(){
		var rq = new RequestScheduler();
		expect(rq.delay).toBe(500);
		expect(rq.connectionLimit).toBe(4);
		expect(rq._timer).toBe(false);
		expect(rq._timerTarget).toBe(false);
		expect(rq._queues).toEqual({});
		expect(rq._connections).toBe(0);
		expect(rq._onConnection).toBe(false);
	});

	it('accepts delay arg', function(){
		var rq = new RequestScheduler(1000);
		expect(rq.delay).toBe(1000);
		expect(rq.connectionLimit).toBe(4);
		expect(rq._timer).toBe(false);
		expect(rq._timerTarget).toBe(false);
		expect(rq._queues).toEqual({});
		expect(rq._connections).toBe(0);
		expect(rq._onConnection).toBe(false);
	});

	it('accepts connectionLimit', function(){
		var rq1 = new RequestScheduler(1000, 5);
		expect(rq1.delay).toBe(1000);
		expect(rq1.connectionLimit).toBe(5);
		expect(rq1._timer).toBe(false);
		expect(rq1._timerTarget).toBe(false);
		expect(rq1._queues).toEqual({});
		expect(rq1._connections).toBe(0);
		expect(rq1._onConnection).toBe(false);

		var rq2 = new RequestScheduler(null, 15);
		expect(rq2.delay).toBe(500);
		expect(rq2.connectionLimit).toBe(15);
		expect(rq2._timer).toBe(false);
		expect(rq2._timerTarget).toBe(false);
		expect(rq2._queues).toEqual({});
		expect(rq2._connections).toBe(0);
		expect(rq2._onConnection).toBe(false);
	});

	it('schedules request', function(done){
		var session = new HostSession(1000), rq = new RequestScheduler();

		var u = url.parse('http://www.google.com'),	u2 = url.parse('http://www.google.com/robots.txt');

		var stage = 0, start = Date.now();
		rq.schedule(session, u).then(function(obj){
			var delta = Date.now() - start;
			expect(u).toBe(obj);
			expect(stage).toBe(0);
			expect(delta).toBeInRange(0, 10);

            stage = 1;
            session.requestSent();
		}, done).otherwise(done);

		rq.schedule(session, u2).then(function(obj){
			var delta = Date.now() - start;
			expect(u2).toBe(obj);
			expect(stage).toBe(1);
			expect(delta).toBeInRange(1000, 1010);
			done();
		}, done).otherwise(done);
	});

	it('respects crawl delay when connections restored', function(done) {
		var session = new HostSession(100), rq = new RequestScheduler(1000, 1);

		// Only one connection available, delay is 1 second.
		//
		// If we issue request then second one gets stuck until connection returned.
		// If we wait for 500ms and return connection then next request could be issued
		// only on Math.min(session.delay, scheduler.delay); In that case that is
		// scheduler delay, but because we have wait for 500ms already, request should
		// be issued 500ms later
		var times = [];

		// 1st request
		rq.schedule(session, url.parse('http://google.com')).then(function(){
			times.push(Date.now());
			session.requestSent();
		}, done).otherwise(done);

		// 2st stuck as 1st use all available connections
		rq.schedule(session, url.parse('http://google.com/robots.txt')).then(function(){
			times.push(Date.now());
			var delta = times[1] - times[0];

			// 1 second passed
			expect(delta).toBeInRange(1000, 1010);

            done();
		}, done).otherwise(done);

		// 500ms emulates first request end
		setTimeout(function(){
			rq.requestDone();
		}, 500);
	});

	it('respects crawl delay when schedule multiple hosts', function(done) {
		var session1 = new HostSession(2000),
			session2 = new HostSession(1500),
			rq = new RequestScheduler(500, 4),
			order = 0;

		var s1times = [], s2times = [], iptimes = [];
		var r1 = rq.schedule(session1, url.parse('http://google.com/a')).then(function(){
			var t = Date.now();
			s1times.push(t);
			iptimes.push(t);
			session1.requestSent();

			expect(order).toBe(0);
			order = 1;
		}, done).otherwise(done);
		var r2 = rq.schedule(session1, url.parse('http://google.com/2')).then(function(){
			var t = Date.now();
			s1times.push(t);
			iptimes.push(t);
			session1.requestSent();

			expect(order).toBe(2);
			order = 3;
		}, done).otherwise(done);

		var r3 = rq.schedule(session2, url.parse('http://yandex.com/a')).then(function(){
			var t = Date.now();
			s2times.push(t);
			iptimes.push(t);
			session2.requestSent();

			expect(order).toBe(1);
			order = 2;
		}, done).otherwise(done);
		var r4 = rq.schedule(session2, url.parse('http://yandex.com/2')).then(function(){
			var t = Date.now();
			s2times.push(t);
			iptimes.push(t);
			session2.requestSent();

			expect(order).toBe(3);
			order = 4;
		}, done).otherwise(done);

		when.join(r1, r2, r3, r4).then(function(){
			expect(s1times.length).toBe(2);
			expect(s1times[1] - s1times[0]).toBeInRange(2000, 2010);

			expect(s2times.length).toBe(2);
			expect(s2times[1] - s2times[0]).toBeInRange(2000, 2010);

			expect(iptimes.length).toBe(4);
			expect(iptimes[1] - iptimes[0]).toBeInRange(500, 510);
			expect(iptimes[2] - iptimes[1]).toBeInRange(1500, 1510);
			expect(iptimes[3] - iptimes[2]).toBeInRange(500, 510);

			done();
		}, done).otherwise(done);
	});

	// TODO: add more tests for the case when session scheduling in two
	// separate schedulers
});