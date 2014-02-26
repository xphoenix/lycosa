// DNS mock to be used in test
var dns = {
	"good.com": {value: '127.0.0.1', time: 1},
	"bad.com": {value: '', time: 2},
};

module.exports = function(host, callback) {
	if (dns.hasOwnProperty(host)) {
		callback(null, dns[host]);
	} else {
		callback('Host not found', null);
	}
};