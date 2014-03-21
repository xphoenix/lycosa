var when = require('when'),
	matchers = require('./jasmine/matchers.js'),
	Crawler = require('../lib/Crawler.js'),
	WorkflowError = require('../lib/WorkflowError.js');

/*
 * Tests crawler behavoir about various errors:
 * + in behaviors execution
 * + internal code errors
 * + network and protocol issues
 */
describe('Crawler instance', function() {

	beforeEach(function(){
		this.addMatchers(matchers);
	});

	// Result build function returns first trace is crawl sequence.
	var notransform = function(result, trace) {
		expect(trace.length).toBe(1);
		result[trace[0].id] = trace[0];
	};

	// Fake URL to crawl and precalculated ID
	var tocrawl = ['http://google.com'], id='ac4cbe16220c61319d192bf9078f01de42e383e3';

	/// Tests
	it('setup erros for the empty dns response', function(done){
		var crawler = new Crawler();
		crawler.setup('resolveHost', function(trace, callback){
			callback(null, []);
		});

		crawler.crawl(tocrawl, notransform).then(function(traces){
			var trace = traces[id];

			expect(trace).toBeDefined();
			expect(trace.id).toBe(id);
			expect(trace.ip).toBeUndefined();

			expect(trace._ipList).toBeDefined();
			expect(trace._ipList.length).toBe(0);

			expect(trace.hasErrors()).toBe(true);
			expect(trace._errors[0] instanceof WorkflowError).toBe(true);
			expect(trace._errors[0].code).toBe(-7);

			done();
		}, done).otherwise(done);
	});

	it('setup erros for the behaviors', function(done){
		var crawler = new Crawler();
		crawler.setup('resolveHost', function(trace, callback){
			callback(null, ['127.0.0.1']);
		});
		crawler.setup('createScheduler', function(trace, callback){
			callback(new Error('test'), undefined);
		});

		crawler.crawl(tocrawl, notransform).then(function(traces){
			var trace = traces[id];

			expect(trace).toBeDefined();
			expect(trace.id).toBe(id);
			expect(trace.ip).toBe('127.0.0.1');

			expect(trace._ipList).toBeDefined();
			expect(trace._ipList.length).toBe(1);

			expect(trace.hasErrors()).toBe(true);
			expect(trace._errors[0] instanceof Error).toBe(true);
			expect(trace._errors[0] instanceof WorkflowError).toBe(false);
			expect(trace._errors[0].message).toBe('test');

			done();
		}, done).otherwise(done);
	});
});