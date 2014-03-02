// DNS mock to be used in test
var dns = {
	"good.com": '127.0.0.1',
	"bad.com": '',
};

module.exports = function(seq, host, callback) {
	if (dns.hasOwnProperty(host)) {
		callback(null, dns[host]);
	} else {
		callback(new Error('Host not found'), null);
	}
};