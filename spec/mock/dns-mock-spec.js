var mock = require('./dns-mock.js');

describe('Mock of DNS resolver', function(){
	it('knows about a.com and return timed value', function(done){
		mock('', 'good.com', function(error, result){
			expect(error).toBe(null);
			expect(result).toBe('127.0.0.1');
			done();
		});
	});

	it('knows about b.com and return timed value', function(done){
		mock('',  'bad.com', function(error, result){
			expect(error).toBe(null);
			expect(result).toBe('');
			done();
		});
	});
});