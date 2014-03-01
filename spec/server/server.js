var express = require('express');

var Server = module.exports = function() {
	this._app = express();
};

Server.PORT = 8181;

Server.URL = function (pathquery) {
	return "http://127.0.0.1:"+Server.PORT+pathquery;
};

/*
 * Starts builtin test server
 *
 * To be called on test suite begin
 */
Server.prototype.start = function(startcb){
	// 500 ERROR test
	this._app.get('/errors-500', function(req, res){
		res.status(500).send('Auto generated 500 error');
	});

	// Serve files from data dir
	this._app.get(/^(.+)$/, function(req, res){
	     res.sendfile( __dirname + '/www/' + req.params[0]);
	});

	// Start server
	this._server = this._app.listen(Server.PORT, startcb);
};

/*
 * Stopss builtin test server
 *
 * To be called on test suite end
 */
Server.prototype.stop = function(){
	if (this._server) {
		this._server.close();
	}
};
