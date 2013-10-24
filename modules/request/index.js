
var config;

var http = require('http');
var https = require('https');
var qs = require('querystring');

var gracenode = require('../../');
var log = gracenode.log.create('request');

/**
 * @param {object} { protocol: http/https, hots: string, path: string. port: number, method: string, data: object }
 * @options {object} { headers: object, timeout: miliseconds }
 * */
module.exports.send = function (params, options, cb) {
	if (!params) {
		return cb(new Error('missing required arguement 1'));
	}

	var protocol = params.protocol || 'http';
	var host = params.host || null;
	var path = params.path || null;
	if (!host || !path) {
		return cb(new Error('missing host or path: \n' + JSON.stringify(params, null, 4)));
	}
	
	var profiler = gracenode.create('send:[' + host + '/ ' + path + ']');
	
	var port = params.port || null;
	var method = params.method || 'GET';
	var data = params.data || null;
	// construct GET/POST data if given
	if (data) {
		data = qs.stringify(data);
		if (!options) {
			options = {};
		}
		if (!options.headers) {
			options.headers = {};
		}
		options.headers['Content-Length'] = data.length;
		// check method
		if (method === 'GET') {
			path += '?' + data;
			data = null;
		}
	}
	// check options
	var headers = null;
	if (options) {
		headers = options.headers || null;
	}
	// create and send a http request
	var args = {
		host: host,
		path: path,
		method: method,
		headers: headers
	};
	if (port) {
		args.port = port;
	}
	// respond callback handler
	var timer = null;
	var responseData = '';
	var serverResponse = null;
	var callback = function (res) {
	
		profiler.mark('recieving response');

		serverResponse = res;

		log.verbose('response status code: ', res.statusCode);
		log.verbose('response headers: ', res.headers);

		res.setEncoding('utf8');

		// response handlers
		res.on('data', function (dataChunck) {
			
			log.verbose('data reviced');
			
			responseData += dataChunck;
		});
		res.on('end', function () {

			clearTimeout(timer);

			log.verbose('request complete  > disconnected from ' + protocol + '://' + host + path);
			
			profiler.mark('request completion');

			profiler.stop();

			cb(null, { status: res.statusCode, headers: res.headers, data: responseData });
		});
		res.on('error', function (error) {
			
			clearTimeout(timer);

			log.error('request response error: ', error);
			
			profiler.mark('request aborted');

			profiler.stop();

			cb(error, { status: res.statusCode, headers: res.headers, data: responseData });
		});
	};

	log.verbose('connecting to ' + protocol + '://' + host + path);
	log.verbose('sending request: ', args);
	log.verbose('sending ' + method + ' data: ', data);

	// check request protocol
	var sender = http;
	if (protocol === 'https') {
		sender = https;
	}
	// send request
	try {
	
		profiler.mark('ready to sent request');

		var req = sender.request(args, callback);
		
		req.on('error', function (error) {
			
			clearTimeout(timer);

			log.error('request error:');
		
			profiler.mark('request failure');

			profiler.stop();			

			cb(error, { status: null, headers: null, data: responseData });
		});
		
		if (data) {
			req.write(data);
		}
		req.end();

		profiler.mark('sent request');
		
		// set up time out
		var timeout = 3000; // 3 econds by default
		if (options && options.timeout) {
			timeout = options.timeout;
		}
		timer = setTimeout(function () {
			
			log.warning('request timed out: ' + protocol + '://' + host + path);

			if (serverResponse) {
				serverResponse.emit('end', new Error('connection timeout'));
			} else {
				req.abort();
			}
		}, timeout);

		log.verbose('sent headers: ', req._headers);
	
	} catch (exception) {
		
		log.error(exception);

		profiler.stop();

		cb(exception, { status: null, headers: null, data: responseData });
	}
};
