var net = require('net');
var fs = require('fs');
var gn = require('gracenode');
var logger = gn.log.create('daemon-stop');
var sockName = require('./socket-name');
var lib = require('./lib');

module.exports = function (path) {
	var sockFile = sockName(path);
	fs.exists(sockFile, function (exists) {
		if (!exists) {
			logger.error(lib.color('daemon process ' + path + ' not running', lib.COLORS.RED));
			return gn.exit(new Error('processNotFound'));
		}
		gn.on('uncaughtException', function (error) {
			logger.error(lib.color(path + ' ' + sockName(path), lib.COLORS.RED));
			gn.exit(error);
		});
		var sock = new net.Socket();
		sock.connect(sockFile, function () {
			sock.write('stop');
			console.log(lib.color('Daemon process stopped', lib.COLORS.GRAY), lib.color(path, lib.COLORS.LIGHT_BLUE));
			gn.exit();
		});
	});
};