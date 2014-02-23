var request = require('request'),
	TestServer = require('./server.js');


// Before launch crawler tests lets test that builtin
// server returns valid results. We are assume that node.js
// http library is working good, so we only need to test that
// experimental http server setup returns values expected by
// crawler tests
describe('test http server', function(){
	var server = new TestServer();

	// That emulates async beforeAll
	it('could be started', function(done){
		server.start(done);
	});

	it('has robots.txt', function(done){
		request(TestServer.URL('/robots.txt'), function (error, response, body) {
			expect(error).toBe(null);
			expect(response.statusCode).toBe(200);
			done();
		});
	});

	it('has 500 error page', function(done){
		request(TestServer.URL('/errors-500'), function (error, response, body) {
			expect(error).toBe(null);
			expect(response.statusCode).toBe(500);
			expect(body).toBe('Auto generated 500 error');
			done();
		});
	});

	// That emulates async afterAll
	it('could be stopped', function(){
		server.stop();
	});
});