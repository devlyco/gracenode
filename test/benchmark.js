var express = require('express');
var gn = require('../src/gracenode');
var req = require('./src/request');
var dur = 1000;
var eport = 2222;
var gport = 3333;
var cnt = 0;
var ecnt = 0;
var opt = { gzip: false };
var fnc = function () {};

if (process.argv[2] === 'express') {
	console.log('Test express');
	var app = express();
	var router = express.Router();
	router.get('/', fnc);
	for (var i = 0; i < 100; i++) {
		router.get('/' + i + 'xxxx', fnc);
	}
	router.get('/test', ehandle);
	app.listen(eport);
	spam(eport);
	var done = function () {
		console.log('DONE', dur + 'ms', cnt, ecnt);
		process.exit();
	};
	setTimeout(done, dur);
} else if (process.argv[2] === 'gracenode') {
	console.log('Test gracenode');
	var done = function () {
		console.log('DONE', dur + 'ms', cnt, ecnt);
		gn.stop();
	};
	gn.config({
		log: {
			console: false,
		},
		router: {
			host: 'localhost',
			port: gport
		}
	});
	gn.router.get('/', fnc);
	for (var i = 0; i < 100; i++) {
		gn.router.get('/' + i + 'xxxx', fnc);
	}
	gn.router.get('/test', ghandle, { readBody: false });
	gn.start(function () {
		spam(gport);
		setTimeout(done, dur);
	});
	var done = function () {
		console.log('DONE', dur + 'ms', cnt, ecnt);
		gn.stop();
	};
	setTimeout(done, dur);
} else {
	console.log('Test raw http');
	var http = require('http');
	var server = http.createServer(function (req, res) {
		res.end(JSON.stringify({ time: Date.now() }));
	});
	server.listen(eport);
	spam(eport);
	var done = function () {
		console.log('DONE', dur + 'ms', cnt, ecnt);
		process.exit();
	};
	setTimeout(done, dur);
}

function ehandle(req, res) {
	res.render({ time: Date.now() });
}

function ghandle(req, res) {
	res.gzip(false);
	res.json({ time: Date.now() });
}

function spam(port) {
	req.GET('http://localhost:' + port + '/test', {}, opt, function (error) {
		if (error) {
			ecnt += 1;
		} else {
			cnt += 1;
		}
		spam(port);
	});
}