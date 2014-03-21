var moment = require('moment');
var TIME_FORMAT = "YYYY-MM-DDTHH:mm:ss.SSSZZ";

/**
 *
 */
module.exports = function(result, traces) {
	result.pages = result.pages || [];
	result.entries = result.entries || [];

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
		}

		// First of all lets build default entry object and then fill
		// it with values from the trace object
		var entry = {
	        "pageref": t.id,
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
	            "content": {},
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
		entry.request.headersSize = 0;
		for (var hn in t.request) {
			entry.request.headers.push({
				name: hn,
				value: t.request[hn]
			});
			// 2 bytes for delimeter + 2 bytes for EOL
			entry.request.headersSize += hn.length + 2 + t.request[hn].length + 2;
		}

		result.entries.push(entry);
	});
};