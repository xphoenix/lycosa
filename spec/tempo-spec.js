var when = require('when'),
	delay = require('when/delay'),
	TFactory = require('../lib/tempo/TemporaryObjectFactory.js');

describe('TemporaryObject factory', function(){

	var buildAction = function(key, param1, param2) {
		return when(key+': '+param1+", "+JSON.stringify(param2));
	};

	var destroyAction = function(key, value) {
		return value;
	};

	var slowDestroyAction = function(key, value) {
		return delay(1000, value);
	};

	it('must has buildAction', function(){
		expect(function(){
			new TFactory();
		}).toThrow();
	});

	it('must has destroyAction', function(){
		expect(function(){
			new TFactory(buildAction);
		}).toThrow();
	});

	it('has defaults', function(){
		var factory = new TFactory(buildAction, destroyAction);
		expect(factory.buildAction).toBeDefined();
		expect(factory.destroyAction).toBeDefined();
		expect(factory._entries).toEqual({});
	});

	it('passes parameters to create function', function(done){
		var factory = new TFactory(buildAction, slowDestroyAction);
		factory.get(100, 'test', 'a', {test: 'hello world'}).then(function (value){
			expect(value).toEqual('test: a, {"test":"hello world"}');
			done();
		}).otherwise(done);
	});

	it('destroy only constructed objects', function(done){
		// It takes 1s to create and to destroy object
		var factory = new TFactory(function() {
			return delay(1000, "Hello world")
		}, function(key, value) {
			return delay(1000, "Bye world");
		});

		var stage = 0, start = Date.now();
		factory.get(500, 'test').then(function (value){
			// Called one second after
			var delta = Date.now() - start;

			// check
			expect(stage).toBe(0);
			expect(value).toBe('Hello world');
            expect(delta).toBeGreaterThan(999);
            expect(delta).toBeLessThan(1010);

			// passed
			stage = 1;
		}, done).otherwise(done);

		factory.destroy('test').then(function(value){
			// that is called 2.0 seconds after
			// 1.0s - to create
			// 0.5s - timeout (goes in parallel with creation)
			// 1.0s - to destroy
			var delta = Date.now() - start;

			// check
			expect(stage).toBe(1);
			expect(value).toBe('Bye world');
            expect(delta).toBeGreaterThan(1999);
            expect(delta).toBeLessThan(2010);

            // passed
            done();
		}, done).otherwise(done);
	});

	it('destroys objects after timeout', function(done){
		// It takes 0s to create and to destroy object
		var factory = new TFactory(function() {
			return when.resolve("Hello world");
		}, function(key, value) {
			return when.resolve("Bye world");
		});

		var stage = 0, start = Date.now();
		factory.get(1000, 'test').then(function (value){
			// Called "immediately"
			var delta = Date.now() - start;

			// check
			expect(stage).toBe(0);
			expect(value).toBe('Hello world');
            expect(delta).toBeGreaterThan(-1);
            expect(delta).toBeLessThan(10);

			// passed
			stage = 1;
		}, done).otherwise(done);

		factory.destroy('test').then(function(value){
			// that is called 1.0 seconds after
			// 0.0s - to create
			// 1.0s - timeout (goes in parallel with creation)
			// 0.0s - to destroy
			var delta = Date.now() - start;

			// check
			expect(stage).toBe(1);
			expect(value).toBe('Bye world');
            expect(delta).toBeGreaterThan(999);
            expect(delta).toBeLessThan(1010);

            // passed
            done();
		}, done).otherwise(done);
	});

	it('delays creation till destroy completes', function(done){
		// It takes 0s to create and to destroy object
		var factory = new TFactory(function() {
			return when.resolve("Hello world - "+Date.now());
		}, function(key, value) {
			return delay(1000, "Bye world");
		});

		var stage = 0, obj, start = Date.now();
		factory.get(100, 'test').then(function (value){
			stage = 1;
			obj = value;
		}, done).otherwise(done);

		// First time we destroy object 100ms after creation.
		// Destroy itself takes 1second to complete
		factory.destroy('test').then(function(value){
			var delta = Date.now() - start;

			// check
			expect(stage).toBe(1);
			expect(value).toBe('Bye world');
            expect(delta).toBeGreaterThan(1099);
            expect(delta).toBeLessThan(1110);

            // passed
            stage = 2;
		}, done).otherwise(done);

		// Second time we are trying to create object after destroy function has
		// been started. It means that our new creation should be delayed till AFTER
		// destroy is done
		setTimeout(function(){
			// Destroy is still in progress
			expect(stage).toBe(1);
			factory.get(1000, 'test').then(function(value){
				var delta = Date.now() - start;

				// AFTER destroy
				expect(stage).toBe(2);
				expect(obj === value).toBe(false);
	            expect(delta).toBeGreaterThan(1099);
	            expect(delta).toBeLessThan(1110);

				done();
			}, done).otherwise(done);
		}, 800);
	});
});