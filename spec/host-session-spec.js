var HostSession = require('../lib/HostSession.js');

describe('Host crawling session', function(){
	it('has defaults', function(){
		var session = new HostSession();

		expect(session._crawlDelay).toBe(1000);
		expect(session._rules).toEqual({});
		expect(session._sentRequestCount).toBe(0);
		expect(session._lastRequestTime).toBe(0);

		expect(session.age() >= 0).toBe(true);
		expect(session.timeToWait()).toBe(0);
	});

	it('selects IP', function(){
		var session = new HostSession();

		expect(function(){session.selectIp()}).toThrow();
		expect(function(){session.selectIp([])}).toThrow();

		// Test that 10 requests for a single IP is always
		// single IP
		for (var i=0; i < 10; i++) {
			expect(session.selectIp(['127.0.0.1'])).toBe('127.0.0.1');
			session.requestSent();
		}
		expect(session._sentRequestCount).toBe(10);

		// Test that for multiple IP first 9 goes to first
		// and 10th is always to second
		var list=['127.0.0.1','127.0.0.2'];
		for (var i=0; i < 9; i++) {
			expect(session.selectIp(list)).toBe('127.0.0.1');
			session.requestSent();
		}
		expect(session._sentRequestCount).toBe(19);
		expect(session.selectIp(list)).toBe('127.0.0.2');

		session.requestSent();

		expect(session._sentRequestCount).toBe(20);
		expect(session.selectIp(list)).toBe('127.0.0.1');
	});

});