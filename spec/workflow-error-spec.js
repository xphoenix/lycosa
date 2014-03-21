var	WorkflowError = require('../lib/WorkflowError.js');

describe('Workflow error class', function(){
	it('instanceof Error', function(){
		var error = new WorkflowError(-1, 'ConnectionError');
		expect(error instanceof Error).toBe(true);
	});

	it('instanceof WorkflowError', function(){
		var error = new WorkflowError(-1, 'ConnectionError');
		expect(error instanceof WorkflowError).toBe(true);
	});
});
