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

	// Fetch result to be used in tests
	var result = {
		status: 200,
		statusText: 'OK',

		request: {

		},

		response: {
			'server': 'nginx',
			'transfer-encoding': 'chunked',
			'connection': 'close',
			'vary': 'Accept-Encoding',
			'date': 'Mon, 24 Mar 2014 15:01:52 GMT',
			'content-type': 'text/html; charset=UTF-8',
			'set-cookie': ['geo_location=a%3A3%3A%7Bs%3A7%3A%22city_id%22%3Ba%3A0%3A%7B%7Ds%3A9%3A%22region_id%22%3Ba%3A0%3A%7B%7Ds%3A10%3A%22country_id%22%3Ba%3A0%3A%7B%7D%7D; Domain=.auto.ru; expires=Tue, 24-Mar-2015 15:01:52 GMT; Version=1; Path=/; HttpOnly=1'],
			'content-encoding': 'gzip'
		},

		timings: {
			connect: 10,
			sent: 5,
			receive: 15
		},

		content: {
			size: 27,
			unpacked: 27,
			data: 'Hello-World!\nTHat is a test'
		},

		processed: {
			outLinks: [],
			language: 'unknown',
			confidence: 0.8
		}
	};

	it('aggregates fetch results into the trace', function(done){
		var crawler = new Crawler();
		crawler.setup('fetchPageContent', function(trace, callback){
			expect(this).toBe(crawler);
			callback(null, result);
		});

		crawler.crawl(['http://google.com']).then(function(result){
<<<<<<< HEAD
=======
			console.log(JSON.stringify(result, null, 4));

>>>>>>> branch 'master' of git@github.com:xphoenix/lycosa.git
			expect(result.pages.length).toBe(1);
			expect(result.entries.length).toBe(1);

			var entry = result.entries[0];

			expect(entry).toBeDefined();
			expect(entry.response.status).toBe(200);
			expect(entry.response.statusText).toBe('OK');
			expect(entry.response.redirectURL).toEqual('');
			expect(entry.response.cookies).toEqual([]);
			expect(entry.response.headersSize).toBe(201);
			expect(entry.response.headers).toEqual([
                    { name : 'server', value : 'nginx' },
					{ name : 'transfer-encoding', value : 'chunked' },
					{ name : 'connection', value : 'close' },
					{ name : 'vary', value : 'Accept-Encoding' },
					{ name : 'date', value : 'Mon, 24 Mar 2014 15:01:52 GMT' },
					{ name : 'content-type', value : 'text/html; charset=UTF-8' },
					{ name : 'set-cookie', value : 'geo_location=a%3A3%3A%7Bs%3A7%3A%22city_id%22%3Ba%3A0%3A%7B%7Ds%3A9%3A%22region_id%22%3Ba%3A0%3A%7B%7Ds%3A10%3A%22country_id%22%3Ba%3A0%3A%7B%7D%7D; Domain=.auto.ru; expires=Tue, 24-Mar-2015 15:01:52 GMT; Version=1; Path=/; HttpOnly=1' },
					{ name : 'content-encoding', value : 'gzip' }
			]);
			done();
		}, done).otherwise(done);
	});
});
