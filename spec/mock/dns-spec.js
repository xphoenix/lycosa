var mock = require('./dns.js');

describe('Mock of DNS resolver', function(){
	it('knows about a.com and return timed value', function(done){
		mock(null, 'good.com', function(error, result){
			expect(error).toBe(null);

			expect(result).toBeDefined();
			expect(result.time).toBe(1);
			expect(result.value).toBe('127.0.0.1');

			done();
		});
	});

	it('knows about b.com and return timed value', function(done){
		mock(null, 'bad.com', function(error, result){
			expect(error).toBe(null);

			expect(result).toBeDefined();
			expect(result.time).toBe(2);
			expect(result.value).toBe('');

			done();
		});
	});
});