var moment = require('moment'),
	util = require('util');

var TIME_FORMAT = "YYYY-MM-DDTHH:mm:ss.SSSZZ";

/**
 *
 */
module.exports = function(result, traces) {
	result.pages = result.pages || [];
	result.entries = result.entries || [];

	var pageref = "";
	traces.forEach(function(t, i){
		// First entry is a requested page, so push pages info
		if (i === 0) {
			result.pages.push({
		        "startedDateTime": moment(t.start).format(TIME_FORMAT),
		        "id": t.id,
		        "title": t.url.href,
		        "pageTimings": {
		            "onContentLoad": 0,
		            "onLoad": 0,
//		            "comment": ""
		        },
//		        "comment": ""
			});
			pageref = t.id;
		}

		// First of all lets build default entry object and then fill
		// it with values from the trace object
		var entry = {
	        "pageref": pageref,
	        "startedDateTime": moment(t.start).format(TIME_FORMAT),
	        "time": 0,
	        "request": {
	            "method": "GET",
	            "httpVersion": "HTTP/1.1",
	            "url": t.url.href,
	            "cookies": [],
	            "headers": [],
	            "queryString" : [],
	            "postData" : {},
	            "headersSize" : 0,
	            "bodySize" : 0,
//	            "comment" : ""
        	},
	        "response": {
	            "status": -1,
	            "statusText": "",
	            "httpVersion": "HTTP/1.1",
	            "cookies": [],
	            "headers": [],
	            "content": {
					"size": 0,
					"compression": 0,
					"mimeType": "",
					"text": "",
//	                "comment": ""
	            },
	            "redirectURL": "",
	            "headersSize" : 0,
	            "bodySize" : 0,
//	            "comment" : ""
	        },
//	        "cache": {...},
	        "timings": {
	            "blocked": -1,
	            "dns": -1,
	            "connect": -1,
	            "send": -1,
	            "wait": -1,
	            "receive": -1,
	            "ssl": -1,
	        },
	        "serverIPAddress": t.ip,
//	        "connection": "-1",
//	        "comment": ""
		};

		// Copy times
		for (var tn in t._timings) {
			var value = t._timings[tn].end - t._timings[tn].start;
			entry.time += value;

			if (tn === 'resolveHost') {
				entry.timings.dns = value;
			} else if (tn === 'scheduling') {
				entry.timings.blocked = value;
			} else {
				entry.timings['_'+tn] = value;
			}
		};

		// Copy parameters
		for (var pn in t.url.query) {
			entry.request.queryString.push({
				name: pn,
				value: t.url.query[pn]
			});
		}

		// Parse and insert request headers
		insertHeaders(entry.request, t.request);

		// Parse and insert response headers
		if (t.hasErrors()) {
			generateErrorResponse(entry, t);
		} else {
			// Insert status & headers
			entry.response.status = t.response.status;
			entry.response.statusText = t.response.statusText;
			insertHeaders(entry.response, t.response.headers);

			// Insert redirect
			if (t.isRedirect()) {
				entry.response.redirectURL = t.getRedirectTarget();
			}

			// Insert content
			// TODO: BodySize - should take into account caching
			// TODO: compression - size of recompressed data, stored in cache
			// TODO: text - setup content from fetchResult
			entry.response.bodySize = t.response.receivedSize;
			entry.response.content.size = t.response.logicalSize;
			entry.response.content.compression = t.response.receivedSize;
			entry.response.content.mimeType = t.response.headers['content-type'];
			entry.response.content.text = new Buffer(t.response.text.join("")).toString('base64');
			entry.response.content.data = t.response.processed;
		}

		result.entries.push(entry);
	});
};

/*
 * Generates headers map for request/response objects
 * in HAR Entry
 */
var insertHeaders = function(target, headers) {
	for (var hn in headers) {
		var value = headers[hn];
		if (value instanceof Array) {
			value = value.join(',');
		}

		target.headers.push({
			name: hn,
			value: value
		});
		// 2 bytes for delimeter + 2 bytes for EOL
		target.headersSize += hn.length + 2 + headers[hn].length + 2;
	}
};

/*
 * Generates fake content for the error trace
 */
var generateErrorResponse = function(entry, trace) {
	var firstError = trace._errors[0];
	entry.response.status = (firstError.code ? firstError.code : -1);
	entry.response.statusText = firstError.message;

	entry._errors = [];
	trace._errors.forEach(function(e){
		entry._errors.push(util.format(e.stack));
	});
};
