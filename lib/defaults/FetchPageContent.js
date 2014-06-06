var http = require('http'),
	zlib = require('zlib'),
	_ = require('lodash');

/**
 * Default fetchPageContent behavior
 *
 */
module.exports = function(trace, callback) {
	// Override passed headers to guarantee call correctness
	trace.request['host'] = trace.url.hostname;
	trace.request['connection'] = 'keep-alive';
	trace.request['accept-encoding'] = 'gzip, deflate';

	var options = {
		host: trace.ip,
		port: 80,
		method: 'GET',
		path: trace.url.path,
		headers: trace.request
	};

	var result = {
		version: null,
		status: 0,
		statusText: null,
		headers: null,
		logicalSize: 0,
		receivedSize: 0,
		content: [],
		processed: {},
		timings: {
			send: 0,
			wait: 0
		},
	};

	var processors = (trace._processors ? trace._processors(trace) : []),
		streamsToWait = 1 + processors.length,
		afterStreamsCb = function() {
			if (--streamsToWait == 0) {
				callback(null, result);
			}
		};

	var opStart = Date.now();
	http.request(options, function(response){
		// Headers has been received
		result.version = 'HTTP/'+response.httpVersion;
		result.status = response.statusCode;
		result.statusText = http.STATUS_CODES[response.statusCode];
		result.headers = response.headers;

		//  By default we'd like to read data from the
		// response itself. However in case of compressed encoding
		// we will read data from decompression stream
		var dataPipe = response;

		// Detects encoding and create decompression stream if needs
		var encoding = '';
		if (response.headers.hasOwnProperty('content-encoding')) {
			encoding = response.headers['content-encoding'];
		};

		if (encoding.match(/\bdeflate\b/)) {
		    dataPipe = zlib.createInflate();
		    response.pipe(dataPipe);
		} else if (encoding.match(/\bgzip\b/)) {
		    dataPipe = zlib.createGunzip();
		    response.pipe(dataPipe);
		}

		// Calculate received data size
		response.on('data', function(data) {
			result.receivedSize += data.length;
		});

		dataPipe.on('data', function(data) {
			// TODO: we need to split chunk if only part of it
			// is under fetchLimit
			result.logicalSize += data.length;
			if (!trace.fetchLimit || result.logicalSize < trace.fetchLimit) {
				result.content.push(data);
			}
		});

		// Add custom processor if any
		processors.forEach(function(p) {
			dataPipe.pipe(p).on('data', function(data){
				_.merge(result.processed, data);
			}).on('end', afterStreamsCb);
		});

		// Timings
		dataPipe.on('end', function() {
			result.timings.receive = Date.now() - opStart;
			afterStreamsCb();
		});
	}).on('socket', function(socket) {
		result.timings.connect = Date.now() - opStart;
		opStart = Date.now();
	}).once('finish', function(socket) {
		// Hack?: msg from OutgoingMessage to catch time when
		// request has been flushed to the socket
		result.timings.send = Date.now() - opStart;
		opStart = Date.now();
	}).on('error', function(e) {
		callback(e, null);
	}).end();
};