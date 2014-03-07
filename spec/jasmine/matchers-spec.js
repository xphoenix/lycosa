var matchers = require('./matchers.js');

describe("toBeInRange matcher", function(){
	beforeEach(function(){
		this.addMatchers(matchers);
	});

	it('works for integer', function(){
		for (var i=0; i <= 11; i++) {
			expect(i).toBeInRange(0, 11);
		}
		expect(-1).not.toBeInRange(0, 11);
		expect(12).not.toBeInRange(0, 11);
	});

	it('not works for undefined', function(){
		expect(function(){expect(undefined).not.toBeInRange(0, 11)}).toThrow();
	});

	it('not works for null', function(){
		expect(function(){expect(null).not.toBeInRange(0, 11)}).toThrow();
	});
});